"""Investment wallets, assets, transactions, and computed positions."""

from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models.investment import InvestmentAsset, InvestmentTransaction, InvestmentWallet
from app.schemas.common import ArchiveRequest
from app.schemas.investment import (
    InvestmentAssetCreate,
    InvestmentAssetRead,
    InvestmentAssetUpdate,
    InvestmentPositionRead,
    InvestmentSummaryRead,
    InvestmentTransactionCreate,
    InvestmentTransactionRead,
    InvestmentTransactionUpdate,
    InvestmentWalletCreate,
    InvestmentWalletRead,
    InvestmentWalletUpdate,
)
from app.services import asset_quotes, investment_positions
from app.services import investments as investments_service
from app.services.currencies import get_active_currency
from app.services.exchange_rates import get_exchange_rate

router = APIRouter(prefix="/investments", tags=["investments"])


async def _position_read(
    db: DbSession,
    user_id: UUID,
    wallet: InvestmentWallet,
    position: investment_positions.Position,
    price_result: asset_quotes.PriceResult,
) -> InvestmentPositionRead:
    price = price_result.price
    market_value: Decimal | None = None
    unrealized_gain: Decimal | None = None
    market_value_is_fallback = False
    if price is not None:
        market_value = position.quantity * price
        if position.asset.currency != wallet.currency:
            rate = await get_exchange_rate(
                db, position.asset.currency, wallet.currency, user_id=user_id
            )
            market_value *= rate.rate
            market_value_is_fallback = rate.is_fallback
        wallet_currency = await get_active_currency(db, wallet.currency)
        market_value = market_value.quantize(
            Decimal(1).scaleb(-wallet_currency.decimal_digits), rounding=ROUND_HALF_UP
        )
        unrealized_gain = market_value - position.book_value

    return InvestmentPositionRead(
        asset=InvestmentAssetRead.model_validate(position.asset),
        quantity=position.quantity,
        average_cost=position.average_cost,
        book_value=position.book_value,
        price=price,
        price_as_of=price_result.as_of,
        price_is_stale=price_result.is_stale,
        market_value=market_value,
        unrealized_gain=unrealized_gain,
        realized_gain=position.realized_gain,
        dividend_income=position.dividend_income,
        fees_paid=position.fees_paid,
        market_value_is_fallback=market_value_is_fallback,
    )


@router.get("/summary", response_model=InvestmentSummaryRead)
async def get_summary(user: CurrentUser, db: DbSession) -> InvestmentSummaryRead:
    wallets = await investments_service.list_wallets(db, user.id)
    if not wallets:
        return InvestmentSummaryRead(
            total_book_value=Decimal("0"),
            total_market_value=Decimal("0"),
            total_unrealized_gain=Decimal("0"),
            wallet_count=0,
        )

    # ponytail: totals use the first wallet's currency; add per-currency
    # conversion when cross-currency aggregation becomes necessary.
    total_currency = wallets[0].currency
    positions_by_wallet: dict[UUID, list[investment_positions.Position]] = {}
    all_positions: list[investment_positions.Position] = []
    for wallet in wallets:
        wallet_positions = await investment_positions.get_wallet_positions(db, user.id, wallet.id)
        positions_by_wallet[wallet.id] = wallet_positions
        all_positions.extend(wallet_positions)
    price_map = await _price_map(db, user.id, all_positions)

    total_book_value = Decimal("0")
    market_values: list[Decimal | None] = []
    unrealized_gains: list[Decimal | None] = []
    for wallet in wallets:
        if wallet.currency != total_currency:
            continue
        for position in positions_by_wallet[wallet.id]:
            read = await _position_read(db, user.id, wallet, position, price_map[position.asset.id])
            total_book_value += position.book_value
            market_values.append(read.market_value)
            unrealized_gains.append(read.unrealized_gain)

    return InvestmentSummaryRead(
        total_book_value=total_book_value,
        total_market_value=(
            None
            if any(value is None for value in market_values)
            else sum((value for value in market_values if value is not None), Decimal("0"))
        ),
        total_unrealized_gain=(
            None
            if any(value is None for value in unrealized_gains)
            else sum((value for value in unrealized_gains if value is not None), Decimal("0"))
        ),
        wallet_count=len(wallets),
    )


async def _price_map(
    db: DbSession,
    user_id: UUID,
    positions: list[investment_positions.Position],
) -> dict[UUID, asset_quotes.PriceResult]:
    return await asset_quotes.get_asset_prices(
        db, user_id, [position.asset for position in positions]
    )


@router.get("/wallets", response_model=list[InvestmentWalletRead])
async def list_wallets(user: CurrentUser, db: DbSession) -> list[InvestmentWallet]:
    return await investments_service.list_wallets(db, user.id)


@router.post("/wallets", response_model=InvestmentWalletRead, status_code=status.HTTP_201_CREATED)
async def create_wallet(
    payload: InvestmentWalletCreate, user: CurrentUser, db: DbSession
) -> InvestmentWallet:
    wallet, _account = await investments_service.create_wallet(db, user.id, payload)
    return wallet


@router.get("/wallets/{wallet_id}", response_model=InvestmentWalletRead)
async def get_wallet(wallet_id: UUID, user: CurrentUser, db: DbSession) -> InvestmentWallet:
    return await investments_service.get_wallet(db, user.id, wallet_id)


@router.patch("/wallets/{wallet_id}", response_model=InvestmentWalletRead)
async def update_wallet(
    wallet_id: UUID, payload: InvestmentWalletUpdate, user: CurrentUser, db: DbSession
) -> InvestmentWallet:
    return await investments_service.update_wallet(db, user.id, wallet_id, payload)


@router.post("/wallets/{wallet_id}/archive", response_model=InvestmentWalletRead)
async def archive_wallet(
    wallet_id: UUID, payload: ArchiveRequest, user: CurrentUser, db: DbSession
) -> InvestmentWallet:
    wallet, _account = await investments_service.set_wallet_archived(
        db, user.id, wallet_id, payload.archived
    )
    return wallet


@router.get("/wallets/{wallet_id}/positions", response_model=list[InvestmentPositionRead])
async def list_positions(
    wallet_id: UUID, user: CurrentUser, db: DbSession
) -> list[InvestmentPositionRead]:
    wallet = await investments_service.get_wallet(db, user.id, wallet_id)
    positions = await investment_positions.get_wallet_positions(db, user.id, wallet.id)
    price_map = await _price_map(db, user.id, positions)
    return [
        await _position_read(db, user.id, wallet, position, price_map[position.asset.id])
        for position in positions
    ]


@router.get("/wallets/{wallet_id}/transactions", response_model=list[InvestmentTransactionRead])
async def list_transactions(
    wallet_id: UUID,
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[InvestmentTransaction]:
    return await investments_service.list_wallet_transactions(
        db, user.id, wallet_id, limit=limit, offset=offset
    )


@router.get("/assets", response_model=list[InvestmentAssetRead])
async def list_assets(user: CurrentUser, db: DbSession) -> list[InvestmentAsset]:
    return await investments_service.list_assets(db, user.id)


@router.post("/assets", response_model=InvestmentAssetRead, status_code=status.HTTP_201_CREATED)
async def create_asset(
    payload: InvestmentAssetCreate, user: CurrentUser, db: DbSession
) -> InvestmentAsset:
    return await investments_service.create_asset(db, user.id, payload)


@router.get("/assets/{asset_id}", response_model=InvestmentAssetRead)
async def get_asset(asset_id: UUID, user: CurrentUser, db: DbSession) -> InvestmentAsset:
    return await investments_service.get_asset(db, user.id, asset_id)


@router.patch("/assets/{asset_id}", response_model=InvestmentAssetRead)
async def update_asset(
    asset_id: UUID, payload: InvestmentAssetUpdate, user: CurrentUser, db: DbSession
) -> InvestmentAsset:
    return await investments_service.update_asset(db, user.id, asset_id, payload)


@router.post("/assets/{asset_id}/archive", response_model=InvestmentAssetRead)
async def archive_asset(
    asset_id: UUID, payload: ArchiveRequest, user: CurrentUser, db: DbSession
) -> InvestmentAsset:
    return await investments_service.set_asset_archived(db, user.id, asset_id, payload.archived)


@router.post(
    "/transactions", response_model=InvestmentTransactionRead, status_code=status.HTTP_201_CREATED
)
async def create_transaction(
    payload: InvestmentTransactionCreate, user: CurrentUser, db: DbSession
) -> InvestmentTransaction:
    return await investments_service.create_investment_transaction(db, user.id, payload)


@router.get("/transactions/{transaction_id}", response_model=InvestmentTransactionRead)
async def get_transaction(
    transaction_id: UUID, user: CurrentUser, db: DbSession
) -> InvestmentTransaction:
    return await investments_service.get_investment_transaction(db, user.id, transaction_id)


@router.patch("/transactions/{transaction_id}", response_model=InvestmentTransactionRead)
async def update_transaction(
    transaction_id: UUID,
    payload: InvestmentTransactionUpdate,
    user: CurrentUser,
    db: DbSession,
) -> InvestmentTransaction:
    return await investments_service.update_investment_transaction(
        db, user.id, transaction_id, payload
    )


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(transaction_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await investments_service.delete_investment_transaction(db, user.id, transaction_id)
