"""Read-only reference data: currencies, active settings, exchange rates."""

from datetime import date

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import AdminUser, CurrentUser, DbSession
from app.core.config import get_settings
from app.models.currency import Currency
from app.schemas.currency import CurrencyRead, ExchangeRateQuoteRead, PublicSettingsRead
from app.schemas.update import UpdateStatusRead
from app.services.exchange_rates import get_exchange_rate
from app.services.updates import get_update_status

router = APIRouter(prefix="/meta", tags=["meta"])
settings = get_settings()


@router.get("/currencies", response_model=list[CurrencyRead])
async def list_currencies(db: DbSession) -> list[Currency]:
    result = await db.execute(select(Currency).where(Currency.is_active.is_(True)))
    return list(result.scalars().all())


@router.get("/settings", response_model=PublicSettingsRead)
async def get_public_settings() -> PublicSettingsRead:
    return PublicSettingsRead(
        default_currency=settings.default_currency,
        default_locale=settings.default_locale,
        agents_enabled=settings.agents_enabled,
    )


@router.get("/exchange-rate", response_model=ExchangeRateQuoteRead)
async def get_exchange_rate_quote(
    base: str, quote: str, user: CurrentUser, db: DbSession, as_of: date | None = None
) -> ExchangeRateQuoteRead:
    """On-demand conversion rate lookup - see app/services/exchange_rates.py
    for the full fetch/cache/fallback precedence this wraps. Authenticated
    (unlike /currencies and /settings) because resolution now consults the
    caller's own manual rates."""
    result = await get_exchange_rate(db, base, quote, user_id=user.id, as_of=as_of)
    return ExchangeRateQuoteRead(
        base_code=base.upper(),
        quote_code=quote.upper(),
        rate=result.rate,
        is_fallback=result.is_fallback,
        source=result.source,
        as_of=result.as_of,
    )


@router.get("/update-status", response_model=UpdateStatusRead)
async def get_update_status_endpoint(_admin: AdminUser) -> UpdateStatusRead:
    """Admin-only check for a newer release - see app/services/updates.py
    for the GitHub lookup/cache/fallback this wraps."""
    return await get_update_status()
