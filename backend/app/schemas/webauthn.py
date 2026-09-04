"""Passkey registration and authentication DTOs."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PasskeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    created_at: datetime
    last_used_at: datetime | None


class PasskeyRegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    challenge: str = Field(min_length=1)
    credential: dict[str, Any]


class PasskeyLoginRequest(BaseModel):
    challenge: str = Field(min_length=1)
    credential: dict[str, Any]
