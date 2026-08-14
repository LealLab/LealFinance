"""On-demand currency conversion rates.

Fetches a live rate from Open Exchange Rates when OPENEXCHANGERATES_APP_ID
is configured, caching successful lookups in `exchange_rates` for the day.
Without a key - or if the provider call fails - this returns a 1:1
fallback rate, flagged so callers can show a warning rather than silently
using a wrong number.

Not yet called from a transaction-creation flow: there is no transactions
domain in this scaffold yet (see CLAUDE.md). This is the service that flow
is expected to call once it exists - see docs/money-and-currency.md.
"""

import logging
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.currency import Currency, ExchangeRate

logger = logging.getLogger(__name__)

OXR_SOURCE = "openexchangerates"
FALLBACK_SOURCE = "fallback_1to1"
IDENTITY_SOURCE = "identity"

_OXR_LATEST_URL = "https://openexchangerates.org/api/latest.json"
_RATE_QUANTUM = Decimal("0.0000000001")  # matches ExchangeRateValue: NUMERIC(19, 10)


@dataclass(frozen=True)
class RateResult:
    rate: Decimal
    is_fallback: bool
    source: str
    as_of: date


async def get_exchange_rate(db: AsyncSession, base_code: str, quote_code: str) -> RateResult:
    base_code = base_code.upper()
    quote_code = quote_code.upper()
    today = date.today()

    if base_code == quote_code:
        return RateResult(rate=Decimal("1"), is_fallback=False, source=IDENTITY_SOURCE, as_of=today)

    cached = await _get_cached_rate(db, base_code, quote_code, today)
    if cached is not None:
        return cached

    settings = get_settings()
    if not settings.openexchangerates_app_id:
        logger.info(
            "No OPENEXCHANGERATES_APP_ID configured; using 1:1 fallback for %s->%s",
            base_code,
            quote_code,
        )
        return RateResult(rate=Decimal("1"), is_fallback=True, source=FALLBACK_SOURCE, as_of=today)

    try:
        rate = await _fetch_rate_from_provider(
            settings.openexchangerates_app_id, base_code, quote_code
        )
    except Exception:
        logger.warning(
            "Failed to fetch %s->%s from Open Exchange Rates; using 1:1 fallback",
            base_code,
            quote_code,
            exc_info=True,
        )
        return RateResult(rate=Decimal("1"), is_fallback=True, source=FALLBACK_SOURCE, as_of=today)

    await _cache_rate(db, base_code, quote_code, rate, today)
    return RateResult(rate=rate, is_fallback=False, source=OXR_SOURCE, as_of=today)


async def _get_cached_rate(
    db: AsyncSession, base_code: str, quote_code: str, as_of: date
) -> RateResult | None:
    result = await db.execute(
        select(ExchangeRate).where(
            ExchangeRate.base_code == base_code,
            ExchangeRate.quote_code == quote_code,
            ExchangeRate.as_of == as_of,
        )
    )
    row = result.scalars().first()
    if row is None:
        return None
    return RateResult(
        rate=row.rate,
        is_fallback=row.source == FALLBACK_SOURCE,
        source=row.source,
        as_of=row.as_of,
    )


async def _fetch_rate_from_provider(app_id: str, base_code: str, quote_code: str) -> Decimal:
    """Open Exchange Rates' free plan only allows `base=USD` (changing the
    base currency requires a paid plan) - so cross rates are computed via a
    USD bridge from a single request: rate(A->B) = rates[B] / rates[A],
    where rates[X] is "how many X per 1 USD" (rates["USD"] is always 1).
    """
    symbols = {base_code, quote_code, "USD"}
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            _OXR_LATEST_URL,
            params={"app_id": app_id, "symbols": ",".join(sorted(symbols))},
        )
        response.raise_for_status()
        payload = response.json()

    rates = payload["rates"]
    rate_base = Decimal(str(rates[base_code]))
    rate_quote = Decimal(str(rates[quote_code]))
    return (rate_quote / rate_base).quantize(_RATE_QUANTUM, rounding=ROUND_HALF_UP)


async def _cache_rate(
    db: AsyncSession, base_code: str, quote_code: str, rate: Decimal, as_of: date
) -> None:
    """Only persists when both currencies already exist in `currencies`
    (exchange_rates has a foreign key to it) - an unrecognized currency
    still gets a live rate returned to the caller, it just isn't cached."""
    known = await db.execute(
        select(Currency.code).where(Currency.code.in_([base_code, quote_code]))
    )
    if len(known.scalars().all()) != 2:
        return

    db.add(
        ExchangeRate(
            base_code=base_code,
            quote_code=quote_code,
            rate=rate,
            as_of=as_of,
            source=OXR_SOURCE,
        )
    )
    try:
        await db.commit()
    except IntegrityError:
        # Another concurrent request cached the same pair first - fine,
        # the rate we already computed is still correct to return.
        await db.rollback()
