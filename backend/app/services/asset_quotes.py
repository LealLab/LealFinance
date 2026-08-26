"""On-demand asset prices with cached and manual fallbacks.

Resolution precedence per asset:

1. A manual price, including assets explicitly configured with the manual
   quote provider.
2. A cached quote for today.
3. A live provider quote, cached for the rest of today.
4. The most recent cached quote, flagged stale.
5. No price, flagged stale.

Provider failures never propagate to the caller. A broken market-data lookup
must not be why a positions request fails.
"""

import logging
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.investment import (
    QUOTE_PROVIDER_MANUAL,
    QUOTE_PROVIDER_TWELVE_DATA,
    AssetQuote,
    InvestmentAsset,
)
from app.services import market_data_credentials

logger = logging.getLogger(__name__)

_TWELVE_DATA_URL = "https://api.twelvedata.com/quote"
_BRAPI_URL = "https://brapi.dev/api/quote"


@dataclass(frozen=True)
class PriceResult:
    price: Decimal | None
    is_stale: bool
    as_of: date | None
    source: str


async def get_asset_prices(
    db: AsyncSession, user_id: UUID, assets: list[InvestmentAsset]
) -> dict[UUID, PriceResult]:
    """Batch live lookups by provider, with no more than one call per group."""
    prices: dict[UUID, PriceResult] = {}
    groups: dict[str, list[InvestmentAsset]] = {}

    for asset in assets:
        if asset.quote_provider == QUOTE_PROVIDER_MANUAL or asset.manual_price is not None:
            prices[asset.id] = PriceResult(
                price=asset.manual_price,
                is_stale=asset.manual_price is None,
                as_of=None,
                source="manual" if asset.manual_price is not None else "none",
            )
        else:
            groups.setdefault(asset.quote_provider, []).append(asset)

    today = date.today()
    for provider, provider_assets in groups.items():
        symbols = list(dict.fromkeys(asset.symbol for asset in provider_assets))
        cached_result = await db.execute(
            select(AssetQuote).where(AssetQuote.symbol.in_(symbols), AssetQuote.as_of == today)
        )
        cached = {row.symbol: row for row in cached_result.scalars().all()}
        missing_symbols: list[str] = []
        for asset in provider_assets:
            row = cached.get(asset.symbol)
            if row is None:
                if asset.symbol not in missing_symbols:
                    missing_symbols.append(asset.symbol)
                continue
            prices[asset.id] = PriceResult(
                price=row.price, is_stale=False, as_of=row.as_of, source=row.source
            )

        if missing_symbols:
            user_row = await market_data_credentials.get_user_row(db, user_id, provider)
            api_key, _source = await market_data_credentials.resolve_api_key(user_row, provider)
            if api_key:
                try:
                    fetched = (
                        await _fetch_twelve_data(api_key, missing_symbols)
                        if provider == QUOTE_PROVIDER_TWELVE_DATA
                        else await _fetch_brapi(api_key, missing_symbols)
                    )
                except Exception:
                    logger.warning(
                        "Failed to fetch asset quotes from %s; using cached or stale prices",
                        provider,
                        exc_info=True,
                    )
                else:
                    successful: list[tuple[InvestmentAsset, Decimal]] = []
                    for asset in provider_assets:
                        if asset.symbol not in missing_symbols:
                            continue
                        price = _find_price(fetched, asset.symbol)
                        if price is None:
                            continue
                        prices[asset.id] = PriceResult(
                            price=price, is_stale=False, as_of=today, source=provider
                        )
                        successful.append((asset, price))
                    await _cache_quotes(db, successful, provider, today)

        for asset in provider_assets:
            if asset.id in prices:
                continue
            stale_result = await db.execute(
                select(AssetQuote)
                .where(AssetQuote.symbol == asset.symbol)
                .order_by(AssetQuote.as_of.desc())
                .limit(1)
            )
            row = stale_result.scalars().first()
            prices[asset.id] = PriceResult(
                price=row.price if row is not None else None,
                is_stale=True,
                as_of=row.as_of if row is not None else None,
                source="stale" if row is not None else "none",
            )

    return prices


def _find_price(prices: dict[str, Decimal], symbol: str) -> Decimal | None:
    for key in (symbol, symbol.upper()):
        if key in prices:
            return prices[key]
    return None


async def _cache_quotes(
    db: AsyncSession,
    quotes: list[tuple[InvestmentAsset, Decimal]],
    provider: str,
    as_of: date,
) -> None:
    if not quotes:
        return
    for asset, price in quotes:
        db.add(
            AssetQuote(
                symbol=asset.symbol,
                currency=asset.currency,
                price=price,
                as_of=as_of,
                source=provider,
            )
        )
    try:
        await db.commit()
    except IntegrityError:
        # Another concurrent request cached the same symbol first; the live
        # result is still safe to return to this caller.
        await db.rollback()


async def _fetch_twelve_data(api_key: str, symbols: list[str]) -> dict[str, Decimal]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            _TWELVE_DATA_URL,
            params={"symbol": ",".join(symbols), "apikey": api_key},
        )
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict):
        raise ValueError("Twelve Data response is not an object")

    entries: list[tuple[str, object]] = []
    if len(symbols) == 1 and ("close" in payload or payload.get("status") == "error"):
        entries.append((symbols[0], payload))
    else:
        for symbol, value in payload.items():
            if not isinstance(value, dict):
                raise ValueError("Twelve Data batch response has an invalid entry")
            entries.append((symbol, value))
        if not entries:
            raise ValueError("Twelve Data batch response has no quote entries")

    requested = {symbol.upper() for symbol in symbols}
    prices: dict[str, Decimal] = {}
    for fallback_symbol, value in entries:
        assert isinstance(value, dict)
        if value.get("status") == "error":
            continue
        if "close" not in value:
            raise ValueError("Twelve Data quote entry has no close field")
        symbol = str(value.get("symbol") or fallback_symbol)
        if symbol.upper() not in requested:
            continue
        prices[symbol] = Decimal(str(value["close"]))
    return prices


async def _fetch_brapi(token: str, symbols: list[str]) -> dict[str, Decimal]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{_BRAPI_URL}/{','.join(symbols)}",
            headers={"Authorization": f"Bearer {token}"},
        )
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise ValueError("brapi response has no results list")

    requested = {symbol.upper() for symbol in symbols}
    prices: dict[str, Decimal] = {}
    for item in payload["results"]:
        if not isinstance(item, dict) or "symbol" not in item or "regularMarketPrice" not in item:
            raise ValueError("brapi quote entry has an unexpected shape")
        symbol = str(item["symbol"])
        if symbol.upper() not in requested:
            continue
        prices[symbol] = Decimal(str(item["regularMarketPrice"]))
    return prices
