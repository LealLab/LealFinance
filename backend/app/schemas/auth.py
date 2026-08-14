"""Login, registration, and invitation DTOs."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class RegisterRequest(BaseModel):
    email: EmailStr
    token: str = Field(min_length=1)
    password: str = Field(min_length=12)
    display_name: str = Field(min_length=1, max_length=100)


class InvitationCreate(BaseModel):
    email: EmailStr
    role: str = "member"


class InvitationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: str
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class InvitationCreated(InvitationRead):
    """Returned only from POST /auth/invitations - the one place the raw,
    one-time invitation token is ever exposed. See app/models/user.py."""

    token: str
