"""Authentication and registration checks for the standalone MCP server.

The auth middleware is exercised directly with a spy downstream app: the
real ``streamable_http_app()`` needs its ASGI lifespan running before it
will serve a request, which is uvicorn's job in production and not what
these tests are about. The 401 and /healthz paths never reach the inner
app, so they go through the assembled ``mcp_server.app``.
"""

from contextlib import asynccontextmanager

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Receive, Scope, Send

import app.mcp.server as mcp_server
from app.agents import tools
from app.core import crypto
from app.models.user import ROLE_ADMIN, ROLE_MEMBER, User
from tests.factories import make_user


@pytest.fixture(autouse=True)
def _shared_session(db_session, monkeypatch):
    @asynccontextmanager
    async def _scope():
        yield db_session

    monkeypatch.setattr(mcp_server, "session_scope", _scope)


class _SpyApp:
    """Downstream ASGI app that records whether the middleware forwarded to
    it and replies 200 so the caller sees a non-401 status."""

    def __init__(self) -> None:
        self.called = False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        self.called = True
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})


async def _call_middleware(spy: _SpyApp, token: str | None) -> int:
    middleware = mcp_server._BearerAuth(spy)
    headers = [(b"authorization", f"Bearer {token}".encode())] if token else []
    status: dict[str, int] = {}

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, object]) -> None:
        if message["type"] == "http.response.start":
            status["code"] = int(message["status"])

    await middleware(
        {"type": "http", "method": "GET", "path": "/mcp", "headers": headers}, receive, send
    )
    return status["code"]


async def _get_real(path: str, token: str | None = None) -> httpx.Response:
    transport = httpx.ASGITransport(app=mcp_server.app)
    headers = {"Authorization": f"Bearer {token}"} if token else None
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path, headers=headers)


async def _user_token(
    db_session: AsyncSession, *, enabled: bool, active: bool = True, role: str = ROLE_MEMBER
) -> tuple[User, str]:
    user, _ = await make_user(
        db_session,
        email=f"mcp-{enabled}-{active}@example.com",
        role=role,
        is_active=active,
    )
    user.ai_chat_enabled = enabled
    await db_session.commit()
    return user, crypto.mint_mcp_token(user.id)


async def test_healthz_is_public() -> None:
    response = await _get_real("/healthz")

    assert response.status_code == 200
    assert response.text == "ok"


async def test_mcp_requires_authorization() -> None:
    spy = _SpyApp()
    assert await _call_middleware(spy, token=None) == 401
    assert spy.called is False


async def test_mcp_rejects_bad_token() -> None:
    spy = _SpyApp()
    assert await _call_middleware(spy, token="garbage") == 401
    assert spy.called is False


async def test_mcp_rejects_expired_token(db_session, monkeypatch: pytest.MonkeyPatch) -> None:
    _, token = await _user_token(db_session, enabled=True)
    monkeypatch.setattr(mcp_server, "MCP_TOKEN_TTL_SECONDS", -1)

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 401
    assert spy.called is False


async def test_mcp_rejects_disabled_chat(db_session) -> None:
    _, token = await _user_token(db_session, enabled=False)

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 401
    assert spy.called is False


async def test_mcp_accepts_active_chat_user(db_session) -> None:
    _, token = await _user_token(db_session, enabled=True)

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 200
    assert spy.called is True


async def test_mcp_accepts_active_admin_without_chat_flag(db_session) -> None:
    _, token = await _user_token(db_session, enabled=False, role=ROLE_ADMIN)

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 200
    assert spy.called is True


async def test_mcp_rejects_inactive_admin(db_session) -> None:
    _, token = await _user_token(db_session, enabled=False, active=False, role=ROLE_ADMIN)

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 401
    assert spy.called is False


def test_registered_tools_match_registry() -> None:
    registered = {tool.name for tool in mcp_server.mcp._tool_manager.list_tools()}

    assert registered == {spec.name for spec in tools.SPECS}
    assert "create_transaction" in registered


async def test_chat_flag_revokes_existing_token(db_session) -> None:
    user, token = await _user_token(db_session, enabled=True)
    assert await _call_middleware(_SpyApp(), token=token) == 200

    user.ai_chat_enabled = False
    await db_session.commit()

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 401
    assert spy.called is False
