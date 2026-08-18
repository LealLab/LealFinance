"""Nightly recurring-rule posting - registered with Celery beat.

The task itself is sync (Celery's worker model isn't async-native, see
app/workers/celery_app.py), but every service it needs
(app/services/recurring_posting.py, and everything that calls) is async.
Rather than writing sync twins of transaction validation and conversion
math, this opens a short-lived async engine per run and drives it with
asyncio.run - a module-level engine would bind pooled connections to
whichever event loop first ran a query, which asyncio.run tears down at
the end of every call.
"""

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.services.recurring_posting import post_all_due_occurrences
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _run() -> int:
    settings = get_settings()
    engine = create_async_engine(settings.sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            return await post_all_due_occurrences(db)
    finally:
        await engine.dispose()


@celery_app.task(name="app.workers.tasks.recurring.post_recurring_transactions")
def post_recurring_transactions() -> str:
    posted = asyncio.run(_run())
    logger.info("post_recurring_transactions posted %d transaction(s)", posted)
    return f"posted {posted}"
