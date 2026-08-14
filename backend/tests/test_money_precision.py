"""Proves the MoneyAmount column type + string serialization contract.

No domain model exists yet (see CLAUDE.md - skeleton only), so this defines
a throwaway table scoped to this test module rather than testing a real
model. It exercises the exact same MoneyAmount/CurrencyCode types every
future money-bearing model is expected to reuse (app/models/types.py) and
the string-serialization rule from docs/money-and-currency.md: amounts must
never be serialized as JSON numbers, since NUMERIC(19,4) exceeds float64
precision and a JSON number would silently corrupt it.
"""

from decimal import Decimal

from pydantic import BaseModel, field_serializer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped

from app.models.base import UUIDPrimaryKeyMixin
from app.models.types import CurrencyCode, MoneyAmount

# A value with 15 integer digits and 4 decimal places - the full width
# NUMERIC(19, 4) is meant to hold, chosen specifically to break float64
# (which only has ~15-17 significant decimal digits total).
EXACT_AMOUNT = Decimal("123456789012345.4567")


class _ScratchBase(DeclarativeBase):
    """Isolated metadata so this scratch table never touches app.models.base.Base
    (and therefore never appears in the real Alembic-managed schema)."""


class _ScratchLedgerLine(_ScratchBase, UUIDPrimaryKeyMixin):
    """Test-only model - not part of the application schema."""

    __tablename__ = "_scratch_money_precision"

    amount: Mapped[MoneyAmount]
    currency: Mapped[CurrencyCode]


class _AmountRead(BaseModel):
    model_config = {"from_attributes": True}

    amount: Decimal
    currency: str

    @field_serializer("amount")
    def serialize_amount(self, value: Decimal) -> str:
        return str(value)


async def test_money_amount_round_trips_without_precision_loss(
    db_session: AsyncSession,
) -> None:
    # This table lives outside Base.metadata (see _ScratchBase above), so the
    # db_session fixture's create_all/drop_all never touches it - it's
    # created and dropped here instead, defensively idempotent so a prior
    # failed run never breaks this one.
    async with db_session.bind.begin() as conn:  # type: ignore[union-attr]
        await conn.run_sync(
            lambda sync_conn: _ScratchBase.metadata.drop_all(sync_conn, checkfirst=True)
        )
        await conn.run_sync(_ScratchBase.metadata.create_all)

    try:
        row = _ScratchLedgerLine(amount=EXACT_AMOUNT, currency="BRL")
        db_session.add(row)
        await db_session.commit()

        result = await db_session.execute(select(_ScratchLedgerLine))
        fetched = result.scalar_one()

        # 1. Decimal round-trips through Postgres exactly.
        assert fetched.amount == EXACT_AMOUNT

        # 2. Pydantic serializes it as a JSON *string*, preserving every digit
        #    - json.dumps(float(EXACT_AMOUNT)) would already have lost
        #    precision before this assertion even ran.
        payload = _AmountRead.model_validate(fetched)
        dumped = payload.model_dump(mode="json")
        assert dumped["amount"] == "123456789012345.4567"
        assert isinstance(dumped["amount"], str)
    finally:
        # db_session's SELECT above left it in an open transaction holding a
        # read lock on the scratch table. Dropping that table over a
        # *different* connection (bind.begin() below) would block forever
        # waiting for that lock - db_session's own transaction only ends
        # when the fixture tears down, which happens after this function
        # returns. Rolling back here releases it before we drop.
        await db_session.rollback()
        async with db_session.bind.begin() as conn:  # type: ignore[union-attr]
            await conn.run_sync(_ScratchBase.metadata.drop_all)
