"""Reusable column type aliases for monetary data.

Every monetary column in this codebase should use MoneyAmount, paired with a
CurrencyCode column, rather than a hand-rolled Numeric(...). See
docs/money-and-currency.md for the full rationale (exact decimal precision,
no floats, JSON-as-string serialization).

NUMERIC(19, 4): 15 integer digits + 4 decimal places. Comfortably covers any
realistic account balance while keeping sub-unit precision for rates/fees.
"""

from decimal import Decimal
from typing import Annotated

from sqlalchemy import Numeric, String
from sqlalchemy.orm import mapped_column

MoneyAmount = Annotated[Decimal, mapped_column(Numeric(19, 4))]
CurrencyCode = Annotated[str, mapped_column(String(3))]

# Exchange rates need more decimal precision than money amounts (e.g. BRL/JPY
# can have many significant digits) but bound the integer part more tightly.
ExchangeRateValue = Annotated[Decimal, mapped_column(Numeric(19, 10))]

# Budget allocation percentages: 0-100, with sub-percent precision. 3
# integer digits is all that's meaningful for a percentage.
PercentageValue = Annotated[Decimal, mapped_column(Numeric(7, 4))]
