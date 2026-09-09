"""Scheduled cleanup for expired authentication state."""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import and_, delete, or_
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.models.totp import TrustedDevice
from app.models.user import Session
from app.services.posting_result import PostingResult
from app.workers.celery_app import celery_app
from app.workers.runner import run_job


async def _prune_expired_auth(db: AsyncSession, *, now: datetime) -> int:
    sessions = cast(
        CursorResult[Any],
        await db.execute(
            delete(Session).where(
                or_(
                    Session.expires_at < now,
                    and_(
                        Session.revoked_at.is_not(None),
                        Session.revoked_at < now - timedelta(days=30),
                    ),
                )
            )
        ),
    )
    devices = cast(
        CursorResult[Any],
        await db.execute(delete(TrustedDevice).where(TrustedDevice.expires_at < now)),
    )
    return (sessions.rowcount or 0) + (devices.rowcount or 0)


async def _run() -> PostingResult:
    engine = create_async_engine(get_settings().sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            deleted = await _prune_expired_auth(db, now=datetime.now(UTC))
            await db.commit()
            return PostingResult(deleted, 0)
    finally:
        await engine.dispose()


@celery_app.task(name="app.workers.tasks.auth.prune_expired_auth")
def prune_expired_auth() -> str:
    return run_job("app.workers.tasks.auth.prune_expired_auth", _run)
