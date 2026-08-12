"""Exchange rate refresh — registered with Celery beat but disabled.

LealFinance starts BRL-only, so there is nothing to refresh yet. This task
is the intended seam for multi-currency support: once a rate provider is
chosen, flip ENABLED to True and implement the fetch below. Beat is already
scheduling it daily (see celery_app.py) so enabling it needs no infra change.
"""

import logging

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

ENABLED = False


@celery_app.task(name="app.workers.tasks.rates.refresh_exchange_rates")
def refresh_exchange_rates() -> str:
    if not ENABLED:
        logger.info("refresh_exchange_rates skipped: multi-currency not yet enabled")
        return "skipped"

    # TODO: fetch rates from a provider and upsert into exchange_rates,
    # using app.core.db_sync.SyncSessionLocal (Celery workers are sync).
    raise NotImplementedError
