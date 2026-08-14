"""Manual exchange-rate override CRUD. See
app/services/exchange_rates.py for how these outrank the cached/provider
rate during resolution."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.manual_rate import ManualRate
from app.services import ownership
from app.services.currencies import get_active_currency


async def list_manual_rates(db: AsyncSession, user_id: UUID) -> list[ManualRate]:
    return list(await ownership.list_owned(db, ManualRate, user_id))


async def upsert_manual_rate(
    db: AsyncSession,
    user_id: UUID,
    base_code: str,
    quote_code: str,
    as_of: date,
    rate: Decimal,
) -> ManualRate:
    base_code = base_code.upper()
    quote_code = quote_code.upper()
    if base_code == quote_code:
        raise ValidationAppError(code="manual_rate.same_currency")

    await get_active_currency(db, base_code)
    await get_active_currency(db, quote_code)

    result = await db.execute(
        select(ManualRate).where(
            ManualRate.user_id == user_id,
            ManualRate.base_code == base_code,
            ManualRate.quote_code == quote_code,
            ManualRate.as_of == as_of,
        )
    )
    manual_rate = result.scalars().first()
    if manual_rate is None:
        manual_rate = ManualRate(
            user_id=user_id, base_code=base_code, quote_code=quote_code, as_of=as_of
        )
        db.add(manual_rate)

    manual_rate.rate = rate
    await db.commit()
    await db.refresh(manual_rate)
    return manual_rate


async def delete_manual_rate(db: AsyncSession, user_id: UUID, manual_rate_id: UUID) -> None:
    manual_rate = await ownership.get_owned(db, ManualRate, manual_rate_id, user_id)
    await db.delete(manual_rate)
    await db.commit()
