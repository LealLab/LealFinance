"""Shared Pydantic building blocks used across domain DTOs."""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

# The frontend's closed icon-name union (shared/ui/icon/icon.ts) - Institution
# and Category both carry one. Kept here rather than duplicated per schema
# so the two can't silently drift apart.
IconName = Literal[
    "home",
    "wallet",
    "swap",
    "tag",
    "target",
    "chart",
    "settings",
    "sun",
    "moon",
    "globe",
    "menu",
    "close",
    "plus",
    "trash",
    "pencil",
    "chevronDown",
    "chevronRight",
    "check",
    "alertTriangle",
    "repeat",
    "archive",
    "arrowUpRight",
    "arrowDownLeft",
    "refresh",
    "search",
    "eye",
    "eyeOff",
    "command",
    "cornerDownLeft",
    "zap",
    "grip",
    "bank",
    "piggy",
]


def serialize_decimal(value: Decimal | None) -> str | None:
    """Amounts/rates are wire-serialized as strings, never JSON numbers -
    see docs/money-and-currency.md. Shared so every DTO's
    `@field_serializer` performs exactly the same conversion."""
    return None if value is None else str(value)


class ArchiveRequest(BaseModel):
    """Body for every `POST /{resource}/{id}/archive` endpoint - archive
    state is set explicitly (matching the frontend's
    `setArchived(id, archived: boolean)` repository methods), not toggled."""

    archived: bool
