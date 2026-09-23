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
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.investment import (
    KEYLESS_QUOTE_PROVIDERS,
    QUOTE_PROVIDER_BRAPI,
    QUOTE_PROVIDER_COINGECKO,
    QUOTE_PROVIDER_MANUAL,
    QUOTE_PROVIDER_TWELVE_DATA,
    AssetQuote,
    InvestmentAsset,
)
from app.services import market_data_credentials

logger = logging.getLogger(__name__)

_TWELVE_DATA_URL = "https://api.twelvedata.com/quote"
_TWELVE_DATA_TIME_SERIES_URL = "https://api.twelvedata.com/time_series"
_BRAPI_URL = "https://brapi.dev/api/quote"
_BRAPI_HISTORICAL_URL = "https://brapi.dev/api/v2/stocks/historical"
_COINGECKO_URL = "https://api.coingecko.com/api/v3/coins/markets"
_COINGECKO_HISTORY_URL = "https://api.coingecko.com/api/v3/coins"


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
        currencies = list(dict.fromkeys(asset.currency for asset in provider_assets))
        cached_result = await db.execute(
            select(AssetQuote).where(
                AssetQuote.symbol.in_(symbols),
                AssetQuote.currency.in_(currencies),
                AssetQuote.source == provider,
                AssetQuote.as_of == today,
            )
        )
        cached = {(row.symbol, row.currency): row for row in cached_result.scalars().all()}
        missing: list[InvestmentAsset] = []
        for asset in provider_assets:
            row = cached.get((asset.symbol, asset.currency))
            if row is None:
                missing.append(asset)
                continue
            prices[asset.id] = PriceResult(
                price=row.price, is_stale=False, as_of=row.as_of, source=row.source
            )

        if missing:
            user_row = await market_data_credentials.get_user_row(db, user_id, provider)
            api_key, _source = await market_data_credentials.resolve_api_key(user_row, provider)
            if api_key or provider in KEYLESS_QUOTE_PROVIDERS:
                successful: list[tuple[InvestmentAsset, Decimal]] = []
                if provider == QUOTE_PROVIDER_COINGECKO:
                    by_currency: dict[str, list[InvestmentAsset]] = {}
                    for asset in missing:
                        by_currency.setdefault(asset.currency, []).append(asset)
                    for currency, currency_assets in by_currency.items():
                        currency_symbols = list(dict.fromkeys(a.symbol for a in currency_assets))
                        try:
                            fetched = await _fetch_coingecko(api_key, currency_symbols, currency)
                        except Exception:
                            logger.warning(
                                "Failed to fetch asset quotes from %s; using cached or"
                                " stale prices",
                                provider,
                                exc_info=True,
                            )
                            continue
                        for asset in currency_assets:
                            price = _find_price(fetched, asset.symbol)
                            if price is None:
                                continue
                            prices[asset.id] = PriceResult(
                                price=price, is_stale=False, as_of=today, source=provider
                            )
                            successful.append((asset, price))
                elif api_key:
                    try:
                        fetched = (
                            await _fetch_twelve_data(api_key, symbols)
                            if provider == QUOTE_PROVIDER_TWELVE_DATA
                            else await _fetch_brapi(api_key, symbols)
                        )
                    except Exception:
                        logger.warning(
                            "Failed to fetch asset quotes from %s; using cached or stale prices",
                            provider,
                            exc_info=True,
                        )
                    else:
                        for asset in missing:
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
                .where(
                    AssetQuote.symbol == asset.symbol,
                    AssetQuote.currency == asset.currency,
                    AssetQuote.source == provider,
                )
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


async def get_asset_price(
    db: AsyncSession,
    user_id: UUID,
    asset: InvestmentAsset,
    as_of: date,
    *,
    cache: bool = True,
) -> PriceResult:
    """Resolve one exact-date quote without falling back to another date."""
    if asset.quote_provider == QUOTE_PROVIDER_MANUAL or asset.manual_price is not None:
        return PriceResult(
            price=asset.manual_price,
            is_stale=asset.manual_price is None,
            as_of=None,
            source="manual" if asset.manual_price is not None else "none",
        )

    cached_result = await db.execute(
        select(AssetQuote).where(
            AssetQuote.symbol == asset.symbol,
            AssetQuote.currency == asset.currency,
            AssetQuote.source == asset.quote_provider,
            AssetQuote.as_of == as_of,
        )
    )
    cached = cached_result.scalars().first()
    if cached is not None:
        return PriceResult(
            price=cached.price, is_stale=False, as_of=cached.as_of, source=cached.source
        )

    user_row = await market_data_credentials.get_user_row(db, user_id, asset.quote_provider)
    api_key, _source = await market_data_credentials.resolve_api_key(user_row, asset.quote_provider)
    if not api_key and asset.quote_provider not in KEYLESS_QUOTE_PROVIDERS:
        return PriceResult(price=None, is_stale=True, as_of=None, source="none")

    try:
        if as_of == date.today():
            if asset.quote_provider == QUOTE_PROVIDER_COINGECKO:
                fetched = await _fetch_coingecko(api_key, [asset.symbol], asset.currency)
            elif asset.quote_provider == QUOTE_PROVIDER_TWELVE_DATA:
                fetched = await _fetch_twelve_data(api_key or "", [asset.symbol])
            else:
                fetched = await _fetch_brapi(api_key or "", [asset.symbol])
            price = _find_price(fetched, asset.symbol)
        elif asset.quote_provider == QUOTE_PROVIDER_TWELVE_DATA:
            price = await _fetch_twelve_data_historical(api_key or "", asset.symbol, as_of)
        elif asset.quote_provider == QUOTE_PROVIDER_BRAPI:
            price = await _fetch_brapi_historical(api_key or "", asset.symbol, as_of)
        elif asset.quote_provider == QUOTE_PROVIDER_COINGECKO:
            price = await _fetch_coingecko_historical(api_key, asset.symbol, asset.currency, as_of)
        else:
            price = None
    except Exception:
        logger.warning(
            "Failed to fetch exact asset quote from %s",
            asset.quote_provider,
            exc_info=True,
        )
        price = None

    if price is None:
        return PriceResult(price=None, is_stale=True, as_of=None, source="none")
    if cache:
        await _cache_quotes(db, [(asset, price)], asset.quote_provider, as_of)
    return PriceResult(price=price, is_stale=False, as_of=as_of, source=asset.quote_provider)


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


async def _fetch_twelve_data_historical(api_key: str, symbol: str, as_of: date) -> Decimal | None:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            _TWELVE_DATA_TIME_SERIES_URL,
            params={
                "symbol": symbol,
                "interval": "1day",
                "start_date": as_of.isoformat(),
                "end_date": as_of.isoformat(),
                "apikey": api_key,
            },
        )
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict) or not isinstance(payload.get("values"), list):
        return None
    for item in payload["values"]:
        if not isinstance(item, dict) or "datetime" not in item or "close" not in item:
            continue
        if str(item["datetime"])[:10] == as_of.isoformat():
            return Decimal(str(item["close"]))
    return None


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


async def _fetch_brapi_historical(token: str, symbol: str, as_of: date) -> Decimal | None:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            _BRAPI_HISTORICAL_URL,
            params={
                "symbols": symbol,
                "interval": "1d",
                "startDate": as_of.isoformat(),
                "endDate": as_of.isoformat(),
                "sortOrder": "asc",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        return None
    for result in payload["results"]:
        if not isinstance(result, dict) or str(result.get("symbol", "")).upper() != symbol.upper():
            continue
        data = result.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("historicalDataPrice"), list):
            continue
        for item in data["historicalDataPrice"]:
            if not isinstance(item, dict) or "close" not in item:
                continue
            if _quote_date(item.get("date")) == as_of:
                return Decimal(str(item["close"]))
    return None


async def _fetch_coingecko(
    api_key: str | None, symbols: list[str], vs_currency: str
) -> dict[str, Decimal]:
    params: dict[str, str | int] = {
        "vs_currency": vs_currency.lower(),
        "symbols": ",".join(symbol.lower() for symbol in symbols),
        "per_page": 250,
    }
    headers = {"x-cg-demo-api-key": api_key} if api_key else {}
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(_COINGECKO_URL, params=params, headers=headers)
        response.raise_for_status()
        payload = response.json()

    if not isinstance(payload, list):
        raise ValueError("CoinGecko response is not a list")

    requested = {symbol.upper() for symbol in symbols}
    prices: dict[str, Decimal] = {}
    for item in payload:
        if not isinstance(item, dict) or "symbol" not in item or "current_price" not in item:
            raise ValueError("CoinGecko quote entry has an unexpected shape")
        symbol = str(item["symbol"]).upper()
        # ponytail: first match wins when several coins share a ticker.
        # CoinGecko's default order is market-cap descending, so this keeps
        # the larger coin; add an explicit coin-id field on InvestmentAsset
        # if a user needs the smaller one instead.
        if symbol not in requested or symbol in prices:
            continue
        price = item["current_price"]
        if price is None:
            continue
        prices[symbol] = Decimal(str(price))
    return prices


async def _fetch_coingecko_historical(
    api_key: str | None, symbol: str, vs_currency: str, as_of: date
) -> Decimal | None:
    params: dict[str, str | int] = {
        "vs_currency": vs_currency.lower(),
        "symbols": symbol.lower(),
        "per_page": 250,
    }
    headers = {"x-cg-demo-api-key": api_key} if api_key else {}
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(_COINGECKO_URL, params=params, headers=headers)
        response.raise_for_status()
        payload = response.json()

        if not isinstance(payload, list):
            return None
        coin_id: str | None = None
        for item in payload:
            if not isinstance(item, dict) or "symbol" not in item or "id" not in item:
                continue
            if str(item["symbol"]).upper() == symbol.upper():
                coin_id = str(item["id"])
                break
        if coin_id is None:
            return None

        history = await client.get(
            f"{_COINGECKO_HISTORY_URL}/{coin_id}/history",
            params={"date": as_of.strftime("%d-%m-%Y"), "localization": "false"},
            headers=headers,
        )
        history.raise_for_status()
        history_payload = history.json()

    if not isinstance(history_payload, dict):
        return None
    market_data = history_payload.get("market_data")
    if not isinstance(market_data, dict):
        return None
    current_price = market_data.get("current_price")
    if not isinstance(current_price, dict):
        return None
    price = current_price.get(vs_currency.lower())
    return None if price is None else Decimal(str(price))


def _quote_date(value: object) -> date | None:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=UTC).date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None
