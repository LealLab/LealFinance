"""Cross-currency transaction validation, shared between transactions and
recurring-rule templates.

See docs/money-and-currency.md for the full rule: `conversion` records the
DESTINATION side of a cross-currency transaction - the account whose
currency differs from the transaction's own. Fee is deducted in the ORIGIN
currency before conversion: `converted = (amount - fee) * rate`. A saved
conversion is authoritative afterward and is never re-derived from a live
rate - but that's about later *reads*, not a reason to skip validating the
arithmetic at write time.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import NamedTuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models._conversion import ConversionValue
from app.services.currencies import get_active_currency

# One unit in the destination currency's last decimal place - the client
# rounds with different (Intl-adjacent) logic than ROUND_HALF_UP here, so a
# hard equality check would reject legitimate half-way values.
_TOLERANCE_UNITS = 1


class ConversionInput(NamedTuple):
    amount: Decimal | None
    currency: str
    fee: Decimal | None
    rate: Decimal
    source: str


async def resolve_conversion(
    db: AsyncSession,
    *,
    origin_amount: Decimal,
    origin_currency: str,
    destination_currency: str,
    payload: ConversionInput | None,
) -> ConversionValue | None:
    if origin_currency == destination_currency:
        if payload is not None:
            raise ValidationAppError(code="transaction.conversion_not_needed")
        return None

    if payload is None:
        raise ValidationAppError(code="transaction.conversion_required")
    if payload.currency != destination_currency:
        raise ValidationAppError(
            code="transaction.conversion_currency_mismatch",
            params={"expected": destination_currency, "received": payload.currency},
        )

    fee = payload.fee or Decimal("0")
    if fee >= origin_amount:
        raise ValidationAppError(code="transaction.conversion_fee_exceeds_amount")

    if payload.amount is not None and payload.amount <= 0:
        raise ValidationAppError(code="transaction.conversion_amount_not_positive")

    destination = await get_active_currency(db, destination_currency)
    quantum = Decimal(1).scaleb(-destination.decimal_digits)
    expected = ((origin_amount - fee) * payload.rate).quantize(quantum, rounding=ROUND_HALF_UP)

    if payload.amount is None:
        converted_amount = expected
    elif abs(payload.amount - expected) > quantum * _TOLERANCE_UNITS:
        raise ValidationAppError(
            code="transaction.conversion_mismatch",
            params={"expected": str(expected), "received": str(payload.amount)},
        )
    else:
        converted_amount = payload.amount

    return ConversionValue(
        amount=converted_amount,
        currency=payload.currency,
        fee=payload.fee,
        rate=payload.rate,
        source=payload.source,
    )
