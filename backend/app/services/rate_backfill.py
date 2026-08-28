"""Re-resolve transactions whose cross-currency conversion was recorded at
the flagged 1:1 fallback (no provider key at the time) once a real rate is
available.

A saved conversion is normally authoritative and never re-derived (see
app/services/conversion.py) - a `fallback` source is the one exception: it
is an explicit "we didn't have a rate", not a recorded decision. This walks
those rows, asks `get_exchange_rate` for the rate that applied on each
transaction's own date, and rewrites the conversion_* columns through the
same validator a normal write uses.

Recurring-rule templates are deliberately not touched: each occurrence
re-resolves a live rate when it posts (app/services/recurring_posting.py),
so a stale template rate never reaches the ledger.
"""

import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models._conversion import CONVERSION_SOURCE_FALLBACK
from app.models.transaction import Transaction
from app.services.conversion import ConversionInput, resolve_conversion
from app.services.exchange_rates import get_exchange_rate, to_conversion_source

logger = logging.getLogger(__name__)

# Safety valve: a row on a not-yet-cached date costs one provider request.
# Bounds a single run's provider usage regardless of backlog size; the rest
# heal on later runs, and dates cached by an earlier run are free.
MAX_PROVIDER_DATES = 25


async def backfill_fallback_conversions(
    db: AsyncSession, *, max_provider_dates: int = MAX_PROVIDER_DATES
) -> int:
    """Rewrite as many fallback conversions as the per-run provider budget
    allows. Returns the number of rows healed; commits once at the end."""
    rows = (
        (
            await db.execute(
                select(Transaction)
                .where(Transaction.conversion_source == CONVERSION_SOURCE_FALLBACK)
                .order_by(Transaction.date)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return 0

    healed = 0
    dates_seen: set[date] = set()
    for tx in rows:
        if tx.date not in dates_seen:
            if len(dates_seen) >= max_provider_dates:
                continue  # over budget for this run - heal on the next one
            dates_seen.add(tx.date)

        assert tx.conversion_currency is not None  # source == fallback implies a full set

        result = await get_exchange_rate(
            db, tx.currency, tx.conversion_currency, user_id=tx.user_id, as_of=tx.date
        )
        if result.is_fallback:
            continue  # still no rate for that date - leave it for later

        try:
            conversion = await resolve_conversion(
                db,
                origin_amount=tx.amount,
                origin_currency=tx.currency,
                destination_currency=tx.conversion_currency,
                payload=ConversionInput(
                    amount=None,  # derived with the destination currency's rounding
                    currency=tx.conversion_currency,
                    fee=tx.conversion_fee,
                    rate=result.rate,
                    source=to_conversion_source(result),
                ),
            )
        except ValidationAppError:
            logger.warning("Skipping fallback backfill for transaction %s", tx.id, exc_info=True)
            continue

        assert conversion is not None
        tx.conversion_amount = conversion.amount
        tx.conversion_currency = conversion.currency
        tx.conversion_fee = conversion.fee
        tx.conversion_rate = conversion.rate
        tx.conversion_source = conversion.source
        healed += 1

    if healed:
        await db.commit()
    return healed
