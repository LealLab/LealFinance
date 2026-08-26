"""Shared Pydantic building blocks used across domain DTOs."""

from decimal import Decimal
from typing import Annotated, ClassVar, Literal

from pydantic import BaseModel, BeforeValidator, Field, model_validator


def _uppercase_currency_code(value: object) -> object:
    return value.upper() if isinstance(value, str) else value


CurrencyCodeInput = Annotated[
    str,
    BeforeValidator(_uppercase_currency_code),
    Field(min_length=3, max_length=3),
]


class PatchModel(BaseModel):
    """Distinguish an omitted PATCH field from an explicit JSON null."""

    non_nullable_fields: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _reject_null_required_fields(cls, data: object) -> object:
        if isinstance(data, dict):
            null_fields = sorted(
                field for field in cls.non_nullable_fields if field in data and data[field] is None
            )
            if null_fields:
                raise ValueError(f"fields may not be null: {', '.join(null_fields)}")
        return data


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
    "apple",
    "baby",
    "banknote",
    "basket",
    "bed",
    "beer",
    "bell",
    "bike",
    "bitcoin",
    "book",
    "bookmark",
    "briefcase",
    "building",
    "bus",
    "cake",
    "calculator",
    "calendar",
    "camera",
    "car",
    "cart",
    "clock",
    "cloud",
    "coffee",
    "coins",
    "creditCard",
    "droplet",
    "dumbbell",
    "film",
    "firstAid",
    "flag",
    "flame",
    "folder",
    "fuel",
    "gamepad",
    "gem",
    "gift",
    "glasses",
    "graduationCap",
    "hammer",
    "handCoins",
    "headphones",
    "heart",
    "invoice",
    "key",
    "laptop",
    "leaf",
    "lightbulb",
    "lock",
    "luggage",
    "mail",
    "mapPin",
    "music",
    "package",
    "palette",
    "parking",
    "paw",
    "percent",
    "phone",
    "pieChart",
    "pill",
    "pizza",
    "plane",
    "plug",
    "receipt",
    "safe",
    "scale",
    "scissors",
    "shield",
    "shirt",
    "shoppingBag",
    "smartphone",
    "sneaker",
    "sofa",
    "sparkles",
    "star",
    "stethoscope",
    "ticket",
    "tools",
    "tooth",
    "train",
    "trendingDown",
    "trendingUp",
    "truck",
    "tv",
    "umbrella",
    "user",
    "users",
    "utensils",
    "wifi",
    "wine",
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
