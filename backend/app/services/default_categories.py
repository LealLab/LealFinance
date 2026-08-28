"""Loads app/data/default_categories.json once and seeds a translated
starter set of category groups/categories for a newly registered user."""

import json
from pathlib import Path
from typing import TypedDict, cast
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.category_group import CategoryGroup


class _CategorySpec(TypedDict):
    key: str
    icon: str


class _GroupSpec(TypedDict):
    key: str
    kind: str
    icon: str
    color: str
    categories: list[_CategorySpec]


class _Defaults(TypedDict):
    structure: list[_GroupSpec]
    names: dict[str, dict[str, str]]


_DEFAULTS = cast(
    _Defaults,
    json.loads(
        (Path(__file__).parent.parent / "data" / "default_categories.json").read_text(
            encoding="utf-8"
        )
    ),
)

_KEY_KIND: dict[str, str] = {
    category["key"]: group["kind"]
    for group in _DEFAULTS["structure"]
    for category in group["categories"]
}


def category_kind_for_key(key: str) -> str | None:
    return _KEY_KIND.get(key)


def category_names_for_key(key: str) -> set[str]:
    """Every locale's display name for a default-category key."""
    return {names[key] for names in _DEFAULTS["names"].values() if key in names}


def _resolve_locale_names(locale: str) -> dict[str, str]:
    names = _DEFAULTS["names"]
    if locale in names:
        return names[locale]

    folded_locale = locale.casefold()
    for code, localized_names in names.items():
        if code.casefold() == folded_locale:
            return localized_names

    language = locale.partition("-")[0].casefold()
    candidates = sorted(code for code in names if code.partition("-")[0].casefold() == language)
    return names[candidates[0]] if candidates else names["en-US"]


async def seed_default_categories(db: AsyncSession, user_id: UUID, locale: str) -> None:
    names = _resolve_locale_names(locale)
    groups: list[CategoryGroup] = []
    categories: list[Category] = []

    for group_position, group_spec in enumerate(_DEFAULTS["structure"]):
        group_id = uuid4()
        group = CategoryGroup(
            id=group_id,
            user_id=user_id,
            name=names[group_spec["key"]],
            kind=group_spec["kind"],
            color=group_spec["color"],
            icon=group_spec["icon"],
            position=group_position,
        )
        groups.append(group)

        for category_position, category_spec in enumerate(group_spec["categories"]):
            categories.append(
                Category(
                    user_id=user_id,
                    name=names[category_spec["key"]],
                    kind=group_spec["kind"],
                    group_id=group_id,
                    color=group_spec["color"],
                    icon=category_spec["icon"],
                    position=category_position,
                )
            )

    db.add_all(groups)
    await db.flush()
    db.add_all(categories)
