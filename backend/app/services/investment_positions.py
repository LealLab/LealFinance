"""Average-cost positions derived from the investment transaction ledger."""

from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.investment import InvestmentAsset, InvestmentTransaction, InvestmentWallet
from app.services import ownership


@dataclass
class Position:
    asset: InvestmentAsset
    quantity: Decimal
    average_cost: Decimal
    book_value: Decimal
    realized_gain: Decimal
    dividend_income: Decimal
    fees_paid: Decimal


def _fold(asset: InvestmentAsset, rows: list[InvestmentTransaction]) -> Position:
    quantity = Decimal("0")
    cost = Decimal("0")
    realized_gain = Decimal("0")
    dividend_income = Decimal("0")
    fees_paid = Decimal("0")

    for row in rows:
        if row.type == "buy":
            assert row.quantity is not None and row.price is not None
            quantity += row.quantity
            cost += row.quantity * row.price + row.fee
        elif row.type == "sell":
            assert row.quantity is not None and row.price is not None
            if quantity <= 0 or row.quantity > quantity:
                raise ValueError("cannot sell more than the held quantity")
            average_cost = cost / quantity
            realized_gain += row.quantity * row.price - row.fee - average_cost * row.quantity
            quantity -= row.quantity
            cost -= average_cost * row.quantity
            if quantity == 0:
                cost = Decimal("0")
        elif row.type == "dividend":
            dividend_income += row.amount
        elif row.type == "fee":
            fees_paid += row.amount

    average_cost = cost / quantity if quantity > 0 else Decimal("0")
    return Position(
        asset=asset,
        quantity=quantity,
        average_cost=average_cost,
        book_value=cost,
        realized_gain=realized_gain,
        dividend_income=dividend_income,
        fees_paid=fees_paid,
    )


async def _rows_for_wallet(
    db: AsyncSession,
    user_id: UUID,
    wallet_id: UUID,
    asset_id: UUID | None = None,
    exclude_transaction_id: UUID | None = None,
) -> list[InvestmentTransaction]:
    query = ownership.owned(InvestmentTransaction, user_id).where(
        InvestmentTransaction.wallet_id == wallet_id
    )
    if asset_id is not None:
        query = query.where(InvestmentTransaction.asset_id == asset_id)
    if exclude_transaction_id is not None:
        query = query.where(InvestmentTransaction.id != exclude_transaction_id)
    query = query.order_by(
        InvestmentTransaction.date,
        InvestmentTransaction.created_at,
        InvestmentTransaction.id,
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_wallet_positions(db: AsyncSession, user_id: UUID, wallet_id: UUID) -> list[Position]:
    await ownership.get_owned(db, InvestmentWallet, wallet_id, user_id)
    rows = await _rows_for_wallet(db, user_id, wallet_id)
    asset_ids = list(dict.fromkeys(row.asset_id for row in rows if row.asset_id is not None))
    assets = await ownership.get_many_owned(db, InvestmentAsset, asset_ids, user_id)
    return [
        _fold(assets[asset_id], [row for row in rows if row.asset_id == asset_id])
        for asset_id in asset_ids
    ]


async def get_position(
    db: AsyncSession,
    user_id: UUID,
    wallet_id: UUID,
    asset_id: UUID,
    *,
    exclude_transaction_id: UUID | None = None,
) -> Position:
    await ownership.get_owned(db, InvestmentWallet, wallet_id, user_id)
    asset = await ownership.get_owned(db, InvestmentAsset, asset_id, user_id)
    rows = await _rows_for_wallet(
        db,
        user_id,
        wallet_id,
        asset_id=asset_id,
        exclude_transaction_id=exclude_transaction_id,
    )
    return _fold(asset, rows)
