"""Shared FastAPI dependencies."""

import secrets
from typing import Annotated

from fastapi import Cookie, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cookies import CSRF_HEADER_NAME, SESSION_COOKIE_NAME
from app.core.db import get_session
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.security import hash_token
from app.models.user import ROLE_ADMIN, User
from app.models.user import Session as UserSession
from app.services import auth as auth_service

DbSession = Annotated[AsyncSession, Depends(get_session)]

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


async def get_current_session(
    request: Request,
    db: DbSession,
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
    csrf_header: Annotated[str | None, Header(alias=CSRF_HEADER_NAME)] = None,
) -> tuple[User, UserSession]:
    """Resolves the session cookie to its user, enforcing expiry/revocation
    and - for any state-changing request - the CSRF double-submit check.

    The CSRF check is folded into this dependency rather than offered as a
    separate `Depends(verify_csrf)` so every authenticated mutating route is
    protected by construction: a router that forgot to add a bolt-on CSRF
    dependency would otherwise be a silent hole.
    """
    if session_token is None:
        raise UnauthorizedError()

    session = await auth_service.get_valid_session(db, session_token)

    is_csrf_valid = csrf_header is not None and secrets.compare_digest(
        hash_token(csrf_header), session.csrf_token_hash
    )
    if request.method not in _SAFE_METHODS and not is_csrf_valid:
        raise ForbiddenError(code="auth.csrf_invalid")

    user = await db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise UnauthorizedError(code="auth.account_inactive")

    await auth_service.touch_session(db, session)

    return user, session


CurrentSession = Annotated[tuple[User, UserSession], Depends(get_current_session)]


async def get_current_user(pair: CurrentSession) -> User:
    return pair[0]


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != ROLE_ADMIN:
        raise ForbiddenError(code="auth.admin_required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


async def require_ai_chat(user: CurrentUser) -> User:
    if not user.ai_chat_enabled:
        raise ForbiddenError(code="agents.chat_not_allowed")
    return user


AiChatUser = Annotated[User, Depends(require_ai_chat)]
