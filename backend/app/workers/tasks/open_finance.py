"""Scheduled Pluggy Open Finance synchronization - registered with Celery beat.

The task is sync (Celery's worker model isn't async-native, see
app/workers/celery_app.py), but the sync service is async. Rather than writing
a sync twin, each run opens a short-lived async engine and drives it with
asyncio.run - a module-level engine would bind pooled connections to a dead
event loop between calls (same reasoning as app/workers/tasks/rates.py).
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.models.open_finance import PluggyItem
from app.services import open_finance_sync
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

STALE_AFTER = timedelta(hours=5)


async def _with_session[T](work: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Run `work` against a short-lived session and commit it. A module-level
    engine would bind pooled connections to a dead event loop between
    asyncio.run calls (see app/workers/tasks/rates.py)."""
    engine = create_async_engine(get_settings().sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            result = await work(db)
            await db.commit()
            return result
    finally:
        await engine.dispose()


async def _sync_stale_items(db: AsyncSession) -> tuple[int, int]:
    stale_before = datetime.now(UTC) - STALE_AFTER
    result = await db.scalars(
        select(PluggyItem).where(
            or_(
                PluggyItem.last_synced_at.is_(None),
                PluggyItem.last_synced_at < stale_before,
            )
        )
    )
    items = [(item.user_id, item.id) for item in result.all()]

    synced = failed = 0
    for user_id, item_id in items:
        try:
            await open_finance_sync.sync_item(db, user_id, item_id)
        except Exception as exc:
            logger.exception("sync_open_finance_items failed for item %s", item_id)
            await db.rollback()
            try:
                failed_item = await db.get(PluggyItem, item_id)
                if failed_item is not None:
                    failed_item.last_sync_error = str(exc)[:200]
                    await db.commit()
            except Exception:
                logger.exception("sync_open_finance_items could not record failure for %s", item_id)
                await db.rollback()
            failed += 1
        else:
            synced += 1
    return synced, failed


@celery_app.task(name="app.workers.tasks.open_finance.sync_open_finance_items")
def sync_open_finance_items() -> str:
    synced, failed = asyncio.run(_with_session(_sync_stale_items))
    logger.info("sync_open_finance_items synced %d item(s), failed %d item(s)", synced, failed)
    return f"synced {synced}, failed {failed}"
