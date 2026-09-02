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
    include=[
        "app.workers.tasks.rates",
        "app.workers.tasks.recurring",
        "app.workers.tasks.loans",
        "app.workers.tasks.cards",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

celery_app.conf.beat_schedule = {
    "post-recurring-transactions-daily": {
        "task": "app.workers.tasks.recurring.post_recurring_transactions",
        "schedule": crontab(hour=1, minute=0),
    },
    # After recurring posting (01:00), before the rate backfill (02:00).
    "post-loan-installments-daily": {
        "task": "app.workers.tasks.loans.post_loan_installments",
        "schedule": crontab(hour=1, minute=30),
    },
    # After loans (01:30): a card's invoice may include an auto-posted
    # recurring charge or loan installment from earlier in the run.
    "post-card-invoice-payments-daily": {
        "task": "app.workers.tasks.cards.post_card_invoice_payments",
        "schedule": crontab(hour=1, minute=45),
    },
    # Every 6h keeps the cache within the provider's hourly update cadence
    # while staying far under the free plan's 1,000 requests/month (one
    # request per run covers every currency). Currency-introducing writes and
    # the admin refresh endpoint also fill the cache; this is the
    # steady-state warm-up.
    "refresh-exchange-rates": {
        "task": "app.workers.tasks.rates.refresh_exchange_rates",
        "schedule": crontab(minute=0, hour="*/6"),
    },
    # Nightly, after the recurring post: re-resolve conversions frozen at
    # the 1:1 fallback from before a provider key existed. Bounded per run.
    "backfill-fallback-conversions-daily": {
        "task": "app.workers.tasks.rates.backfill_fallback_conversions",
        "schedule": crontab(hour=2, minute=0),
    },
}
