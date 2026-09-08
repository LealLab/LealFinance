"""Scheduled cleanup for expired authentication state."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, or_
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.models.totp import TrustedDevice
from app.models.user import Session
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _prune_expired_auth(db: AsyncSession, *, now: datetime) -> None:
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
    )
    await db.execute(delete(TrustedDevice).where(TrustedDevice.expires_at < now))


async def _run() -> None:
    engine = create_async_engine(get_settings().sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            await _prune_expired_auth(db, now=datetime.now(UTC))
            await db.commit()
    finally:
        await engine.dispose()


@celery_app.task(name="app.workers.tasks.auth.prune_expired_auth")
def prune_expired_auth() -> str:
    asyncio.run(_run())
    logger.info("prune_expired_auth completed")
    return "pruned expired auth"
