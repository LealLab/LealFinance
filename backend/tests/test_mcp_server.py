"""Authentication and registration checks for the standalone MCP server.

The auth middleware is exercised directly with a spy downstream app: the
real ``streamable_http_app()`` needs its ASGI lifespan running before it
will serve a request, which is uvicorn's job in production and not what
these tests are about. The 401 and /healthz paths never reach the inner
app, so they go through the assembled ``mcp_server.app``.
"""

import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest
from httpx import AsyncClient
from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Receive, Scope, Send

import app.mcp.server as mcp_server
from app.agents import tools
from app.core.config import get_settings
from app.models.category_group import CategoryGroup
from app.models.change_journal import ChangeJournal
from app.models.mcp_token import MCP_SCOPE_READ, MCP_SCOPE_WRITE, McpToken
from app.models.user import ROLE_ADMIN, ROLE_MEMBER, User
from app.services import mcp_tokens
from tests.factories import make_user


@pytest.fixture(autouse=True)
def _shared_session(db_session, monkeypatch, _no_instance_provider_configuration):
    @asynccontextmanager
    async def _scope():
        yield db_session

    monkeypatch.setattr(mcp_server, "session_scope", _scope)
    # conftest turns agents off for every test; the server refuses all traffic
    # then, so these tests opt back in (see test_mcp_refuses_when_agents_disabled).
    monkeypatch.setattr(get_settings(), "agents_enabled", True)


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
    db_session: AsyncSession,
    *,
    enabled: bool,
    active: bool = True,
    role: str = ROLE_MEMBER,
    scope: str = MCP_SCOPE_READ,
) -> tuple[User, str]:
    user, _ = await make_user(
        db_session,
        email=f"mcp-{enabled}-{active}@example.com",
        role=role,
        is_active=active,
    )
    user.ai_chat_enabled = enabled
    await db_session.commit()
    _, raw = await mcp_tokens.create(db_session, user=user, scope=scope, name=None)
    return user, raw


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


async def test_mcp_rejects_expired_token(db_session) -> None:
    _, token = await _user_token(db_session, enabled=True, role=ROLE_ADMIN)
    await db_session.execute(
        update(McpToken).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await db_session.commit()

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 401
    assert spy.called is False


async def test_mcp_rejects_active_member_even_with_chat_enabled(db_session) -> None:
    _, token = await _user_token(db_session, enabled=True)

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 401
    assert spy.called is False


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


async def test_mcp_refuses_when_agents_disabled(db_session, monkeypatch) -> None:
    _, token = await _user_token(db_session, enabled=True)
    monkeypatch.setattr(get_settings(), "agents_enabled", False)

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 404
    assert spy.called is False


def test_registered_tools_match_registry() -> None:
    registered = {tool.name for tool in mcp_server.mcp._tool_manager.list_tools()}

    assert registered == {spec.name for spec in tools.SPECS}
    assert {"undo_changes", "list_recent_changes"} <= registered


async def test_write_tool_runs_journaled_and_can_be_undone(db_session) -> None:
    user, _ = await _user_token(db_session, enabled=True)
    group_id = None
    context = mcp_server._CURRENT_USER.set(user.id)
    scope_context = mcp_server._CURRENT_SCOPE.set(MCP_SCOPE_WRITE)
    try:
        create = mcp_server._make_tool(tools.SPEC_BY_NAME["create_category_group"])
        created = await create.fn(name="Bills", kind="expense")
        group_id = UUID(created["group"]["id"])

        rows = (await db_session.execute(select(ChangeJournal))).scalars().all()
        assert [(row.table_name, row.operation) for row in rows] == [("category_groups", "insert")]
        assert rows[0].agent_call_id.startswith("mcp:")
        assert rows[0].conversation_id is None

        undo = mcp_server._make_tool(tools.SPEC_BY_NAME["undo_changes"])
        result = await undo.fn(call_id=rows[0].agent_call_id)
    finally:
        mcp_server._CURRENT_SCOPE.reset(scope_context)
        mcp_server._CURRENT_USER.reset(context)

    assert result["reverted"] == 1
    remaining = await db_session.scalar(
        select(func.count()).select_from(CategoryGroup).where(CategoryGroup.id == group_id)
    )
    assert remaining == 0


async def test_demoting_admin_revokes_existing_token(db_session) -> None:
    user, token = await _user_token(db_session, enabled=False, role=ROLE_ADMIN)
    assert await _call_middleware(_SpyApp(), token=token) == 200

    user.role = ROLE_MEMBER
    user.ai_chat_enabled = True
    await db_session.commit()

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 401
    assert spy.called is False


async def test_old_stateless_tokens_stop_working(db_session) -> None:
    """The pre-revocation Fernet tokens are not in the table, so they are refused."""
    from cryptography.fernet import Fernet

    await _user_token(db_session, enabled=False, role=ROLE_ADMIN)
    legacy = Fernet(Fernet.generate_key()).encrypt(b"00000000-0000-0000-0000-000000000000")

    spy = _SpyApp()
    assert await _call_middleware(spy, token=legacy.decode()) == 401
    assert spy.called is False


async def test_revoked_token_is_refused_and_logged(
    db_session, caplog: pytest.LogCaptureFixture
) -> None:
    user, token = await _user_token(db_session, enabled=False, role=ROLE_ADMIN)
    assert await _call_middleware(_SpyApp(), token=token) == 200
    row = (await mcp_tokens.list_active(db_session, user.id))[0]
    caplog.set_level(logging.INFO, logger="lealfinance.security")

    await mcp_tokens.revoke(db_session, user_id=user.id, token_id=row.id)

    spy = _SpyApp()
    assert await _call_middleware(spy, token=token) == 401
    assert spy.called is False
    events = [
        r.extra_fields  # type: ignore[attr-defined]
        for r in caplog.records
        if r.name == "lealfinance.security"
    ]
    assert {"mcp_token_revoked", "mcp_token_rejected"} <= {e["event"] for e in events}
    assert token not in str(events)


async def test_last_used_is_set_once_per_window(db_session) -> None:
    user, token = await _user_token(db_session, enabled=False, role=ROLE_ADMIN)
    row = (await mcp_tokens.list_active(db_session, user.id))[0]
    assert row.last_used_at is None

    await _call_middleware(_SpyApp(), token=token)
    await db_session.refresh(row)
    first = row.last_used_at
    assert first is not None

    await _call_middleware(_SpyApp(), token=token)
    await db_session.refresh(row)
    assert row.last_used_at == first

    await db_session.execute(update(McpToken).values(last_used_at=first - timedelta(minutes=10)))
    await db_session.commit()
    await _call_middleware(_SpyApp(), token=token)
    await db_session.refresh(row)
    assert row.last_used_at is not None
    assert row.last_used_at > first


async def test_read_token_cannot_call_write_tools_but_write_token_can(db_session) -> None:
    user, _ = await _user_token(db_session, enabled=False, role=ROLE_ADMIN)
    user_context = mcp_server._CURRENT_USER.set(user.id)
    create = mcp_server._make_tool(tools.SPEC_BY_NAME["create_category_group"])
    try:
        scope_context = mcp_server._CURRENT_SCOPE.set(MCP_SCOPE_READ)
        try:
            with pytest.raises(ToolError, match="read-only"):
                await create.fn(name="Nope", kind="expense")
        finally:
            mcp_server._CURRENT_SCOPE.reset(scope_context)
        scope_context = mcp_server._CURRENT_SCOPE.set(MCP_SCOPE_WRITE)
        try:
            assert (await create.fn(name="Scoped", kind="expense"))["group"]["id"]
        finally:
            mcp_server._CURRENT_SCOPE.reset(scope_context)
    finally:
        mcp_server._CURRENT_USER.reset(user_context)

    names = (
        await db_session.scalars(select(CategoryGroup.name).where(CategoryGroup.user_id == user.id))
    ).all()
    assert "Scoped" in names
    assert "Nope" not in names


async def test_every_write_tool_is_refused_for_a_read_token(db_session) -> None:
    user, _ = await _user_token(db_session, enabled=False, role=ROLE_ADMIN)
    write_specs = [spec for spec in tools.SPECS if spec.writes]
    assert {"remember", "undo_changes", "delete_entity"} <= {spec.name for spec in write_specs}

    user_context = mcp_server._CURRENT_USER.set(user.id)
    scope_context = mcp_server._CURRENT_SCOPE.set(MCP_SCOPE_READ)
    try:
        for spec in write_specs:
            with pytest.raises(ToolError, match="read-only"):
                await mcp_server._make_tool(spec).fn()
    finally:
        mcp_server._CURRENT_SCOPE.reset(scope_context)
        mcp_server._CURRENT_USER.reset(user_context)


async def test_read_token_is_not_shown_write_tools() -> None:
    all_names = {spec.name for spec in tools.SPECS}
    write_names = {spec.name for spec in tools.SPECS if spec.writes}

    context = mcp_server._CURRENT_SCOPE.set(MCP_SCOPE_READ)
    try:
        read_listing = {tool.name for tool in await mcp_server.mcp.list_tools()}
    finally:
        mcp_server._CURRENT_SCOPE.reset(context)
    context = mcp_server._CURRENT_SCOPE.set(MCP_SCOPE_WRITE)
    try:
        write_listing = {tool.name for tool in await mcp_server.mcp.list_tools()}
    finally:
        mcp_server._CURRENT_SCOPE.reset(context)

    assert read_listing == all_names - write_names
    assert write_listing == all_names
    # With no authenticated scope at all, the listing fails closed.
    assert {tool.name for tool in await mcp_server.mcp.list_tools()} == all_names - write_names


@pytest.mark.parametrize("how", ["deactivate", "demote", "password_change", "recovery"])
async def test_security_changes_revoke_every_token_of_the_user(db_session, how: str) -> None:
    from app.services import auth

    admin, password = await make_user(db_session, email=f"rev-{how}@example.com", role=ROLE_ADMIN)
    other, _ = await make_user(db_session, email=f"rev-other-{how}@example.com", role=ROLE_ADMIN)
    first, first_raw = await mcp_tokens.create(db_session, user=admin, scope="write", name=how)
    second, second_raw = await mcp_tokens.create(db_session, user=admin, scope="read", name=None)
    untouched, untouched_raw = await mcp_tokens.create(
        db_session, user=other, scope="read", name=None
    )

    async def update_user(**changes: object) -> None:
        values: dict[str, object] = {
            "role": None,
            "is_active": None,
            "display_name": None,
            "ai_chat_enabled": None,
        }
        await auth.update_user(
            db_session,
            actor=admin,
            target_id=admin.id,
            **{**values, **changes},  # type: ignore[arg-type]
        )

    if how == "deactivate":
        await update_user(is_active=False)
        await update_user(is_active=True)
    elif how == "demote":
        await update_user(role=ROLE_MEMBER)
        await update_user(role=ROLE_ADMIN)
    elif how == "password_change":
        issued = await auth.login(db_session, email=admin.email, password=password)
        await auth.change_password(
            db_session,
            user=admin,
            current_session=issued.session,
            current_password=password,
            new_password="a brand new sufficiently long password",
        )
    else:
        await _recover_password(db_session, admin)

    # Even after re-activation / re-promotion the old tokens stay dead.
    assert await mcp_tokens.authenticate(db_session, first_raw) is None
    assert await mcp_tokens.authenticate(db_session, second_raw) is None
    await db_session.refresh(first)
    await db_session.refresh(second)
    assert first.revoked_at is not None
    assert second.revoked_at is not None
    assert await mcp_tokens.authenticate(db_session, untouched_raw) is not None
    await db_session.refresh(untouched)
    assert untouched.revoked_at is None


async def _recover_password(db_session: AsyncSession, user: User) -> None:
    """Password recovery needs a confirmed authenticator code, so enrol one."""
    from app.core import totp
    from app.core.crypto import encrypt_secret
    from app.services import auth

    secret = totp.generate_secret()
    user.totp_secret_ciphertext = encrypt_secret(secret)
    user.totp_confirmed_at = datetime.now(UTC)
    await db_session.commit()
    code = totp._totp(secret).generate(int(datetime.now(UTC).timestamp())).decode("ascii")
    await auth.recover_password(
        db_session,
        email=user.email,
        code=code,
        new_password="a brand new sufficiently long password",
    )
