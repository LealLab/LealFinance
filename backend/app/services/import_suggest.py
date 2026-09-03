"""One-shot AI categorization for the transaction import page.

Not a conversation and not a tool call: the same shape as
`app/services/agent_instructions.py::_classify` - resolve the user's provider,
send one turn with an empty tool list, collect the text, parse it, and fail
closed. Nothing here writes; the frontend creates any proposed groups and
categories through the normal endpoints once the user confirms.
"""

import json
from collections.abc import AsyncIterator, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import chat, prompt
from app.agents.events import ProviderEvent, TextDelta, Turn
from app.core.errors import BadGatewayError
from app.models.category import Category
from app.models.category_group import CategoryGroup
from app.schemas.agent import ImportSuggestionRead, ImportSuggestItem
from app.services import categories as categories_service
from app.services import category_groups as category_groups_service
from app.services.agent_chat import _resolve_provider

Streamer = Callable[..., AsyncIterator[ProviderEvent]]

# A model that returns a category per distinct merchant is not helping; cap the
# fan-out of brand-new categories one call can propose.
MAX_PROPOSED_CATEGORIES = 20
_NAME_MAX = 100  # CategoryCreate / CategoryGroupCreate name limit


def _strip_fence(text: str) -> str:
    """Drop a leading/trailing ``` fence the model sometimes adds anyway."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[-1] if "\n" in stripped else ""
        if stripped.rstrip().endswith("```"):
            stripped = stripped.rstrip()[:-3]
    return stripped.strip()


async def suggest(
    db: AsyncSession,
    user_id: UUID,
    items: list[ImportSuggestItem],
    locale: str,
    *,
    streamer: Streamer | None = None,
) -> list[ImportSuggestionRead]:
    """Return validated per-row suggestions. Raises when no provider is reachable
    (`agents.not_configured` / `agents.provider_unavailable`) or the model's
    answer cannot be read as a JSON array (`agents.suggest_unreadable`)."""
    credential = await _resolve_provider(db, user_id, None)

    categories = await categories_service.list_categories(db, user_id)
    groups = await category_groups_service.list_groups(db, user_id)
    group_name_by_id = {group.id: group.name for group in groups}
    categories_block = "\n".join(
        f"{c.id} | {c.name} | {group_name_by_id.get(c.group_id, '')} | {c.kind}" for c in categories
    )
    groups_block = "\n".join(f"{g.id} | {g.name} | {g.kind}" for g in groups)
    rows_json = json.dumps(
        [{"index": i.index, "description": i.description, "type": i.type} for i in items],
        ensure_ascii=False,
    )

    parts: list[str] = []
    async for event in (streamer or chat.stream_turn)(
        credential,
        prompt.IMPORT_SUGGEST_PROMPT,
        [
            Turn(
                role="user",
                text=prompt.build_import_suggest_turn(
                    rows_json, categories_block, groups_block, locale
                ),
            )
        ],
        [],
    ):
        if isinstance(event, TextDelta):
            parts.append(event.text)

    try:
        raw = json.loads(_strip_fence("".join(parts)))
    except ValueError as exc:
        raise BadGatewayError(code="agents.suggest_unreadable") from exc
    if not isinstance(raw, list):
        raise BadGatewayError(code="agents.suggest_unreadable")

    return _validate_suggestions(raw, items, categories, groups)


def _validate_suggestions(
    raw: list[object],
    items: list[ImportSuggestItem],
    categories: list[Category],
    groups: list[CategoryGroup],
) -> list[ImportSuggestionRead]:
    """Keep only suggestions we can trust: a real, kind-matched category id, or a
    complete new-category proposal. Everything else is dropped, not an error."""
    type_by_index = {item.index: item.type for item in items}
    category_by_id = {category.id: category for category in categories}
    group_by_name = {(g.name.casefold(), g.kind): g for g in groups}

    out: list[ImportSuggestionRead] = []
    proposed_names: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        index = entry.get("index")
        row_type = type_by_index.get(index) if isinstance(index, int) else None
        if row_type is None:
            continue

        category_id = _coerce_uuid(entry.get("category_id"))
        matched = category_by_id.get(category_id) if category_id else None
        if matched is not None and matched.kind == row_type:
            out.append(ImportSuggestionRead(index=index, category_id=matched.id))
            continue

        group_name = _clean_name(entry.get("group_name"))
        category_name = _clean_name(entry.get("category_name"))
        if not group_name or not category_name:
            continue
        key = f"{group_name.casefold()}/{category_name.casefold()}"
        if key not in proposed_names:
            if len(proposed_names) >= MAX_PROPOSED_CATEGORIES:
                continue
            proposed_names.add(key)
        existing_group = group_by_name.get((group_name.casefold(), row_type))
        out.append(
            ImportSuggestionRead(
                index=index,
                group_id=existing_group.id if existing_group else None,
                group_name=existing_group.name if existing_group else group_name,
                category_name=category_name,
            )
        )
    return out


def _coerce_uuid(value: object) -> UUID | None:
    if isinstance(value, str):
        try:
            return UUID(value)
        except ValueError:
            return None
    return None


def _clean_name(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()[:_NAME_MAX].strip()
    return cleaned or None
