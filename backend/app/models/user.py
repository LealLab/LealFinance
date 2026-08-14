"""Identity: users, their active sessions, and pending invitations.

Registration is invite-only (see app/services/auth.py) - there is no public
sign-up endpoint. The first administrator is created by a one-time CLI
bootstrap (`python -m app.cli create-admin`, see app/cli/__main__.py), not
through this schema.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.types import CurrencyCode

ROLE_ADMIN = "admin"
ROLE_MEMBER = "member"
ROLES = (ROLE_ADMIN, ROLE_MEMBER)

THEME_LIGHT = "light"
THEME_DARK = "dark"
THEMES = (THEME_LIGHT, THEME_DARK)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An application user.

    Preferences (locale/theme/display currency/balance visibility) live as
    plain columns here rather than a separate table - there's no hot,
    high-frequency path that needs to avoid them, and GET/PATCH
    /auth/preferences just reads and writes a handful of columns on a row
    already keyed by id.
    """

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("normalized_email", name="uq_users_normalized_email"),
        CheckConstraint(_in_check("role", ROLES), name="ck_users_role"),
        CheckConstraint(_in_check("theme", THEMES), name="ck_users_theme"),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    normalized_email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=ROLE_MEMBER)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # --- Preferences (GET/PATCH /auth/preferences) ---
    locale: Mapped[str] = mapped_column(String(10), nullable=False, default="en-US")
    theme: Mapped[str] = mapped_column(String(10), nullable=False, default=THEME_LIGHT)
    display_currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", name="fk_users_display_currency"),
        nullable=False,
        default="BRL",
    )
    balances_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Session(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A logged-in session, identified to the client only by an opaque
    cookie value - only its HMAC hash (see app/core/security.py) is stored,
    so a database dump alone can't be replayed as a valid cookie.

    `csrf_token_hash` binds the double-submit XSRF value to this specific
    session, rather than validating cookie-equals-header alone - see
    app/api/deps.py.
    """

    __tablename__ = "sessions"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_sessions_token_hash"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_sessions_user_id"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    csrf_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Invitation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A one-time, admin-issued invitation.

    The raw token is returned to the admin exactly once, in the create
    response, for out-of-band delivery (there is no email provider in v1) -
    only its hash is ever stored, and it's never included in any later
    response (see InvitationRead vs InvitationCreated in app/schemas/auth.py).
    """

    __tablename__ = "invitations"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_invitations_token_hash"),
        CheckConstraint(_in_check("role", ROLES), name="ck_invitations_role"),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    normalized_email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=ROLE_MEMBER)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # SET NULL rather than RESTRICT: an inviting admin's row is never
    # actually deleted by anything in this app today (only deactivated),
    # but nothing here should ever block a future deletion.
    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_invitations_invited_by"),
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
