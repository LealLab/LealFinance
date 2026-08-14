"""User-defined exchange rate overrides. Outrank both the cached provider
rate and a live provider quote when resolving a conversion (see
app/services/exchange_rates.py) - useful for today's actual bank rate, or
when no provider is configured.
"""

from datetime import date as date_type

from sqlalchemy import CheckConstraint, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel
from app.models.types import CurrencyCode, ExchangeRateValue


class ManualRate(UserOwnedModel):
    __tablename__ = "manual_rates"
    __error_prefix__ = "manual_rate"
    __table_args__ = (
        # Also serves as the index for the precedence lookup:
        # WHERE user_id=? AND base_code=? AND quote_code=? AND as_of <= ?
        # ORDER BY as_of DESC LIMIT 1 - the column order is exactly right.
        UniqueConstraint(
            "user_id", "base_code", "quote_code", "as_of", name="uq_manual_rates_user_pair_as_of"
        ),
        CheckConstraint("rate > 0", name="ck_manual_rates_rate_positive"),
        CheckConstraint("base_code <> quote_code", name="ck_manual_rates_distinct_codes"),
    )

    base_code: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_manual_rates_base_code"),
        nullable=False,
    )
    quote_code: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_manual_rates_quote_code"),
        nullable=False,
    )
    rate: Mapped[ExchangeRateValue] = mapped_column(nullable=False)
    as_of: Mapped[date_type] = mapped_column(Date, nullable=False)
