"""Read-only reference data: currencies, active settings, exchange rates."""

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import DbSession
from app.core.config import get_settings
from app.models.currency import Currency
from app.schemas.currency import CurrencyRead, ExchangeRateQuoteRead
from app.services.exchange_rates import get_exchange_rate

router = APIRouter(prefix="/meta", tags=["meta"])
settings = get_settings()


@router.get("/currencies", response_model=list[CurrencyRead])
async def list_currencies(db: DbSession) -> list[Currency]:
    result = await db.execute(select(Currency).where(Currency.is_active.is_(True)))
    return list(result.scalars().all())


@router.get("/settings")
async def get_public_settings() -> dict[str, str]:
    return {
        "default_currency": settings.default_currency,
        "default_locale": settings.default_locale,
        "agents_enabled": str(settings.agents_enabled).lower(),
    }


@router.get("/exchange-rate", response_model=ExchangeRateQuoteRead)
async def get_exchange_rate_quote(base: str, quote: str, db: DbSession) -> ExchangeRateQuoteRead:
    """On-demand conversion rate lookup - see app/services/exchange_rates.py
    for the fetch/cache/fallback behavior this wraps."""
    result = await get_exchange_rate(db, base, quote)
    return ExchangeRateQuoteRead(
        base_code=base.upper(),
        quote_code=quote.upper(),
        rate=result.rate,
        is_fallback=result.is_fallback,
        source=result.source,
        as_of=result.as_of,
    )
