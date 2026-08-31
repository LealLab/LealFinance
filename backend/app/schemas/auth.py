"""Login, registration, and invitation DTOs."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.common import CurrencyCodeInput


class LoginRequest(BaseModel):
    """Both phases of login post to the same endpoint.

    When the account has TOTP on and the browser isn't trusted, /auth/login
    answers 401 auth.totp_required and the client resubmits this same body
    with `totp_code` filled in. Carrying the password twice keeps the server
    free of any pending-login state - no challenge token to mint, expire, or
    clean up.
    """

    email: EmailStr
    password: str = Field(min_length=1)
    # Also accepts a backup code, which is longer than six digits.
    totp_code: str | None = Field(default=None, max_length=64)
    trust_device: bool = False


class RegisterRequest(BaseModel):
    email: EmailStr
    token: str | None = None
    password: str = Field(min_length=12)
    display_name: str = Field(min_length=1, max_length=100)
    base_currency: CurrencyCodeInput = "USD"
    locale: str = Field(default="en-US", min_length=2, max_length=10)


class SetupStatus(BaseModel):
    needs_setup: bool


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


class TotpStatus(BaseModel):
    enabled: bool
    backup_codes_remaining: int


class TotpSetupResponse(BaseModel):
    """The enrollment secret, returned only from POST /auth/totp/setup and
    only until it is confirmed. `otpauth_uri` is what the QR code encodes;
    `secret` is the same value for users typing it in by hand."""

    secret: str
    otpauth_uri: str


class TotpCodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class BackupCodesResponse(BaseModel):
    """Shown exactly once, at enrollment or regeneration - only hashes are
    stored, so there is no endpoint that can list these again."""

    codes: list[str]


class RecoverRequest(BaseModel):
    email: EmailStr
    # A TOTP code or an unused backup code.
    code: str = Field(min_length=1, max_length=64)
    new_password: str = Field(min_length=12)
