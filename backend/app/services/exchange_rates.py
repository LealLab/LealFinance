"""On-demand currency conversion rates.

`get_exchange_rate` is a pure read. Resolution precedence:

1. Same-currency identity rate.
2. The caller's manual rate effective on or before the requested date
   (newest such rate wins).
3. The inverse of the caller's manual rate for the reversed pair.
4. A cached rate for the requested date - either a directly stored pair or
   a USD bridge (`quote / base`) built from the USD-anchored rows.
5. A safe 1:1 fallback, flagged `is_fallback=True`.

The Open Exchange Rates free plan only quotes against USD and caps usage at
1,000 requests/month, so the cache is USD-anchored: one `refresh_rates`
call fetches `latest.json` (or `historical/{date}.json` for a past date)
and stores one `USD -> X` row per known currency. Any pair is then a local
division. The cache is filled, never as a side effect of a lookup, by:

- the scheduled Celery task (app/workers/tasks/rates.py, every few hours);
- `ensure_rates_cached`, called from every write that introduces a currency
  (account/goal/wallet create, currency change) and once at API startup;
- `refresh_rates_manual`, the admin "refresh now" endpoint, cooldown-gated.

Without a key, without a refresh yet, or if the provider call fails, lookups
return a 1:1 fallback, flagged so callers can show a warning rather than
silently using a wrong number. Provider failures never propagate as an
error - a broken exchange-rate lookup should never be why a request fails.

Manual rates (steps 2-3) are user-scoped and only consulted when a caller
passes `user_id` - see app/services/manual_rates.py for the CRUD side.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.currency import Currency, ExchangeRate
from app.models.manual_rate import ManualRate

logger = logging.getLogger(__name__)

OXR_SOURCE = "openexchangerates"
FALLBACK_SOURCE = "fallback_1to1"
IDENTITY_SOURCE = "identity"
MANUAL_SOURCE = "manual"

_ANCHOR = "USD"  # the only base the free plan quotes against
_OXR_LATEST_URL = "https://openexchangerates.org/api/latest.json"
_OXR_HISTORICAL_URL = "https://openexchangerates.org/api/historical/{date}.json"
_RATE_QUANTUM = Decimal("0.0000000001")  # matches ExchangeRateValue: NUMERIC(19, 10)


@dataclass(frozen=True)
class RateResult:
    rate: Decimal
    is_fallback: bool
    source: str
    as_of: date


def to_conversion_source(result: RateResult) -> str:
    """Maps a RateResult's source vocabulary (identity/manual/
    openexchangerates/fallback_1to1) onto app/models/_conversion.py's
    CONVERSION_SOURCES (manual/quote/fallback) - the two are deliberately
    different vocabularies (a rate lookup and a transaction's recorded
    conversion aren't the same concept), but a caller that turns a live
    rate into a posted conversion needs to bridge them. The frontend does
    the same mapping in data/http/mappers.ts."""
    if result.is_fallback:
        return "fallback"
    if result.source == MANUAL_SOURCE:
        return "manual"
    return "quote"


def _fallback(as_of: date) -> RateResult:
    return RateResult(rate=Decimal("1"), is_fallback=True, source=FALLBACK_SOURCE, as_of=as_of)


async def get_exchange_rate(
    db: AsyncSession,
    base_code: str,
    quote_code: str,
    *,
    user_id: UUID | None = None,
    as_of: date | None = None,
) -> RateResult:
    base_code = base_code.upper()
    quote_code = quote_code.upper()
    as_of = as_of or date.today()

    if base_code == quote_code:
        return RateResult(rate=Decimal("1"), is_fallback=False, source=IDENTITY_SOURCE, as_of=as_of)

    if user_id is not None:
        manual = await _get_manual_rate(db, user_id, base_code, quote_code, as_of)
        if manual is not None:
            return manual

    cached = await _get_cached_rate(db, base_code, quote_code, as_of)
    if cached is not None:
        return cached

    # No cached rate. This is a pure read - the cache is filled by the
    # scheduled refresh (app/workers/tasks/rates.py), by `ensure_rates_cached`
    # on currency-introducing writes, and by `refresh_rates_manual`, never as a
    # side effect here.
    logger.info("No cached rate for %s->%s on %s; using 1:1 fallback", base_code, quote_code, as_of)
    return _fallback(as_of)


async def _get_manual_rate(
    db: AsyncSession, user_id: UUID, base_code: str, quote_code: str, as_of: date
) -> RateResult | None:
    direct = await db.execute(
        select(ManualRate)
        .where(
            ManualRate.user_id == user_id,
            ManualRate.base_code == base_code,
            ManualRate.quote_code == quote_code,
            ManualRate.as_of <= as_of,
        )
        .order_by(ManualRate.as_of.desc())
        .limit(1)
    )
    row = direct.scalars().first()
    if row is not None:
        return RateResult(rate=row.rate, is_fallback=False, source=MANUAL_SOURCE, as_of=row.as_of)

    inverse = await db.execute(
        select(ManualRate)
        .where(
            ManualRate.user_id == user_id,
            ManualRate.base_code == quote_code,
            ManualRate.quote_code == base_code,
            ManualRate.as_of <= as_of,
        )
        .order_by(ManualRate.as_of.desc())
        .limit(1)
    )
    inverse_row = inverse.scalars().first()
    if inverse_row is None:
        return None

    inverted_rate = (Decimal(1) / inverse_row.rate).quantize(_RATE_QUANTUM, rounding=ROUND_HALF_UP)
    return RateResult(
        rate=inverted_rate, is_fallback=False, source=MANUAL_SOURCE, as_of=inverse_row.as_of
    )


async def _get_cached_rate(
    db: AsyncSession, base_code: str, quote_code: str, as_of: date
) -> RateResult | None:
    """A directly stored pair wins (legacy rows, and lets a manual direct
    write shortcut the bridge); otherwise divide two USD-anchored rows."""
    direct = await db.execute(
        select(ExchangeRate)
        .where(
            ExchangeRate.base_code == base_code,
            ExchangeRate.quote_code == quote_code,
            ExchangeRate.as_of <= as_of,
        )
        .order_by(ExchangeRate.as_of.desc())
        .limit(1)
    )
    row = direct.scalars().first()
    if row is not None:
        return RateResult(
            rate=row.rate,
            is_fallback=row.source == FALLBACK_SOURCE,
            source=row.source,
            as_of=row.as_of,
        )

    anchor_base = await _anchor_rate(db, base_code, as_of)
    anchor_quote = await _anchor_rate(db, quote_code, as_of)
    if anchor_base is None or anchor_quote is None:
        return None

    rate = (anchor_quote[0] / anchor_base[0]).quantize(_RATE_QUANTUM, rounding=ROUND_HALF_UP)
    # Report the older of the two anchors so callers see the date actually used.
    effective_as_of = min(anchor_base[1], anchor_quote[1])
    return RateResult(rate=rate, is_fallback=False, source=OXR_SOURCE, as_of=effective_as_of)


async def _anchor_rate(db: AsyncSession, code: str, as_of: date) -> tuple[Decimal, date] | None:
    """`USD -> code` on or before `as_of`. USD against itself is 1 with no row.

    Falls back to the newest row at or before `as_of` (mirroring the manual-rate
    lookup) rather than requiring an exact date match - a single missing day
    would otherwise collapse the whole rate to the flagged 1:1 fallback.
    """
    if code == _ANCHOR:
        return (Decimal(1), as_of)
    result = await db.execute(
        select(ExchangeRate.rate, ExchangeRate.as_of)
        .where(
            ExchangeRate.base_code == _ANCHOR,
            ExchangeRate.quote_code == code,
            ExchangeRate.as_of <= as_of,
            ExchangeRate.source == OXR_SOURCE,
        )
        .order_by(ExchangeRate.as_of.desc())
        .limit(1)
    )
    row = result.first()
    return None if row is None else (row[0], row[1])


async def refresh_rates(db: AsyncSession, as_of: date | None = None) -> int:
    """Fetch every USD-anchored rate for `as_of` and upsert it into the
    cache. No-op without a provider key. Returns the row count touched.

    Flushes but does not commit - the caller owns the transaction (the
    Celery task commits its own session; `warm_cache_for` rides the
    request's commit). Concurrent refreshes are safe: the upsert targets
    `uq_exchange_rate`, so a race updates rather than conflicts.
    """
    as_of = as_of or date.today()
    settings = get_settings()
    if not settings.openexchangerates_app_id:
        return 0

    usd_rates = await _fetch_usd_rates(settings.openexchangerates_app_id, as_of)

    known = set((await db.execute(select(Currency.code))).scalars().all())
    values = [
        {
            "base_code": _ANCHOR,
            "quote_code": code,
            "rate": rate,
            "as_of": as_of,
            "source": OXR_SOURCE,
        }
        for code, rate in usd_rates.items()
        if code in known and code != _ANCHOR
    ]
    if not values:
        return 0

    stmt = pg_insert(ExchangeRate).values(values)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_exchange_rate",
        set_={"rate": stmt.excluded.rate, "updated_at": func.now()},
    )
    await db.execute(stmt)
    await db.flush()
    return len(values)


async def has_cached_rates(db: AsyncSession, as_of: date) -> bool:
    """Whether the provider cache holds any row for *exactly* `as_of`.

    Deliberately an exact-date check, unlike `_anchor_rate`'s `as_of <= ...`:
    a stale row from days ago must not make today look covered, or a cache
    that stopped updating would never recover.
    """
    return bool(
        await db.scalar(
            select(
                select(ExchangeRate.id)
                .where(
                    ExchangeRate.source == OXR_SOURCE,
                    ExchangeRate.as_of == as_of,
                )
                .exists()
            )
        )
    )


async def ensure_rates_cached(db: AsyncSession, *, as_of: date | None = None) -> None:
    """Best-effort: make sure the cache holds today's rates so a freshly
    introduced currency converts against a real rate instead of sitting at
    the 1:1 fallback until the next scheduled refresh. One `refresh_rates`
    call covers every currency, so this takes no currency argument. Rides
    the caller's transaction (call before its commit). Never raises.
    """
    as_of = as_of or date.today()
    if not get_settings().openexchangerates_app_id:
        return
    if await has_cached_rates(db, as_of):
        return
    try:
        await refresh_rates(db, as_of)
    except Exception:
        logger.warning("Exchange-rate cache warm-up failed for %s", as_of, exc_info=True)


@dataclass(frozen=True)
class RefreshResult:
    as_of: date
    updated: int
    throttled: bool
    refreshed_at: datetime | None


async def refresh_rates_manual(db: AsyncSession) -> RefreshResult:
    """Operator-triggered "refresh now" (POST /meta/exchange-rates/refresh).

    Cooldown-gated on the newest `updated_at` across provider rows, shared by
    every process: within `exchange_rate_refresh_cooldown_minutes` it returns
    `throttled=True` without calling the provider. Otherwise it refreshes
    today's rates and commits nothing - the caller owns the transaction.
    """
    settings = get_settings()
    today = date.today()
    last = await db.scalar(
        select(func.max(ExchangeRate.updated_at)).where(ExchangeRate.source == OXR_SOURCE)
    )
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=UTC)
        cooldown = timedelta(minutes=settings.exchange_rate_refresh_cooldown_minutes)
        if datetime.now(UTC) - last < cooldown:
            return RefreshResult(as_of=today, updated=0, throttled=True, refreshed_at=last)

    updated = await refresh_rates(db, today)
    return RefreshResult(
        as_of=today, updated=updated, throttled=False, refreshed_at=datetime.now(UTC)
    )


async def _fetch_usd_rates(app_id: str, as_of: date) -> dict[str, Decimal]:
    """One request. `latest.json` for today, `historical/{date}.json`
    otherwise - both are USD-based on every plan. `symbols` is deliberately
    omitted (it is paid-only on the historical endpoint, and one unfiltered
    response covers every currency anyway)."""
    url = (
        _OXR_LATEST_URL
        if as_of >= date.today()
        else _OXR_HISTORICAL_URL.format(date=as_of.isoformat())
    )
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(url, params={"app_id": app_id})
        response.raise_for_status()
        payload = response.json()
    return {code: Decimal(str(value)) for code, value in payload["rates"].items()}
