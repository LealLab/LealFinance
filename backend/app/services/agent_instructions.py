"""Storage and admission control for the user's own assistant instructions.

The text is folded into the system prompt (`app/agents/prompt.py::build`), so it
is classified by the user's own provider before it is stored: anything outside
personal finance and the use of this application is refused and never saved.
"""

from collections.abc import AsyncIterator, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import chat, prompt
from app.agents.events import ProviderEvent, TextDelta, Turn
from app.core.errors import ValidationAppError
from app.models.user import User
from app.schemas.agent import INSTRUCTIONS_MAX_LENGTH as MAX_LENGTH
from app.services.agent_chat import _resolve_provider

# Enough for the classifier's one-sentence reason; longer means it ignored the
# format and the text is rejected anyway.
MAX_REASON_LENGTH = 200

Streamer = Callable[..., AsyncIterator[ProviderEvent]]


async def _classify(
    db: AsyncSession, user_id: UUID, text: str, locale: str, streamer: Streamer | None
) -> tuple[bool, str]:
    """Return (allowed, reason). Raises when no provider can run the check."""
    credential = await _resolve_provider(db, user_id, None)
    parts: list[str] = []
    # Resolved here rather than as a default argument so the provider call stays
    # patchable at runtime.
    async for event in (streamer or chat.stream_turn)(
        credential,
        prompt.INSTRUCTIONS_VALIDATION_PROMPT,
        [Turn(role="user", text=prompt.build_validation_turn(text, locale))],
        [],
    ):
        if isinstance(event, TextDelta):
            parts.append(event.text)

    # Fail closed: only a bare ALLOW verdict passes. A refusal, an empty stream,
    # or a model that ignored the format all read as "not approved".
    # ponytail: a candidate that talks the classifier into emitting ALLOW gets
    # through. The blast radius is the author's own account - tools stay
    # user-scoped and writes still need confirmation - so this is accepted.
    lines = [line.strip() for line in "".join(parts).strip().splitlines() if line.strip()]
    if lines and lines[0].upper() == prompt.VALIDATION_ALLOW:
        return True, ""
    reason = lines[1] if len(lines) > 1 else ""
    return False, reason[:MAX_REASON_LENGTH]


def get(user: User) -> str | None:
    """Return the user's stored instructions."""
    return user.ai_custom_instructions


async def save(
    db: AsyncSession,
    user: User,
    text: str,
    *,
    streamer: Streamer | None = None,
) -> str | None:
    """Validate and store the user's instructions, or raise if they are refused."""
    cleaned = text.strip()
    if len(cleaned) > MAX_LENGTH:
        raise ValidationAppError(code=prompt.INSTRUCTIONS_REJECTED_CODE)
    stored = user.ai_custom_instructions

    # Clearing must always work, including while no provider is reachable -
    # otherwise a broken provider would trap text the user wants removed.
    if not cleaned:
        if stored is not None:
            user.ai_custom_instructions = None
            await db.commit()
        return None

    if cleaned == stored:
        return stored

    allowed, reason = await _classify(db, user.id, cleaned, user.locale, streamer)
    if not allowed:
        raise ValidationAppError(
            code=prompt.INSTRUCTIONS_REJECTED_CODE,
            params={"reason": reason} if reason else {},
        )

    user.ai_custom_instructions = cleaned
    await db.commit()
    return cleaned
