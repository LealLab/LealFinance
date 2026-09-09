"""Scheduled exchange-rate maintenance - registered with Celery beat.

`refresh_exchange_rates` pulls today's USD-anchored rates from the provider
into the cache every few hours; `backfill_fallback_conversions` runs nightly
to re-resolve transactions that were recorded at the 1:1 fallback before a
provider key existed. Both no-op cleanly without OPENEXCHANGERATES_APP_ID.

The tasks are sync (Celery's worker model isn't async-native, see
app/workers/celery_app.py) but the services they call are async. Rather than
sync twins, each run opens a short-lived async engine and drives it with
asyncio.run - a module-level engine would bind pooled connections to
whichever event loop first ran a query, which asyncio.run tears down at the
end of every call (same reasoning as app/workers/tasks/recurring.py).
"""

from collections.abc import Awaitable, Callable
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.services.exchange_rates import refresh_rates
from app.services.posting_result import PostingResult
from app.services.rate_backfill import backfill_fallback_conversions
from app.workers.celery_app import celery_app
from app.workers.runner import run_job


async def _with_session[T](work: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Run `work` against a short-lived session and commit it. A module-level
    engine would bind pooled connections to a dead event loop between
    asyncio.run calls (see app/workers/tasks/recurring.py)."""
    engine = create_async_engine(get_settings().sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            result = await work(db)
            await db.commit()
            return result
    finally:
        await engine.dispose()


async def _run_refresh() -> PostingResult:
    count = await _with_session(lambda db: refresh_rates(db, date.today()))
    return PostingResult(count, 0)


async def _run_backfill() -> PostingResult:
    healed = await _with_session(backfill_fallback_conversions)
    return PostingResult(healed, 0)


@celery_app.task(name="app.workers.tasks.rates.refresh_exchange_rates")
def refresh_exchange_rates() -> str:
    return run_job("app.workers.tasks.rates.refresh_exchange_rates", _run_refresh)


@celery_app.task(name="app.workers.tasks.rates.backfill_fallback_conversions")
def backfill_fallback_conversions_task() -> str:
    return run_job("app.workers.tasks.rates.backfill_fallback_conversions", _run_backfill)
