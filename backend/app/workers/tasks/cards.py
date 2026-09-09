"""Nightly credit-card invoice auto-payment - registered with Celery beat.

Same shape as app/workers/tasks/loans.py: a short-lived async engine
driven by asyncio.run, so the async service layer
(app/services/card_invoice_posting.py) is reused rather than given a sync
twin.
"""

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.services.card_invoice_posting import post_all_due_invoice_payments
from app.services.posting_result import PostingResult
from app.workers.celery_app import celery_app
from app.workers.runner import run_job


async def _run() -> PostingResult:
    settings = get_settings()
    engine = create_async_engine(settings.sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            return await post_all_due_invoice_payments(db)
    finally:
        await engine.dispose()


@celery_app.task(name="app.workers.tasks.cards.post_card_invoice_payments")
def post_card_invoice_payments() -> str:
    return run_job("app.workers.tasks.cards.post_card_invoice_payments", _run)
