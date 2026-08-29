"""Nightly loan-installment posting - registered with Celery beat.

Same shape as app/workers/tasks/recurring.py: a short-lived async engine
driven by asyncio.run, so the async service layer
(app/services/loan_posting.py) is reused rather than given a sync twin.
"""

import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.services.loan_posting import post_all_due_installments
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _run() -> int:
    settings = get_settings()
    engine = create_async_engine(settings.sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            return await post_all_due_installments(db)
    finally:
        await engine.dispose()


@celery_app.task(name="app.workers.tasks.loans.post_loan_installments")
def post_loan_installments() -> str:
    posted = asyncio.run(_run())
    logger.info("post_loan_installments posted %d transaction(s)", posted)
    return f"posted {posted}"
