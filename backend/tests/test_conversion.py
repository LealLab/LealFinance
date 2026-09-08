from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.services.conversion import ConversionInput, resolve_conversion


async def test_conversion_applies_fee_before_rate(db_session: AsyncSession) -> None:
    result = await resolve_conversion(
        db_session,
        origin_amount=Decimal("100"),
        origin_currency="BRL",
        destination_currency="USD",
        payload=ConversionInput(
            amount=Decimal("195"),
            currency="USD",
            fee=Decimal("2.5"),
            rate=Decimal("2"),
            source="manual",
        ),
    )

    assert result is not None
    assert result.amount == Decimal("195.00")


async def test_conversion_zero_fee_and_missing_amount_are_supported(
    db_session: AsyncSession,
) -> None:
    result = await resolve_conversion(
        db_session,
        origin_amount=Decimal("100"),
        origin_currency="USD",
        destination_currency="BRL",
        payload=ConversionInput(
            amount=None,
            currency="BRL",
            fee=None,
            rate=Decimal("5.25"),
            source="quote",
        ),
    )

    assert result is not None
    assert result.amount == Decimal("525.00")


async def test_conversion_accepts_one_quantum_tolerance_but_rejects_two(
    db_session: AsyncSession,
) -> None:
    payload = ConversionInput(
        amount=Decimal("1.24"),
        currency="BRL",
        fee=Decimal("0"),
        rate=Decimal("1.234"),
        source="manual",
    )
    result = await resolve_conversion(
        db_session,
        origin_amount=Decimal("1"),
        origin_currency="USD",
        destination_currency="BRL",
        payload=payload,
    )
    assert result is not None
    assert result.amount == Decimal("1.24")

    with pytest.raises(ValidationAppError, match="transaction.conversion_mismatch"):
        await resolve_conversion(
            db_session,
            origin_amount=Decimal("1"),
            origin_currency="USD",
            destination_currency="BRL",
            payload=payload._replace(amount=Decimal("1.25")),
        )


async def test_conversion_quantizes_cross_currency_destination(
    db_session: AsyncSession,
) -> None:
    result = await resolve_conversion(
        db_session,
        origin_amount=Decimal("10"),
        origin_currency="USD",
        destination_currency="JPY",
        payload=ConversionInput(
            amount=None,
            currency="JPY",
            fee=Decimal("0"),
            rate=Decimal("150.123"),
            source="quote",
        ),
    )

    assert result is not None
    assert result.amount == Decimal("1501")
