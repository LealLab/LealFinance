"""Identity: invitations, registration, login/logout, users, preferences.

Registration is invite-only, except the first user on an instance - see
app/services/auth.py for the bootstrap rule.
"""

from uuid import UUID

from fastapi import APIRouter, Response, status

from app.api.deps import AdminUser, CurrentSession, CurrentUser, DbSession
from app.core.cookies import clear_session_cookies, set_session_cookies
from app.models.user import Invitation, User
from app.schemas.auth import (
    InvitationCreate,
    InvitationCreated,
    InvitationRead,
    LoginRequest,
    RegisterRequest,
    SetupStatus,
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
async def login(payload: LoginRequest, response: Response, db: DbSession) -> User:
    issued = await auth_service.login(db, email=payload.email, password=payload.password)
    set_session_cookies(
        response,
        session_token=issued.token,
        csrf_token=issued.csrf_token,
        expires_at=issued.session.expires_at,
    )
    return issued.user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(pair: CurrentSession, response: Response, db: DbSession) -> None:
    _user, session = pair
    await auth_service.revoke_session(db, session)
    clear_session_cookies(response)


@router.get("/me", response_model=UserRead)
async def get_me(user: CurrentUser) -> User:
    return user


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
        balances_hidden=payload.balances_hidden,
    )
