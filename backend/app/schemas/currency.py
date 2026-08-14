"""Pydantic DTOs for currency and exchange-rate data.

Amounts and rates are serialized as strings, never JSON numbers - see
docs/money-and-currency.md for why (NUMERIC(19,4) exceeds float64 precision).
"""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_serializer


class CurrencyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str
    symbol: str
    decimal_digits: int
    is_active: bool


class PublicSettingsRead(BaseModel):
    default_currency: str
    default_locale: str
    agents_enabled: bool


class ExchangeRateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    base_code: str
    quote_code: str
    rate: Decimal
    source: str

    @field_serializer("rate")
    def serialize_rate(self, value: Decimal) -> str:
        return str(value)


class ExchangeRateQuoteRead(BaseModel):
    """Response for an on-demand rate lookup - see app/services/exchange_rates.py.

    `is_fallback=True` means no live rate was available (no API key
    configured, or the provider call failed) and `rate` is the 1:1
    placeholder; callers should show a warning rather than treat it as real.
    """

    base_code: str
    quote_code: str
    rate: Decimal
    is_fallback: bool
    source: str
    as_of: date

    @field_serializer("rate")
    def serialize_rate(self, value: Decimal) -> str:
        return str(value)
