"""Currency validation shared by every money-bearing domain service.

Accounts, transactions, budgets, expected income, goals, and manual rates
all reference a currency by its ISO 4217 code - this is the one place that
lookup and its error codes are defined, so they can't drift between
domains.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.models.currency import Currency


async def get_active_currency(db: AsyncSession, code: str) -> Currency:
    currency = await db.get(Currency, code.upper())
    if currency is None:
        raise NotFoundError(code="currency.not_found", params={"code": code})
    if not currency.is_active:
        raise ValidationAppError(code="currency.inactive", params={"code": code})
    return currency
