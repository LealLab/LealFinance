"""Currency reference data and exchange rates.

LealFinance starts BRL-only, but every monetary column is designed to carry
a currency code from day one so multi-currency support is additive later.
`exchange_rates` ships empty; app/workers/tasks/rates.py is the (currently
disabled) task that would keep it populated.
"""

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.types import ExchangeRateValue


class Currency(Base, TimestampMixin):
    """ISO 4217 currency reference row. Code is the primary key."""

    __tablename__ = "currencies"

    code: Mapped[str] = mapped_column(String(3), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False)
    decimal_digits: Mapped[int] = mapped_column(nullable=False, default=2)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ExchangeRate(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A point-in-time rate between two currencies.

    Empty at scaffold time - populated later by a scheduled refresh task
    once multi-currency support is actually built.
    """

    __tablename__ = "exchange_rates"
    __table_args__ = (
        UniqueConstraint("base_code", "quote_code", "as_of", "source", name="uq_exchange_rate"),
    )

    base_code: Mapped[str] = mapped_column(String(3), ForeignKey("currencies.code"), nullable=False)
    quote_code: Mapped[str] = mapped_column(
        String(3), ForeignKey("currencies.code"), nullable=False
    )
    rate: Mapped[ExchangeRateValue]
    as_of: Mapped[date] = mapped_column(Date, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)

    base: Mapped["Currency"] = relationship(foreign_keys=[base_code])
    quote: Mapped["Currency"] = relationship(foreign_keys=[quote_code])
