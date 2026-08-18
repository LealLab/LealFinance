"""Celery application and beat schedule.

Workers use the sync engine (app.core.db_sync) rather than the async engine
FastAPI uses - Celery's worker model isn't async-native.
"""

from celery import Celery
from celery.schedules import crontab

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "lealfinance",
    broker=settings.celery_broker_url,
    backend=settings.celery_broker_url,
    include=["app.workers.tasks.rates", "app.workers.tasks.recurring"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

# Registered but inert: exchange_rates ships empty until multi-currency
# support is actually built (see docs/money-and-currency.md). Flip
# `enabled` in the task itself once there's a real provider to call.
celery_app.conf.beat_schedule = {
    # Before the rates refresh so a rule's cross-currency occurrences post
    # against the freshest cached rate that slot produces - not required
    # for correctness (recurring_posting.py fetches live/cached rates
    # itself), just avoids two provider calls a couple hours apart.
    "post-recurring-transactions-daily": {
        "task": "app.workers.tasks.recurring.post_recurring_transactions",
        "schedule": crontab(hour=1, minute=0),
    },
    "refresh-exchange-rates-daily": {
        "task": "app.workers.tasks.rates.refresh_exchange_rates",
        "schedule": crontab(hour=3, minute=0),
    },
}
