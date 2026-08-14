"""User and preferences DTOs.

Password hashes never appear here - UserRead is the only shape a user row
is ever serialized as.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    role: str
    is_active: bool
    created_at: datetime


class UserUpdate(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=100)


class PreferencesRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    locale: str
    theme: str
    display_currency: str
    balances_hidden: bool


class PreferencesUpdate(BaseModel):
    locale: str | None = Field(default=None, min_length=2, max_length=10)
    theme: str | None = None
    display_currency: str | None = Field(default=None, min_length=3, max_length=3)
    balances_hidden: bool | None = None
