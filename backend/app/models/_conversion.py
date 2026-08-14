"""Shared conversion vocabulary for Transaction and RecurringRule's
template - both carry an identical set of `conversion_*` columns (see
docs/money-and-currency.md), and this is the one place their shape and
CHECK constraints are defined so the two can't drift apart.
"""

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import CheckConstraint

CONVERSION_SOURCE_MANUAL = "manual"
CONVERSION_SOURCE_QUOTE = "quote"
CONVERSION_SOURCE_FALLBACK = "fallback"
CONVERSION_SOURCES = (CONVERSION_SOURCE_MANUAL, CONVERSION_SOURCE_QUOTE, CONVERSION_SOURCE_FALLBACK)


@dataclass(frozen=True)
class ConversionValue:
    """The read-side shape of a set of conversion_* columns, matching the
    frontend's nested TransactionConversion object exactly."""

    amount: Decimal
    currency: str
    fee: Decimal | None
    rate: Decimal
    source: str


def conversion_constraints(table: str, prefix: str) -> tuple[CheckConstraint, ...]:
    """The all-or-nothing + sign invariants for one set of conversion_*
    columns, given the table name (for constraint naming) and column prefix.
    """
    a, c, f, r, s = (f"{prefix}{name}" for name in ("amount", "currency", "fee", "rate", "source"))
    quoted_sources = ", ".join(f"'{value}'" for value in CONVERSION_SOURCES)
    return (
        CheckConstraint(
            f"({a} IS NULL AND {c} IS NULL AND {r} IS NULL AND {s} IS NULL AND {f} IS NULL)"
            f" OR ({a} IS NOT NULL AND {c} IS NOT NULL AND {r} IS NOT NULL AND {s} IS NOT NULL)",
            name=f"ck_{table}_conversion_all_or_nothing",
        ),
        CheckConstraint(f"{a} IS NULL OR {a} > 0", name=f"ck_{table}_conversion_amount_positive"),
        CheckConstraint(f"{f} IS NULL OR {f} >= 0", name=f"ck_{table}_conversion_fee_non_negative"),
        CheckConstraint(f"{r} IS NULL OR {r} > 0", name=f"ck_{table}_conversion_rate_positive"),
        CheckConstraint(
            f"{s} IS NULL OR {s} IN ({quoted_sources})", name=f"ck_{table}_conversion_source"
        ),
    )
