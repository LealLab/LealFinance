"""Investment wallet, asset, and transaction CRUD with optional cash legs."""

import re
from dataclasses import dataclass, replace
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ValidationAppError
from app.models.account import ACCOUNT_TYPE_INVESTMENT, Account
from app.models.institution import Institution
from app.models.investment import (
    ASSET_CLASS_CRYPTO,
    INVESTMENT_TRANSACTION_TYPE_BUY,
    INVESTMENT_TRANSACTION_TYPE_DIVIDEND,
    INVESTMENT_TRANSACTION_TYPE_FEE,
    INVESTMENT_TRANSACTION_TYPE_SELL,
    InvestmentAsset,
    InvestmentTransaction,
    InvestmentWallet,
)
from app.models.transaction import TRANSACTION_TYPE_TRANSFER, Transaction
from app.models.user import User
from app.schemas.investment import (
    InvestmentAssetCreate,
    InvestmentAssetUpdate,
    InvestmentTransactionCreate,
    InvestmentTransactionUpdate,
    InvestmentWalletCreate,
    InvestmentWalletUpdate,
)
from app.schemas.transaction import ConversionInput as ConversionInputSchema
from app.schemas.transaction import TransactionCreate
from app.services import accounts as accounts_service
from app.services import asset_quotes, investment_positions, ownership
from app.services.conversion import ConversionInput
from app.services.currencies import get_active_currency
from app.services.exchange_rates import (
    ensure_rates_cached,
    get_exchange_rate,
    to_conversion_source,
)
from app.services.transactions import build_transaction

_B3_SYMBOL = re.compile(r"^[A-Z]{4}\d{1,2}$")


class InvestmentPreviewChanged(Exception):
    def __init__(self, preview: dict[str, object]) -> None:
        super().__init__("Investment values changed since approval was requested")
        self.preview = preview


async def _base_currency(db: AsyncSession, user_id: UUID) -> str:
    currency = await db.scalar(select(User.base_currency).where(User.id == user_id))
    assert currency is not None
    await get_active_currency(db, currency)
    return currency


async def list_wallets(db: AsyncSession, user_id: UUID) -> list[InvestmentWallet]:
    return list(await ownership.list_owned(db, InvestmentWallet, user_id))


async def get_wallet(db: AsyncSession, user_id: UUID, wallet_id: UUID) -> InvestmentWallet:
    return await ownership.get_owned(db, InvestmentWallet, wallet_id, user_id)


async def create_wallet(
    db: AsyncSession, user_id: UUID, data: InvestmentWalletCreate
) -> tuple[InvestmentWallet, Account]:
    currency = await _base_currency(db, user_id)
    await ownership.get_owned_or_none(db, Account, data.cash_account_id, user_id)
    await ownership.get_owned_or_none(db, Institution, data.institution_id, user_id)

    account = Account(
        user_id=user_id,
        name=data.name,
        type=ACCOUNT_TYPE_INVESTMENT,
        currency=currency,
        opening_balance=0,
        institution_id=data.institution_id,
        archived=data.archived,
    )
    db.add(account)
    try:
        await db.flush()
        wallet = InvestmentWallet(
            user_id=user_id, account_id=account.id, currency=currency, **data.model_dump()
        )
        db.add(wallet)
        await ensure_rates_cached(db)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(account)
    await db.refresh(wallet)
    return wallet, account


async def update_wallet(
    db: AsyncSession, user_id: UUID, wallet_id: UUID, data: InvestmentWalletUpdate
) -> InvestmentWallet:
    wallet = await get_wallet(db, user_id, wallet_id)
    account = await ownership.get_owned(db, Account, wallet.account_id, user_id)
    changes = data.model_dump(exclude_unset=True)

    if "currency" in changes:
        await get_active_currency(db, changes["currency"])
    if "cash_account_id" in changes:
        await ownership.get_owned_or_none(db, Account, changes["cash_account_id"], user_id)
    if "institution_id" in changes:
        await ownership.get_owned_or_none(db, Institution, changes["institution_id"], user_id)

    currency = changes.get("currency", wallet.currency)
    if currency != account.currency and await accounts_service.account_has_ledger_references(
        db, account.id, account.user_id
    ):
        raise ValidationAppError(code="investment_wallet.currency_in_use")

    if "name" in changes:
        account.name = changes["name"]
    if "currency" in changes:
        account.currency = currency
    if "institution_id" in changes:
        account.institution_id = changes["institution_id"]
    for field, value in changes.items():
        setattr(wallet, field, value)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(wallet)
    return wallet


async def set_wallet_archived(
    db: AsyncSession, user_id: UUID, wallet_id: UUID, archived: bool
) -> tuple[InvestmentWallet, Account]:
    wallet = await get_wallet(db, user_id, wallet_id)
    account = await ownership.get_owned(db, Account, wallet.account_id, user_id)
    wallet.archived = archived
    account.archived = archived
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(wallet)
    await db.refresh(account)
    return wallet, account


async def list_assets(db: AsyncSession, user_id: UUID) -> list[InvestmentAsset]:
    return list(await ownership.list_owned(db, InvestmentAsset, user_id))


async def get_asset(db: AsyncSession, user_id: UUID, asset_id: UUID) -> InvestmentAsset:
    return await ownership.get_owned(db, InvestmentAsset, asset_id, user_id)


async def _check_asset_available(
    db: AsyncSession, user_id: UUID, symbol: str, exclude_asset_id: UUID | None = None
) -> None:
    query = ownership.owned(InvestmentAsset, user_id).where(InvestmentAsset.symbol == symbol)
    if exclude_asset_id is not None:
        query = query.where(InvestmentAsset.id != exclude_asset_id)
    if await db.scalar(query.with_only_columns(InvestmentAsset.id)) is not None:
        raise ConflictError(code="investment_asset.symbol_already_exists")


async def create_asset(
    db: AsyncSession, user_id: UUID, data: InvestmentAssetCreate
) -> InvestmentAsset:
    await get_active_currency(db, data.currency)
    await _check_asset_available(db, user_id, data.symbol)
    quote_provider = data.quote_provider
    if quote_provider == "manual":
        if data.asset_class == ASSET_CLASS_CRYPTO:
            quote_provider = "coingecko"
        elif _B3_SYMBOL.match(data.symbol.upper()):
            quote_provider = "brapi"
    asset = InvestmentAsset(
        user_id=user_id,
        **data.model_dump(exclude={"quote_provider"}),
        quote_provider=quote_provider,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return asset


async def update_asset(
    db: AsyncSession, user_id: UUID, asset_id: UUID, data: InvestmentAssetUpdate
) -> InvestmentAsset:
    asset = await get_asset(db, user_id, asset_id)
    changes = data.model_dump(exclude_unset=True)
    if "currency" in changes:
        await get_active_currency(db, changes["currency"])
    if "symbol" in changes:
        await _check_asset_available(db, user_id, changes["symbol"], exclude_asset_id=asset_id)
    for field, value in changes.items():
        setattr(asset, field, value)
    await db.commit()
    await db.refresh(asset)
    return asset


async def set_asset_archived(
    db: AsyncSession, user_id: UUID, asset_id: UUID, archived: bool
) -> InvestmentAsset:
    asset = await get_asset(db, user_id, asset_id)
    asset.archived = archived
    await db.commit()
    await db.refresh(asset)
    return asset


async def list_wallet_transactions(
    db: AsyncSession,
    user_id: UUID,
    wallet_id: UUID,
    *,
    limit: int | None = None,
    offset: int = 0,
) -> list[InvestmentTransaction]:
    await get_wallet(db, user_id, wallet_id)
    query = ownership.owned(InvestmentTransaction, user_id).where(
        InvestmentTransaction.wallet_id == wallet_id
    )
    query = query.order_by(InvestmentTransaction.date.desc(), InvestmentTransaction.id.desc())
    if limit is not None:
        query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_investment_transaction(
    db: AsyncSession, user_id: UUID, transaction_id: UUID
) -> InvestmentTransaction:
    return await ownership.get_owned(db, InvestmentTransaction, transaction_id, user_id)


def _validate_shape(
    type_: str, asset_id: UUID | None, quantity: Decimal | None, price: Decimal | None
) -> None:
    if type_ == INVESTMENT_TRANSACTION_TYPE_SELL and (
        asset_id is None or quantity is None or price is None
    ):
        raise ValidationAppError(code="investment_transaction.quantity_price_required")
    if type_ == INVESTMENT_TRANSACTION_TYPE_BUY and ((quantity is None) != (price is None)):
        raise ValidationAppError(code="investment_transaction.quantity_price_required")
    if type_ in (INVESTMENT_TRANSACTION_TYPE_DIVIDEND, INVESTMENT_TRANSACTION_TYPE_FEE) and (
        quantity is not None or price is not None
    ):
        raise ValidationAppError(code="investment_transaction.quantity_price_not_allowed")
    if type_ != INVESTMENT_TRANSACTION_TYPE_FEE and asset_id is None:
        raise ValidationAppError(code="investment_transaction.asset_required")


def _with_derived_amount(
    data: InvestmentTransactionCreate, decimal_digits: int
) -> InvestmentTransactionCreate:
    """For buy/sell, `amount` is the trade subtotal (quantity * price) -
    derived server-side rather than trusted from the client, so cash
    settlement here and the position fold's cost basis
    (investment_positions.py, which independently computes quantity * price)
    can never silently disagree."""
    if data.type not in (INVESTMENT_TRANSACTION_TYPE_BUY, INVESTMENT_TRANSACTION_TYPE_SELL):
        return data
    assert data.quantity is not None and data.price is not None
    quantum = Decimal(1).scaleb(-decimal_digits)
    derived = (data.quantity * data.price).quantize(quantum, rounding=ROUND_HALF_UP)
    return data.model_copy(update={"amount": derived})


async def _resolve_amount_mode(
    db: AsyncSession,
    user_id: UUID,
    data: InvestmentTransactionCreate,
    *,
    cache_quote: bool = True,
) -> InvestmentTransactionCreate:
    if data.type != INVESTMENT_TRANSACTION_TYPE_BUY or (
        data.quantity is not None or data.price is not None
    ):
        return data
    if data.date > date.today():
        raise ValidationAppError(code="investment_transaction.future_date")
    net_amount = data.amount - data.fee
    if net_amount <= 0:
        raise ValidationAppError(code="investment_transaction.settlement_amount_not_positive")
    assert data.asset_id is not None
    asset = await ownership.get_owned(db, InvestmentAsset, data.asset_id, user_id)
    quote = await asset_quotes.get_asset_price(db, user_id, asset, data.date, cache=cache_quote)
    if quote.price is None or quote.price <= 0:
        raise ValidationAppError(code="investment_transaction.price_unavailable")
    # quote.price is denominated in asset.currency; net_amount (and the price
    # stored on the transaction) must be in the wallet's currency, same as
    # the quantity/price entry mode.
    price = quote.price
    if asset.currency != data.currency:
        rate_result = await get_exchange_rate(
            db, asset.currency, data.currency, user_id=user_id, as_of=data.date
        )
        price = price * rate_result.rate
    quantity = (net_amount / price).quantize(Decimal(1).scaleb(-10), rounding=ROUND_HALF_UP)
    if quantity <= 0:
        raise ValidationAppError(code="investment_transaction.settlement_amount_not_positive")
    return data.model_copy(update={"quantity": quantity, "price": price})


async def _validate_transaction(
    db: AsyncSession,
    user_id: UUID,
    wallet_id: UUID,
    asset_id: UUID | None,
    type_: str,
    quantity: Decimal | None,
    price: Decimal | None,
    currency: str,
    exclude_transaction_id: UUID | None = None,
) -> tuple[InvestmentWallet, InvestmentAsset | None]:
    wallet = await get_wallet(db, user_id, wallet_id)
    asset = await ownership.get_owned_or_none(db, InvestmentAsset, asset_id, user_id)
    _validate_shape(type_, asset_id, quantity, price)
    # The position fold (investment_positions.py) sums amount/quantity*price
    # across every row for an asset with no currency conversion - a
    # mixed-currency ledger would silently corrupt the cost basis, so every
    # transaction must be recorded in the wallet's own currency. (The
    # *asset*'s currency may still differ, e.g. a BRL wallet holding a
    # USD-priced asset - that only affects market-value conversion at read
    # time, in api/v1/investments.py.)
    if currency != wallet.currency:
        raise ValidationAppError(code="investment_transaction.currency_must_match_wallet")
    if type_ == INVESTMENT_TRANSACTION_TYPE_SELL:
        assert asset is not None and quantity is not None
        position = await investment_positions.get_position(
            db,
            user_id,
            wallet.id,
            asset.id,
            exclude_transaction_id=exclude_transaction_id,
        )
        if quantity > position.quantity:
            raise ValidationAppError(code="investment_transaction.insufficient_quantity")
    return wallet, asset


@dataclass(frozen=True, slots=True)
class _CashSettlement:
    amount: Decimal
    currency: str
    source_account_id: UUID
    destination_account_id: UUID
    conversion: ConversionInput | None
    conversion_amount: Decimal | None


@dataclass(frozen=True, slots=True)
class _PreparedInvestmentTransaction:
    data: InvestmentTransactionCreate
    wallet: InvestmentWallet
    cash_account: Account | None
    settlement: _CashSettlement | None


async def _calculate_cash_settlement(
    db: AsyncSession,
    user_id: UUID,
    wallet: InvestmentWallet,
    cash_account: Account,
    data: InvestmentTransactionCreate,
) -> _CashSettlement:
    if data.type == INVESTMENT_TRANSACTION_TYPE_BUY:
        source_account_id = cash_account.id
        destination_account_id = wallet.account_id
        total = data.amount + data.fee
        transfer_currency = cash_account.currency
        if cash_account.currency == wallet.currency:
            transfer_amount = total
            conversion = None
            conversion_amount = None
        else:
            rate_result = await get_exchange_rate(
                db, cash_account.currency, wallet.currency, user_id=user_id, as_of=data.date
            )
            cash_currency = await get_active_currency(db, cash_account.currency)
            transfer_amount = (total / rate_result.rate).quantize(
                Decimal(1).scaleb(-cash_currency.decimal_digits), rounding=ROUND_HALF_UP
            )
            conversion = ConversionInput(
                amount=None,
                currency=wallet.currency,
                fee=None,
                rate=rate_result.rate,
                source=to_conversion_source(rate_result),
            )
            destination_currency = await get_active_currency(db, wallet.currency)
            conversion_amount = (transfer_amount * rate_result.rate).quantize(
                Decimal(1).scaleb(-destination_currency.decimal_digits), rounding=ROUND_HALF_UP
            )
    else:
        await ownership.get_owned(db, Account, wallet.account_id, user_id)
        source_account_id = wallet.account_id
        destination_account_id = cash_account.id
        transfer_amount = data.amount - data.fee
        if transfer_amount <= 0:
            raise ValidationAppError(code="investment_transaction.settlement_amount_not_positive")
        transfer_currency = wallet.currency
        if wallet.currency == cash_account.currency:
            conversion = None
            conversion_amount = None
        else:
            rate_result = await get_exchange_rate(
                db, wallet.currency, cash_account.currency, user_id=user_id, as_of=data.date
            )
            conversion = ConversionInput(
                amount=None,
                currency=cash_account.currency,
                fee=None,
                rate=rate_result.rate,
                source=to_conversion_source(rate_result),
            )
            destination_currency = await get_active_currency(db, cash_account.currency)
            conversion_amount = (transfer_amount * rate_result.rate).quantize(
                Decimal(1).scaleb(-destination_currency.decimal_digits), rounding=ROUND_HALF_UP
            )

    if transfer_amount <= 0:
        raise ValidationAppError(code="investment_transaction.settlement_amount_not_positive")
    return _CashSettlement(
        amount=transfer_amount,
        currency=transfer_currency,
        source_account_id=source_account_id,
        destination_account_id=destination_account_id,
        conversion=conversion,
        conversion_amount=conversion_amount,
    )


async def _prepare_investment_transaction(
    db: AsyncSession,
    user_id: UUID,
    data: InvestmentTransactionCreate,
    *,
    exclude_transaction_id: UUID | None = None,
    cache_quote: bool = True,
    settle_cash: bool = True,
) -> _PreparedInvestmentTransaction:
    currency = await get_active_currency(db, data.currency)
    wallet, _asset = await _validate_transaction(
        db,
        user_id,
        data.wallet_id,
        data.asset_id,
        data.type,
        data.quantity,
        data.price,
        data.currency,
        exclude_transaction_id=exclude_transaction_id,
    )
    data = await _resolve_amount_mode(db, user_id, data, cache_quote=cache_quote)
    data = _with_derived_amount(data, currency.decimal_digits)
    cash_account = await ownership.get_owned_or_none(db, Account, wallet.cash_account_id, user_id)
    settlement = None
    if (
        settle_cash
        and cash_account is not None
        and data.type
        in (
            INVESTMENT_TRANSACTION_TYPE_BUY,
            INVESTMENT_TRANSACTION_TYPE_SELL,
        )
    ):
        settlement = await _calculate_cash_settlement(db, user_id, wallet, cash_account, data)
    return _PreparedInvestmentTransaction(data, wallet, cash_account, settlement)


def _investment_preview(prepared: _PreparedInvestmentTransaction) -> dict[str, object]:
    data = prepared.data
    settlement = prepared.settlement
    conversion = None
    if settlement is not None and settlement.conversion is not None:
        conversion = {
            "amount": str(settlement.conversion_amount),
            "currency": settlement.conversion.currency,
            "fee": None,
            "rate": str(settlement.conversion.rate),
            "source": settlement.conversion.source,
        }
    return {
        "amount": str(data.amount),
        "quantity": None if data.quantity is None else format(data.quantity.normalize(), "f"),
        "price": None if data.price is None else str(data.price),
        "settlement": (
            None
            if settlement is None
            else {
                "amount": str(settlement.amount),
                "currency": settlement.currency,
                "source_account_id": str(settlement.source_account_id),
                "destination_account_id": str(settlement.destination_account_id),
                "conversion": conversion,
            }
        ),
    }


async def _settle_cash_leg(
    db: AsyncSession,
    user_id: UUID,
    wallet: InvestmentWallet,
    cash_account: Account,
    data: InvestmentTransactionCreate,
    settlement: _CashSettlement | None = None,
) -> Transaction:
    settlement = settlement or await _calculate_cash_settlement(
        db, user_id, wallet, cash_account, data
    )
    ledger_transaction = await build_transaction(
        db,
        user_id,
        TransactionCreate(
            type=TRANSACTION_TYPE_TRANSFER,
            date=data.date,
            amount=settlement.amount,
            currency=settlement.currency,
            account_id=settlement.source_account_id,
            to_account_id=settlement.destination_account_id,
            description=f"Investment {data.type}",
            conversion=(
                None
                if settlement.conversion is None
                else ConversionInputSchema(
                    amount=settlement.conversion.amount,
                    currency=settlement.conversion.currency,
                    fee=settlement.conversion.fee,
                    rate=settlement.conversion.rate,
                    source=settlement.conversion.source,
                )
            ),
        ),
        source="investment",
    )
    await db.flush()
    return ledger_transaction


async def create_investment_transaction(
    db: AsyncSession,
    user_id: UUID,
    data: InvestmentTransactionCreate,
    *,
    expected_preview: dict[str, object] | None = None,
) -> InvestmentTransaction:
    prepared = await _prepare_investment_transaction(
        db, user_id, data, cache_quote=expected_preview is None
    )
    if (
        expected_preview is not None
        and (preview := _investment_preview(prepared)) != expected_preview
    ):
        raise InvestmentPreviewChanged(preview)
    data = prepared.data
    transaction = InvestmentTransaction(user_id=user_id, **data.model_dump())
    db.add(transaction)
    try:
        await db.flush()
        if prepared.cash_account is not None and prepared.settlement is not None:
            posted = await _settle_cash_leg(
                db,
                user_id,
                prepared.wallet,
                prepared.cash_account,
                data,
                prepared.settlement,
            )
            transaction.transaction_id = posted.id
        # ponytail: dividends and fees are not auto-settled in v1; add a
        # user-selected investment income/expense category when one exists.
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(transaction)
    return transaction


def _effective_transaction(
    transaction: InvestmentTransaction, changes: dict[str, object]
) -> InvestmentTransactionCreate:
    values = {
        "wallet_id": changes.get("wallet_id", transaction.wallet_id),
        "asset_id": changes.get("asset_id", transaction.asset_id),
        "type": changes.get("type", transaction.type),
        "date": changes.get("date", transaction.date),
        "quantity": changes.get("quantity", transaction.quantity),
        "price": changes.get("price", transaction.price),
        "amount": changes.get("amount", transaction.amount),
        "fee": changes.get("fee", transaction.fee),
        "currency": changes.get("currency", transaction.currency),
        "notes": changes.get("notes", transaction.notes),
    }
    return InvestmentTransactionCreate.model_validate(values)


def _update_effective_transaction(
    transaction: InvestmentTransaction, data: InvestmentTransactionUpdate
) -> tuple[InvestmentTransactionCreate, dict[str, object], bool]:
    changes = data.model_dump(exclude_unset=True)
    effective = _effective_transaction(transaction, changes)
    if (
        effective.type == INVESTMENT_TRANSACTION_TYPE_BUY
        and "amount" in changes
        and not ({"quantity", "price"} & changes.keys())
    ):
        effective = effective.model_copy(update={"quantity": None, "price": None})
    amount_mode = effective.type == INVESTMENT_TRANSACTION_TYPE_BUY and (
        effective.quantity is None and effective.price is None
    )
    return effective, changes, amount_mode


async def preview_create_investment_transaction(
    db: AsyncSession, user_id: UUID, data: InvestmentTransactionCreate
) -> dict[str, object]:
    return _investment_preview(
        await _prepare_investment_transaction(db, user_id, data, cache_quote=False)
    )


async def preview_update_investment_transaction(
    db: AsyncSession,
    user_id: UUID,
    transaction_id: UUID,
    data: InvestmentTransactionUpdate,
) -> dict[str, object]:
    transaction = await get_investment_transaction(db, user_id, transaction_id)
    prepared, _changes, _settlement_changed = await _prepare_investment_update(
        db, user_id, transaction, data, cache_quote=False
    )
    return _investment_preview(prepared)


async def _prepare_investment_update(
    db: AsyncSession,
    user_id: UUID,
    transaction: InvestmentTransaction,
    data: InvestmentTransactionUpdate,
    *,
    cache_quote: bool,
) -> tuple[_PreparedInvestmentTransaction, dict[str, object], bool]:
    effective, changes, amount_mode = _update_effective_transaction(transaction, data)
    prepared = await _prepare_investment_transaction(
        db,
        user_id,
        effective,
        exclude_transaction_id=transaction.id,
        cache_quote=cache_quote,
        settle_cash=False,
    )
    effective = prepared.data
    if amount_mode and effective.quantity is not None and effective.price is not None:
        changes["quantity"] = effective.quantity
        changes["price"] = effective.price
    if "amount" in changes or effective.amount != transaction.amount:
        changes["amount"] = effective.amount

    settlement_changed = transaction.transaction_id is not None and bool(
        set(changes).intersection(
            {"wallet_id", "type", "date", "quantity", "price", "amount", "fee", "currency"}
        )
    )
    if (
        settlement_changed
        and prepared.cash_account is not None
        and effective.type
        in (
            INVESTMENT_TRANSACTION_TYPE_BUY,
            INVESTMENT_TRANSACTION_TYPE_SELL,
        )
    ):
        prepared = replace(
            prepared,
            settlement=await _calculate_cash_settlement(
                db, user_id, prepared.wallet, prepared.cash_account, effective
            ),
        )
    return prepared, changes, settlement_changed


async def update_investment_transaction(
    db: AsyncSession,
    user_id: UUID,
    transaction_id: UUID,
    data: InvestmentTransactionUpdate,
    *,
    expected_preview: dict[str, object] | None = None,
) -> InvestmentTransaction:
    transaction = await get_investment_transaction(db, user_id, transaction_id)
    prepared, changes, settlement_changed = await _prepare_investment_update(
        db, user_id, transaction, data, cache_quote=expected_preview is None
    )
    if (
        expected_preview is not None
        and (preview := _investment_preview(prepared)) != expected_preview
    ):
        raise InvestmentPreviewChanged(preview)
    effective = prepared.data
    try:
        if settlement_changed:
            assert transaction.transaction_id is not None
            old_ledger = await ownership.get_owned(
                db, Transaction, transaction.transaction_id, user_id
            )
            await db.delete(old_ledger)
            transaction.transaction_id = None
            if prepared.cash_account is not None and prepared.settlement is not None:
                posted = await _settle_cash_leg(
                    db,
                    user_id,
                    prepared.wallet,
                    prepared.cash_account,
                    effective,
                    prepared.settlement,
                )
                transaction.transaction_id = posted.id
        original_wallet_id = transaction.wallet_id
        original_asset_id = transaction.asset_id
        for field, value in changes.items():
            setattr(transaction, field, value)
        await db.flush()
        # Editing (or moving) this row can leave a *different*, later row -
        # e.g. a sell that already depends on this one's quantity -
        # unfoldable; check both where it used to live and where it lives
        # now, since either ledger could now be broken.
        for wallet_id, asset_id in {
            (original_wallet_id, original_asset_id),
            (transaction.wallet_id, transaction.asset_id),
        }:
            if asset_id is not None:
                await investment_positions.assert_ledger_still_folds(
                    db, user_id, wallet_id, asset_id
                )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    await db.refresh(transaction)
    return transaction


async def delete_investment_transaction(
    db: AsyncSession, user_id: UUID, transaction_id: UUID
) -> None:
    transaction = await get_investment_transaction(db, user_id, transaction_id)
    wallet_id, asset_id = transaction.wallet_id, transaction.asset_id
    try:
        if transaction.transaction_id is not None:
            ledger_transaction = await ownership.get_owned(
                db, Transaction, transaction.transaction_id, user_id
            )
            await db.delete(ledger_transaction)
        await db.delete(transaction)
        await db.flush()
        if asset_id is not None:
            await investment_positions.assert_ledger_still_folds(db, user_id, wallet_id, asset_id)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
