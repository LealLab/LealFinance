"""WebAuthn credentials and one-time ceremony challenges.

Credentials keep the public key and counter needed to verify assertions;
challenges are bound to their user, RP, and origin so a ceremony cannot be
replayed across accounts or origins. These auth tables intentionally declare
``user_id`` inline because authentication can reach them before a current
user exists.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class WebAuthnCredential(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A user's public WebAuthn credential and its replay-detection counter."""

    __tablename__ = "webauthn_credentials"
    __table_args__ = (
        UniqueConstraint("credential_id", name="uq_webauthn_credentials_credential_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_webauthn_credentials_user_id"),
        nullable=False,
        index=True,
    )
    credential_id: Mapped[str] = mapped_column(String(255), nullable=False)
    public_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sign_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    rp_id: Mapped[str] = mapped_column(String(255), nullable=False)
    transports: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebAuthnChallenge(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A single-use, five-minute ceremony nonce stored as base64url as-is.

    py_webauthn needs the original bytes back to verify the signed challenge;
    this is a one-time nonce, not a replayable secret.
    """

    __tablename__ = "webauthn_challenges"
    __table_args__ = (
        UniqueConstraint("challenge", name="uq_webauthn_challenges_challenge"),
        CheckConstraint(
            "purpose IN ('registration', 'authentication')",
            name="ck_webauthn_challenges_purpose",
        ),
    )

    challenge: Mapped[str] = mapped_column(String(256), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_webauthn_challenges_user_id"),
        nullable=True,
        index=True,
    )
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    rp_id: Mapped[str] = mapped_column(String(255), nullable=False)
    origin: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
