"""Identity business logic: invitations, registration, login/logout, users,
and preferences.

Registration is invite-only, except the very first user: when the users
table is empty, POST /auth/register accepts a request with no invitation
token and mints that user as the administrator (see register() below).
Everyone after that goes through POST /auth/invitations. Services here raise
AppError subclasses directly (see app/core/errors.py) so routers stay a thin
call-then-serialize layer, matching app/services/exchange_rates.py's
existing style.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    ValidationAppError,
)
from app.core.security import (
    generate_token,
    hash_password,
    hash_token,
    normalize_email,
    verify_password,
)
from app.models.currency import Currency
from app.models.user import ROLE_ADMIN, ROLES, THEMES, Invitation, Session, User
from app.services import default_categories
from app.services.currencies import get_active_currency

_SESSION_TOUCH_INTERVAL = timedelta(minutes=5)
_LAST_ADMIN_LOCK_KEY = 0x4C4641444D494E
_BOOTSTRAP_LOCK_KEY = 0x4C46424F4F54

# Verified on every login attempt for an email that doesn't match any user,
# so a nonexistent account and a wrong password take indistinguishable
# time - timing alone shouldn't reveal whether an email is registered.
# Computed once at import time (argon2 hashing is deliberately slow).
_DUMMY_PASSWORD_HASH = hash_password("lealfinance-dummy-password-for-timing-safety")


@dataclass(frozen=True)
class IssuedSession:
    session: Session
    user: User
    token: str
    csrf_token: str


@dataclass(frozen=True)
class IssuedInvitation:
    invitation: Invitation
    token: str


# --- Sessions -----------------------------------------------------------------


async def _mint_session(db: AsyncSession, *, user: User) -> IssuedSession:
    settings = get_settings()
    token = generate_token()
    csrf_token = generate_token()
    now = datetime.now(UTC)
    session = Session(
        user_id=user.id,
        token_hash=hash_token(token),
        csrf_token_hash=hash_token(csrf_token),
        expires_at=now + timedelta(days=settings.session_ttl_days),
        last_seen_at=now,
    )
    db.add(session)
    await db.flush()
    return IssuedSession(session=session, user=user, token=token, csrf_token=csrf_token)


async def login(db: AsyncSession, *, email: str, password: str) -> IssuedSession:
    normalized = normalize_email(email)
    result = await db.execute(select(User).where(User.normalized_email == normalized))
    user = result.scalars().first()

    if user is None:
        verify_password(password, _DUMMY_PASSWORD_HASH)
        raise UnauthorizedError(code="auth.invalid_credentials")
    if not verify_password(password, user.password_hash):
        raise UnauthorizedError(code="auth.invalid_credentials")
    if not user.is_active:
        raise UnauthorizedError(code="auth.account_inactive")

    issued = await _mint_session(db, user=user)
    await db.commit()
    return issued


async def get_valid_session(db: AsyncSession, token: str) -> Session:
    result = await db.execute(select(Session).where(Session.token_hash == hash_token(token)))
    session = result.scalars().first()
    now = datetime.now(UTC)
    if session is None or session.revoked_at is not None or session.expires_at < now:
        raise UnauthorizedError(code="auth.session_invalid")
    return session


async def touch_session(db: AsyncSession, session: Session) -> None:
    """Bumps last_seen_at, throttled so a normal page load doesn't cost a
    write on every single request."""
    now = datetime.now(UTC)
    if now - session.last_seen_at < _SESSION_TOUCH_INTERVAL:
        return
    session.last_seen_at = now
    await db.commit()


async def revoke_session(db: AsyncSession, session: Session) -> None:
    session.revoked_at = datetime.now(UTC)
    await db.commit()


# --- Invitations ----------------------------------------------------------------


async def create_invitation(
    db: AsyncSession, *, inviter: User, email: str, role: str
) -> IssuedInvitation:
    if role not in ROLES:
        raise ValidationAppError(code="auth.invalid_role")

    normalized = normalize_email(email)

    existing_user = await db.execute(select(User).where(User.normalized_email == normalized))
    if existing_user.scalars().first() is not None:
        raise ConflictError(code="user.email_taken")

    pending = await db.execute(
        select(Invitation).where(
            Invitation.normalized_email == normalized,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
    )
    if pending.scalars().first() is not None:
        raise ConflictError(code="invitation.already_pending")

    token = generate_token()
    settings = get_settings()
    invitation = Invitation(
        email=email.strip(),
        normalized_email=normalized,
        role=role,
        token_hash=hash_token(token),
        expires_at=datetime.now(UTC) + timedelta(days=settings.invitation_ttl_days),
        invited_by=inviter.id,
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)
    return IssuedInvitation(invitation=invitation, token=token)


async def list_invitations(db: AsyncSession) -> list[Invitation]:
    result = await db.execute(select(Invitation).order_by(Invitation.created_at.desc()))
    return list(result.scalars().all())


async def revoke_invitation(db: AsyncSession, invitation_id: UUID) -> Invitation:
    invitation = await db.get(Invitation, invitation_id)
    if invitation is None:
        raise NotFoundError(code="invitation.not_found")
    if invitation.accepted_at is not None:
        raise ConflictError(code="invitation.already_accepted")
    invitation.revoked_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(invitation)
    return invitation


async def _resolve_invitation(db: AsyncSession, *, email: str, token: str) -> Invitation:
    result = await db.execute(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    invitation = result.scalars().first()
    # A wrong token and a right token for the wrong email are both reported
    # as "not found" - neither should let a caller distinguish "token
    # exists but is for someone else" from "token doesn't exist at all".
    if invitation is None or invitation.normalized_email != normalize_email(email):
        raise NotFoundError(code="invitation.not_found")
    if invitation.revoked_at is not None:
        raise ConflictError(code="invitation.revoked")
    if invitation.accepted_at is not None:
        raise ConflictError(code="invitation.already_accepted")
    if invitation.expires_at < datetime.now(UTC):
        raise ConflictError(code="invitation.expired")
    return invitation


async def needs_setup(db: AsyncSession) -> bool:
    """True while the instance has no users - the one window in which
    registration is allowed without an invitation."""
    return await db.scalar(select(User.id).limit(1)) is None


async def register(
    db: AsyncSession,
    *,
    email: str,
    token: str | None,
    password: str,
    display_name: str,
    base_currency: str = "USD",
    locale: str = "en-US",
) -> IssuedSession:
    invitation: Invitation | None = None
    if token:
        invitation = await _resolve_invitation(db, email=email, token=token)
        role = invitation.role
    else:
        # Serialize the bootstrap path so two concurrent token-less requests
        # can't both observe an empty users table and both mint an admin.
        # The emptiness check below must happen after the lock is held.
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _BOOTSTRAP_LOCK_KEY})
        if not await needs_setup(db):
            # Same "not_found" as an unknown/wrong invitation token - a
            # missing token shouldn't disclose whether the instance is
            # already set up.
            raise NotFoundError(code="invitation.not_found")
        role = ROLE_ADMIN

    normalized = normalize_email(email)
    existing = await db.execute(select(User).where(User.normalized_email == normalized))
    if existing.scalars().first() is not None:
        raise ConflictError(code="user.email_taken")

    currency = await get_active_currency(db, base_currency)

    user = User(
        email=email.strip(),
        normalized_email=normalized,
        password_hash=hash_password(password),
        display_name=display_name.strip(),
        role=role,
        locale=locale,
        base_currency=currency.code,
        display_currency=currency.code,
    )
    db.add(user)
    if invitation is not None:
        invitation.accepted_at = datetime.now(UTC)
    await db.flush()  # assigns user.id, needed by _mint_session below
    await default_categories.seed_default_categories(db, user.id, locale)

    # User creation, invitation acceptance, and session creation are one
    # transaction - a half-accepted invitation is not a reachable state.
    issued = await _mint_session(db, user=user)
    await db.commit()
    return issued


# --- Users & preferences ---------------------------------------------------------


async def list_users(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.created_at))
    return list(result.scalars().all())


async def update_user(
    db: AsyncSession,
    *,
    actor: User,
    target_id: UUID,
    role: str | None,
    is_active: bool | None,
    display_name: str | None,
) -> User:
    if (role is not None and role != ROLE_ADMIN) or is_active is False:
        # Serialize every transition that could remove an active admin. The
        # target and remaining-admin count must both be read after the lock;
        # otherwise two concurrent requests can each observe the other admin.
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _LAST_ADMIN_LOCK_KEY})

    user = await db.scalar(select(User).where(User.id == target_id).with_for_update())
    if user is None:
        raise NotFoundError(code="user.not_found")

    # An admin may change their own privileges (subject to the last-admin
    # rule below) or a member's, but never another admin's - only the
    # affected fields are gated, so renaming a peer admin is still allowed.
    changes_privilege = (role is not None and role != user.role) or (
        is_active is not None and is_active != user.is_active
    )
    if user.id != actor.id and user.role == ROLE_ADMIN and changes_privilege:
        raise ForbiddenError(code="auth.peer_admin")

    demoting = role is not None and role != ROLE_ADMIN and user.role == ROLE_ADMIN
    deactivating = is_active is False and user.is_active
    if user.role == ROLE_ADMIN and user.is_active and (demoting or deactivating):
        remaining = await db.execute(
            select(func.count(User.id)).where(
                User.role == ROLE_ADMIN, User.is_active.is_(True), User.id != user.id
            )
        )
        if remaining.scalar_one() == 0:
            raise ConflictError(code="auth.last_admin")

    if role is not None:
        if role not in ROLES:
            raise ValidationAppError(code="auth.invalid_role")
        user.role = role
    if is_active is not None:
        user.is_active = is_active
    if display_name is not None:
        user.display_name = display_name.strip()

    await db.commit()
    await db.refresh(user)
    return user


async def update_preferences(
    db: AsyncSession,
    *,
    user: User,
    locale: str | None,
    theme: str | None,
    display_currency: str | None,
    investments_enabled: bool | None,
    balances_hidden: bool | None,
) -> User:
    if theme is not None and theme not in THEMES:
        raise ValidationAppError(code="auth.invalid_theme")

    if display_currency is not None:
        code = display_currency.upper()
        currency = await db.get(Currency, code)
        if currency is None:
            raise NotFoundError(code="currency.not_found")
        user.display_currency = code

    if locale is not None:
        user.locale = locale
    if theme is not None:
        user.theme = theme
    if investments_enabled is not None:
        user.investments_enabled = investments_enabled
    if balances_hidden is not None:
        user.balances_hidden = balances_hidden

    await db.commit()
    await db.refresh(user)
    return user
