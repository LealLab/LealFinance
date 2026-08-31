"""Second-factor storage: single-use backup codes and remembered devices.

Both tables mirror Session in app/models/user.py - the value handed to the
user is opaque and random, and only its HMAC hash (app/core/security.py) is
persisted, so a database dump alone yields nothing replayable.

The TOTP shared secret itself is deliberately *not* here: it has to be read
back to verify a code, so it lives on `users` encrypted with app/core/crypto.py
rather than hashed, the same trade-off agent_credential.py makes.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class TotpBackupCode(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One single-use code from the set issued at enrollment.

    Rows are kept after use rather than deleted so a spent code can be
    recognised as spent instead of falling through to "no such code".
    """

    __tablename__ = "totp_backup_codes"
    __table_args__ = (UniqueConstraint("code_hash", name="uq_totp_backup_codes_code_hash"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_totp_backup_codes_user_id"),
        nullable=False,
        index=True,
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TrustedDevice(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A browser the user explicitly ticked "trust this device" on while
    answering a TOTP challenge, which then skips the challenge until it
    expires.

    Trust is opt-in per login: without the tick no row is created and the
    next sign-in is challenged again. Password recovery and disabling TOTP
    both revoke every row for the user, so a device an attacker trusted
    cannot outlive the recovery that locked them out.
    """

    __tablename__ = "trusted_devices"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_trusted_devices_token_hash"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_trusted_devices_user_id"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
