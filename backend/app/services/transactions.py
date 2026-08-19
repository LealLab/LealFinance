"""Transaction CRUD and invariants: positive amount, transfer shape,
category kind matching, cross-currency conversion validation (see
app/services/conversion.py), and ownership on every referenced account/
category/recurring rule.

Negative derived balances are allowed - credit cards intentionally
support debt. This service never computes a balance itself (see the
frontend's domain/calc/balances.ts for the read-side formula); it only
validates and persists the ledger entry.

`validate_transaction_shape` is exported for reuse by
app/services/recurring_rules.py, since a rule's template is validated
against the exact same rules as a real transaction.
"""

from collections.abc import Sequence
from datetime import date as date_type
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models._conversion import ConversionValue
from app.models.account import Account
from app.models.category import Category
from app.models.recurring import RecurringRule
from app.models.transaction import (
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_INTEREST,
    TRANSACTION_TYPE_TRANSFER,
    Transaction,
)
from app.schemas.transaction import ConversionInput as ConversionInputSchema
from app.schemas.transaction import TransactionCreate, TransactionUpdate
from app.services import ownership
from app.services.conversion import ConversionInput, resolve_conversion
from app.services.currencies import get_active_currency


async def validate_transaction_shape(
    db: AsyncSession,
    user_id: UUID,
    *,
    type_: str,
    account_id: UUID,
    to_account_id: UUID | None,
    category_id: UUID | None,
    currency: str,
) -> tuple[Account, Account | None]:
    account = await ownership.get_owned(db, Account, account_id, user_id)

    if type_ == TRANSACTION_TYPE_TRANSFER:
        if currency != account.currency:
            raise ValidationAppError(
                code="transaction.currency_must_match_source_account",
                params={"expected": account.currency, "received": currency},
            )
        if to_account_id is None:
            raise ValidationAppError(code="transaction.transfer_requires_destination")
        if to_account_id == account_id:
            raise ValidationAppError(code="transaction.transfer_same_account")
        if category_id is not None:
            raise ValidationAppError(code="transaction.transfer_has_category")
        to_account = await ownership.get_owned(db, Account, to_account_id, user_id)
        return account, to_account

    if to_account_id is not None:
        raise ValidationAppError(code="transaction.destination_not_allowed")

    if type_ == TRANSACTION_TYPE_INTEREST:
        if category_id is not None:
            raise ValidationAppError(code="transaction.interest_has_category")
        return account, None

    # income / expense
    if category_id is None:
        raise ValidationAppError(code="transaction.category_required")
    category = await ownership.get_owned(db, Category, category_id, user_id)
    expected_kind = (
        TRANSACTION_TYPE_INCOME if type_ == TRANSACTION_TYPE_INCOME else TRANSACTION_TYPE_EXPENSE
    )
    if category.kind != expected_kind:
        raise ValidationAppError(code="transaction.category_kind_mismatch")
    return account, None


def to_conversion_input(payload: ConversionInputSchema | None) -> ConversionInput | None:
    if payload is None:
        return None
    return ConversionInput(
        amount=payload.amount,
        currency=payload.currency,
        fee=payload.fee,
        rate=payload.rate,
        source=payload.source,
    )


def _existing_conversion_input(transaction: Transaction) -> ConversionInput | None:
    if transaction.conversion_amount is None:
        return None
    assert transaction.conversion_currency is not None
    assert transaction.conversion_rate is not None
    assert transaction.conversion_source is not None
    return ConversionInput(
        amount=transaction.conversion_amount,
        currency=transaction.conversion_currency,
        fee=transaction.conversion_fee,
        rate=transaction.conversion_rate,
        source=transaction.conversion_source,
    )


def _apply_conversion(transaction: Transaction, conversion: ConversionValue | None) -> None:
    transaction.conversion_amount = conversion.amount if conversion else None
    transaction.conversion_currency = conversion.currency if conversion else None
    transaction.conversion_fee = conversion.fee if conversion else None
    transaction.conversion_rate = conversion.rate if conversion else None
    transaction.conversion_source = conversion.source if conversion else None


async def list_transactions(
    db: AsyncSession,
    user_id: UUID,
    *,
    account_id: UUID | None = None,
    category_id: UUID | None = None,
    institution_id: UUID | None = None,
    types: Sequence[str] | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    search: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[Transaction]:
    query = ownership.owned(Transaction, user_id)
    if account_id is not None:
        query = query.where(
            (Transaction.account_id == account_id) | (Transaction.to_account_id == account_id)
        )
    if institution_id is not None:
        institution_accounts = select(Account.id).where(
            Account.user_id == user_id, Account.institution_id == institution_id
        )
        query = query.where(
            or_(
                Transaction.account_id.in_(institution_accounts),
                Transaction.to_account_id.in_(institution_accounts),
            )
        )
    if category_id is not None:
        query = query.where(Transaction.category_id == category_id)
    if types is not None:
        query = query.where(Transaction.type.in_(types))
    if date_from is not None:
        query = query.where(Transaction.date >= date_from)
    if date_to is not None:
        query = query.where(Transaction.date <= date_to)
    if search:
        query = query.where(Transaction.description.ilike(f"%{search}%"))
    # id as a tiebreaker: date alone is non-deterministic for same-date rows,
    # which would let limit/offset skip or duplicate rows across pages.
    query = query.order_by(Transaction.date.desc(), Transaction.id.desc())
    if limit is not None:
        query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_transaction(db: AsyncSession, user_id: UUID, transaction_id: UUID) -> Transaction:
    return await ownership.get_owned(db, Transaction, transaction_id, user_id)


async def create_transaction(
    db: AsyncSession, user_id: UUID, data: TransactionCreate
) -> Transaction:
    await get_active_currency(db, data.currency)
    account, to_account = await validate_transaction_shape(
        db,
        user_id,
        type_=data.type,
        account_id=data.account_id,
        to_account_id=data.to_account_id,
        category_id=data.category_id,
        currency=data.currency,
    )
    await ownership.get_owned_or_none(db, RecurringRule, data.recurring_rule_id, user_id)

    destination_currency = to_account.currency if to_account is not None else account.currency
    conversion = await resolve_conversion(
        db,
        origin_amount=data.amount,
        origin_currency=data.currency,
        destination_currency=destination_currency,
        payload=to_conversion_input(data.conversion),
    )

    transaction = Transaction(
        user_id=user_id,
        type=data.type,
        date=data.date,
        amount=data.amount,
        currency=data.currency,
        account_id=data.account_id,
        to_account_id=data.to_account_id,
        category_id=data.category_id,
        description=data.description,
        notes=data.notes,
        recurring_rule_id=data.recurring_rule_id,
    )
    _apply_conversion(transaction, conversion)

    db.add(transaction)
    await db.commit()
    await db.refresh(transaction)
    return transaction


async def update_transaction(
    db: AsyncSession, user_id: UUID, transaction_id: UUID, data: TransactionUpdate
) -> Transaction:
    transaction = await ownership.get_owned(db, Transaction, transaction_id, user_id)
    changes = data.model_dump(exclude_unset=True, exclude={"conversion"})
    conversion_provided = "conversion" in data.model_fields_set

    if "currency" in changes:
        await get_active_currency(db, changes["currency"])
    if "recurring_rule_id" in changes:
        await ownership.get_owned_or_none(db, RecurringRule, changes["recurring_rule_id"], user_id)

    effective_type = changes.get("type", transaction.type)
    effective_account_id = changes.get("account_id", transaction.account_id)
    effective_to_account_id = changes.get("to_account_id", transaction.to_account_id)
    effective_category_id = changes.get("category_id", transaction.category_id)
    effective_currency = changes.get("currency", transaction.currency)
    effective_amount = changes.get("amount", transaction.amount)

    account, to_account = await validate_transaction_shape(
        db,
        user_id,
        type_=effective_type,
        account_id=effective_account_id,
        to_account_id=effective_to_account_id,
        category_id=effective_category_id,
        currency=effective_currency,
    )

    shape_changed = any(
        field in changes for field in ("type", "account_id", "to_account_id", "currency", "amount")
    )
    if conversion_provided or shape_changed:
        destination_currency = to_account.currency if to_account is not None else account.currency
        conversion_input = (
            to_conversion_input(data.conversion)
            if conversion_provided
            else _existing_conversion_input(transaction)
        )
        conversion = await resolve_conversion(
            db,
            origin_amount=effective_amount,
            origin_currency=effective_currency,
            destination_currency=destination_currency,
            payload=conversion_input,
        )
        _apply_conversion(transaction, conversion)

    for field, value in changes.items():
        setattr(transaction, field, value)

    await db.commit()
    await db.refresh(transaction)
    return transaction


async def delete_transaction(db: AsyncSession, user_id: UUID, transaction_id: UUID) -> None:
    transaction = await ownership.get_owned(db, Transaction, transaction_id, user_id)
    await db.delete(transaction)
    await db.commit()
