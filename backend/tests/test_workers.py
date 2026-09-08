"""Celery worker maintenance tasks."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Session
from app.workers.tasks.auth import _prune_expired_auth
from tests.factories import make_user


async def test_prune_expired_auth_removes_expired_sessions_only(
    db_session: AsyncSession,
) -> None:
    user, _ = await make_user(db_session, email="worker-auth@example.com")
    now = datetime(2026, 1, 1, tzinfo=UTC)
    expired = Session(
        user_id=user.id,
        token_hash="expired".ljust(64, "0"),
        csrf_token_hash="expired-csrf".ljust(64, "0"),
        expires_at=now - timedelta(seconds=1),
    )
    live = Session(
        user_id=user.id,
        token_hash="live".ljust(64, "0"),
        csrf_token_hash="live-csrf".ljust(64, "0"),
        expires_at=now + timedelta(days=1),
    )
    db_session.add_all([expired, live])
    await db_session.flush()

    await _prune_expired_auth(db_session, now=now)

    remaining = list((await db_session.scalars(select(Session))).all())
    assert [session.id for session in remaining] == [live.id]
