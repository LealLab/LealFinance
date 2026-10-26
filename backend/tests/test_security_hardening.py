"""Brute-force defences: atomic attempt counting, opaque lockout, single-use
second factors, session revocation on deactivation, security event logging,
and the single-claim rule for AI tool approvals.

The concurrency tests use their own sessions (like
test_concurrent_admin_demotions_leave_one_active_admin in test_auth.py): the
shared `db_session` fixture is one connection, which cannot race.
"""

import asyncio
import logging
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core import totp
from app.core.crypto import encrypt_secret
from app.core.errors import UnauthorizedError
from app.core.security import hash_token
from app.models.agent_conversation import (
    AGENT_CONVERSATION_STATUS_AWAITING,
    AgentConversation,
)
from app.models.currency import Currency
from app.models.totp import TotpBackupCode
from app.models.user import ROLE_ADMIN, User
from app.models.user import Session as UserSession
from app.services import agent_chat
from app.services import auth as auth_service
from tests.factories import DEFAULT_PASSWORD, login_as, make_user
from tests.test_totp import code_for


@pytest_asyncio.fixture
async def concurrent_user(
    _engine: AsyncEngine,
) -> AsyncGenerator[tuple[async_sessionmaker[AsyncSession], UUID, str]]:
    """A committed user plus a session factory, so tests can run requests in
    parallel on separate connections. Cleaned up afterwards."""
    session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    async with session_factory() as setup:
        setup.add(Currency(code="BRL", name="Brazilian Real", symbol="R$", decimal_digits=2))
        setup.add(Currency(code="USD", name="US Dollar", symbol="$", decimal_digits=2))
        await setup.commit()
        user, _password = await make_user(setup, email="parallel@example.com")
        user_id, password_hash = user.id, user.password_hash
    try:
        yield session_factory, user_id, password_hash
    finally:
        async with session_factory() as cleanup:
            await cleanup.execute(delete(User).where(User.id == user_id))
            await cleanup.execute(delete(Currency).where(Currency.code.in_(("BRL", "USD"))))
            await cleanup.commit()


# --- Atomic attempt counting ------------------------------------------------------


async def test_parallel_wrong_passwords_never_get_more_guesses_than_the_limit(
    concurrent_user: tuple[async_sessionmaker[AsyncSession], UUID, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session_factory, user_id, password_hash = concurrent_user
    checked = 0
    real_verify = auth_service.verify_password_async

    async def counting_verify(password: str, candidate_hash: str) -> bool:
        nonlocal checked
        if candidate_hash == password_hash:
            checked += 1
        return await real_verify(password, candidate_hash)

    monkeypatch.setattr(auth_service, "verify_password_async", counting_verify)

    async def guess() -> None:
        async with session_factory() as session:
            with pytest.raises(UnauthorizedError):
                await auth_service.login(
                    session, email="parallel@example.com", password="wrong-password"
                )

    await asyncio.gather(*(guess() for _ in range(20)))

    # Read-then-write counting would let all 20 through to the password check.
    assert checked <= auth_service._PASSWORD_MAX_ATTEMPTS
    async with session_factory() as verify:
        user = await verify.get(User, user_id)
        assert user is not None
        assert user.password_locked_until is not None
        assert user.password_failed_attempts == 0


async def test_the_same_totp_code_cannot_win_twice_in_parallel(
    concurrent_user: tuple[async_sessionmaker[AsyncSession], UUID, str],
) -> None:
    session_factory, user_id, _hash = concurrent_user
    secret = totp.generate_secret()
    async with session_factory() as setup:
        user = await setup.get(User, user_id)
        assert user is not None
        user.totp_secret_ciphertext = encrypt_secret(secret)
        user.totp_confirmed_at = datetime.now(UTC)
        await setup.commit()
    code = code_for(secret)

    async def attempt() -> bool:
        async with session_factory() as session:
            user = await session.get(User, user_id)
            assert user is not None
            try:
                await auth_service._consume_second_factor(session, user=user, code=code)
            except UnauthorizedError:
                return False
            await session.commit()
            return True

    results = await asyncio.gather(attempt(), attempt(), attempt())

    assert sum(results) == 1


async def test_the_same_backup_code_cannot_win_twice_in_parallel(
    concurrent_user: tuple[async_sessionmaker[AsyncSession], UUID, str],
) -> None:
    session_factory, user_id, _hash = concurrent_user
    code = "ABCD-EFGH"
    async with session_factory() as setup:
        user = await setup.get(User, user_id)
        assert user is not None
        user.totp_secret_ciphertext = encrypt_secret(totp.generate_secret())
        user.totp_confirmed_at = datetime.now(UTC)
        setup.add(
            TotpBackupCode(
                user_id=user_id,
                code_hash=hash_token(auth_service._normalize_backup_code(code)),
            )
        )
        await setup.commit()

    async def attempt() -> bool:
        async with session_factory() as session:
            user = await session.get(User, user_id)
            assert user is not None
            try:
                await auth_service._consume_second_factor(session, user=user, code=code)
            except UnauthorizedError:
                return False
            await session.commit()
            return True

    results = await asyncio.gather(attempt(), attempt(), attempt())

    assert sum(results) == 1
    async with session_factory() as verify:
        used = await verify.scalars(
            select(TotpBackupCode).where(
                TotpBackupCode.user_id == user_id, TotpBackupCode.used_at.is_not(None)
            )
        )
        assert len(used.all()) == 1


# --- Opaque lockout ---------------------------------------------------------------


async def test_a_locked_login_looks_exactly_like_an_unknown_email(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="locked-opaque@example.com")
    for _ in range(auth_service._PASSWORD_MAX_ATTEMPTS):
        await client.post("/api/v1/auth/login", json={"email": user.email, "password": "nope"})

    # Even the correct password is refused while locked, and the answer does not
    # say "locked" - that would confirm the address has an account.
    locked = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": password}
    )
    unknown = await client.post(
        "/api/v1/auth/login", json={"email": "nobody-here@example.com", "password": password}
    )

    assert locked.status_code == unknown.status_code == 401
    assert locked.json() == unknown.json()
    assert "lf_session" not in locked.cookies


# --- Deactivation -----------------------------------------------------------------


async def test_deactivating_a_user_revokes_their_sessions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    member, member_password = await make_user(db_session, email="to-deactivate@example.com")
    admin, admin_password = await make_user(
        db_session, email="deactivator@example.com", role=ROLE_ADMIN
    )
    await login_as(client, email=member.email, password=member_password)
    await client.post("/api/v1/auth/logout")  # leaves the cookie jar clean
    await login_as(client, email=member.email, password=member_password)
    await login_as(client, email=admin.email, password=admin_password)

    response = await client.patch(
        f"/api/v1/auth/users/{member.id}",
        json={"display_name": member.display_name, "is_active": False},
    )
    assert response.status_code == 200

    rows = await db_session.scalars(select(UserSession).where(UserSession.user_id == member.id))
    sessions = rows.all()
    assert sessions
    assert all(row.revoked_at is not None for row in sessions)


# --- Security events --------------------------------------------------------------


def _events(caplog: pytest.LogCaptureFixture) -> list[dict[str, object]]:
    return [
        record.extra_fields  # type: ignore[attr-defined]
        for record in caplog.records
        if record.name == "lealfinance.security"
    ]


async def test_failed_and_successful_logins_are_logged_without_the_email(
    client: AsyncClient, db_session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="lealfinance.security")
    user, password = await make_user(db_session, email="logged@example.com")

    await client.post("/api/v1/auth/login", json={"email": user.email, "password": "wrong-one"})
    await client.post(
        "/api/v1/auth/login", json={"email": "typo-password-here@example.com", "password": "x"}
    )
    await client.post("/api/v1/auth/login", json={"email": user.email, "password": password})

    events = _events(caplog)
    by_name = {event["event"]: event for event in events}
    assert by_name["password_failed"]["user_id"] == user.id
    assert by_name["password_failed"]["attempt"] == 1
    assert by_name["login_failed"]["reason"] == "unknown_account"
    assert by_name["login_success"]["user_id"] == user.id
    assert all(event["client_ip"] == "127.0.0.1" for event in events)
    # Neither the address nor the password may ever reach the log.
    dumped = repr(events)
    assert "logged@example.com" not in dumped
    assert "typo-password-here" not in dumped
    assert "wrong-one" not in dumped
    assert password not in dumped


async def test_a_lockout_is_logged_when_it_engages(
    client: AsyncClient, db_session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="lealfinance.security")
    user, _password = await make_user(db_session, email="lockout-log@example.com")

    for _ in range(auth_service._PASSWORD_MAX_ATTEMPTS):
        await client.post("/api/v1/auth/login", json={"email": user.email, "password": "nope"})
    await client.post("/api/v1/auth/login", json={"email": user.email, "password": "nope"})

    names = [event["event"] for event in _events(caplog)]
    assert names.count("password_failed") == auth_service._PASSWORD_MAX_ATTEMPTS
    assert names.count("account_locked") == 1
    assert "password_attempt_while_locked" in names


async def test_a_password_change_is_logged(
    client: AsyncClient, db_session: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="lealfinance.security")
    user, password = await make_user(db_session, email="change-logged@example.com")
    await login_as(client, email=user.email, password=password)

    response = await client.post(
        "/api/v1/auth/password",
        json={"current_password": password, "new_password": DEFAULT_PASSWORD + " changed"},
    )

    assert response.status_code == 204
    assert "password_changed" in [event["event"] for event in _events(caplog)]


# --- AI tool approval claim -------------------------------------------------------


async def test_only_one_of_two_parallel_approvals_claims_the_tool_call(
    concurrent_user: tuple[async_sessionmaker[AsyncSession], UUID, str],
) -> None:
    session_factory, user_id, _hash = concurrent_user
    async with session_factory() as setup:
        conversation = AgentConversation(
            user_id=user_id,
            title="approve me",
            provider="anthropic",
            model="claude-sonnet-5",
            status=AGENT_CONVERSATION_STATUS_AWAITING,
            pending_call_id="call-1",
        )
        setup.add(conversation)
        await setup.commit()
        conversation_id = conversation.id

    async def claim() -> bool:
        async with session_factory() as session:
            return await agent_chat._claim_pending(session, conversation_id, "call-1")

    results = await asyncio.gather(claim(), claim(), claim())
    assert sum(results) == 1

    # A call that did not finish goes back, so the user can approve it again.
    async with session_factory() as session:
        await agent_chat._release_claim(session, conversation_id, "call-1")
    async with session_factory() as session:
        assert await agent_chat._claim_pending(session, conversation_id, "call-1")
