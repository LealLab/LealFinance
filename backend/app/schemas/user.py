"""User and preferences DTOs.

Password hashes never appear here - UserRead is the only shape a user row
is ever serialized as.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import CurrencyCodeInput, PatchModel


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    role: str
    is_active: bool
    ai_chat_enabled: bool
    created_at: datetime


class UserUpdate(PatchModel):
    non_nullable_fields = frozenset({"role", "is_active", "display_name", "ai_chat_enabled"})

    role: str | None = None
    is_active: bool | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    ai_chat_enabled: bool | None = None


class PreferencesRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    locale: str
    theme: str
    base_currency: str
    display_currency: str
    investments_enabled: bool
    balances_hidden: bool


class PreferencesUpdate(PatchModel):
    non_nullable_fields = frozenset(
        {"locale", "theme", "display_currency", "investments_enabled", "balances_hidden"}
    )

    locale: str | None = Field(default=None, min_length=2, max_length=10)
    theme: str | None = None
    display_currency: CurrencyCodeInput | None = None
    investments_enabled: bool | None = None
    balances_hidden: bool | None = None
