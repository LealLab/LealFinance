"""Identity: invitations, registration, login/logout, users, preferences.

Registration is invite-only, except the first user on an instance - see
app/services/auth.py for the bootstrap rule.
"""

from uuid import UUID

from fastapi import APIRouter, Request, Response, status

from app.api.deps import AdminUser, CurrentSession, CurrentUser, DbSession
from app.core.cookies import (
    TRUST_COOKIE_NAME,
    clear_session_cookies,
    clear_trust_cookie,
    set_session_cookies,
    set_trust_cookie,
)
from app.models.user import Invitation, User
from app.schemas.auth import (
    BackupCodesResponse,
    InvitationCreate,
    InvitationCreated,
    InvitationRead,
    LoginRequest,
    RecoverRequest,
    RegisterRequest,
    SetupStatus,
    TotpCodeRequest,
    TotpSetupResponse,
    TotpStatus,
)
from app.schemas.user import PreferencesRead, PreferencesUpdate, UserRead, UserUpdate
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


# --- Invitations (admin only) ----------------------------------------------------


@router.post("/invitations", response_model=InvitationCreated, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    payload: InvitationCreate, admin: AdminUser, db: DbSession
) -> InvitationCreated:
    issued = await auth_service.create_invitation(
        db, inviter=admin, email=payload.email, role=payload.role
    )
    fields = InvitationRead.model_validate(issued.invitation).model_dump()
    return InvitationCreated(**fields, token=issued.token)


@router.get("/invitations", response_model=list[InvitationRead])
async def list_invitations(_admin: AdminUser, db: DbSession) -> list[Invitation]:
    return await auth_service.list_invitations(db)


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(invitation_id: UUID, _admin: AdminUser, db: DbSession) -> None:
    await auth_service.revoke_invitation(db, invitation_id)


# --- Registration & session lifecycle --------------------------------------------


@router.get("/setup-status", response_model=SetupStatus)
async def setup_status(db: DbSession) -> SetupStatus:
    return SetupStatus(needs_setup=await auth_service.needs_setup(db))


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, response: Response, db: DbSession) -> User:
    issued = await auth_service.register(
        db,
        email=payload.email,
        token=payload.token,
        password=payload.password,
        display_name=payload.display_name,
        base_currency=payload.base_currency,
        locale=payload.locale,
    )
    set_session_cookies(
        response,
        session_token=issued.token,
        csrf_token=issued.csrf_token,
        expires_at=issued.session.expires_at,
    )
    return issued.user


@router.post("/login", response_model=UserRead)
async def login(payload: LoginRequest, request: Request, response: Response, db: DbSession) -> User:
    issued = await auth_service.login(
        db,
        email=payload.email,
        password=payload.password,
        totp_code=payload.totp_code,
        trust_device=payload.trust_device,
        trust_token=request.cookies.get(TRUST_COOKIE_NAME),
    )
    set_session_cookies(
        response,
        session_token=issued.token,
        csrf_token=issued.csrf_token,
        expires_at=issued.session.expires_at,
    )
    if issued.trust_token is not None and issued.trust_expires_at is not None:
        set_trust_cookie(response, token=issued.trust_token, expires_at=issued.trust_expires_at)
    return issued.user


@router.post("/recover", status_code=status.HTTP_204_NO_CONTENT)
async def recover(payload: RecoverRequest, response: Response, db: DbSession) -> None:
    """Public, like /login - the caller is by definition locked out, so
    there is no session to carry a CSRF token."""
    await auth_service.recover_password(
        db, email=payload.email, code=payload.code, new_password=payload.new_password
    )
    # Every trusted device was just revoked; drop the now-dead cookie so this
    # browser doesn't keep presenting it.
    clear_trust_cookie(response)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(pair: CurrentSession, response: Response, db: DbSession) -> None:
    _user, session = pair
    await auth_service.revoke_session(db, session)
    clear_session_cookies(response)


@router.get("/me", response_model=UserRead)
async def get_me(user: CurrentUser) -> User:
    return user


# --- Two-factor authentication (current user) -------------------------------------


@router.get("/totp", response_model=TotpStatus)
async def get_totp_status(user: CurrentUser, db: DbSession) -> TotpStatus:
    enabled, remaining = await auth_service.get_totp_status(db, user=user)
    return TotpStatus(enabled=enabled, backup_codes_remaining=remaining)


@router.post("/totp/setup", response_model=TotpSetupResponse)
async def setup_totp(user: CurrentUser, db: DbSession) -> TotpSetupResponse:
    secret, uri = await auth_service.start_totp_enrollment(db, user=user)
    return TotpSetupResponse(secret=secret, otpauth_uri=uri)


@router.post("/totp/enable", response_model=BackupCodesResponse)
async def enable_totp(
    payload: TotpCodeRequest, user: CurrentUser, db: DbSession
) -> BackupCodesResponse:
    codes = await auth_service.confirm_totp(db, user=user, code=payload.code)
    return BackupCodesResponse(codes=codes)


@router.post("/totp/backup-codes", response_model=BackupCodesResponse)
async def regenerate_backup_codes(
    payload: TotpCodeRequest, user: CurrentUser, db: DbSession
) -> BackupCodesResponse:
    codes = await auth_service.regenerate_backup_codes(db, user=user, code=payload.code)
    return BackupCodesResponse(codes=codes)


# POST, not DELETE: turning 2FA off requires a current code in the body, and
# DELETE with a body is poorly supported across clients and proxies.
@router.post("/totp/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable_totp(
    payload: TotpCodeRequest, user: CurrentUser, response: Response, db: DbSession
) -> None:
    await auth_service.disable_totp(db, user=user, code=payload.code)
    clear_trust_cookie(response)


# --- Users (admin only) -----------------------------------------------------------


@router.get("/users", response_model=list[UserRead])
async def list_users(_admin: AdminUser, db: DbSession) -> list[User]:
    return await auth_service.list_users(db)


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(user_id: UUID, payload: UserUpdate, admin: AdminUser, db: DbSession) -> User:
    return await auth_service.update_user(
        db,
        actor=admin,
        target_id=user_id,
        role=payload.role,
        is_active=payload.is_active,
        display_name=payload.display_name,
        ai_chat_enabled=payload.ai_chat_enabled,
    )


# --- Preferences (current user) ---------------------------------------------------


@router.get("/preferences", response_model=PreferencesRead)
async def get_preferences(user: CurrentUser) -> User:
    return user


@router.patch("/preferences", response_model=PreferencesRead)
async def update_preferences(payload: PreferencesUpdate, user: CurrentUser, db: DbSession) -> User:
    return await auth_service.update_preferences(
        db,
        user=user,
        locale=payload.locale,
        theme=payload.theme,
        display_currency=payload.display_currency,
        investments_enabled=payload.investments_enabled,
        balances_hidden=payload.balances_hidden,
    )
