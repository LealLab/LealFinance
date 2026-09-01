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
from dataclasses import dataclass
from datetime import date as date_type
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import Select, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models._conversion import CONVERSION_SOURCE_FALLBACK, ConversionValue
from app.models.account import Account
from app.models.category import Category
from app.models.category_group import CategoryGroup
from app.models.loan import Loan
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
from app.services.exchange_rates import get_exchange_rate, to_conversion_source


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


TransactionSort = Literal["date", "description", "amount"]
SortOrder = Literal["asc", "desc"]

_SORT_COLUMNS = {
    "date": Transaction.date,
    "description": Transaction.description,
    "amount": Transaction.amount,
}


@dataclass(frozen=True, slots=True)
class TransactionPage:
    """A slice of the ledger plus the unpaginated match count. `total` equals
    `len(rows)` for an unpaginated call (limit=None) - the count query only
    runs when a limit is supplied."""

    rows: list[Transaction]
    total: int


def _filtered_transactions(
    user_id: UUID,
    *,
    account_id: UUID | None,
    category_id: UUID | None,
    group_id: UUID | None,
    institution_id: UUID | None,
    types: Sequence[str] | None,
    date_from: date_type | None,
    date_to: date_type | None,
    search: str | None,
    amount_min: Decimal | None,
    amount_max: Decimal | None,
) -> Select[tuple[Transaction]]:
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
    if group_id is not None:
        # Resolve the group to its owned categories rather than joining - keeps
        # the ownership scope visible in one expression.
        group_categories = (
            ownership.owned(Category, user_id)
            .with_only_columns(Category.id)
            .where(Category.group_id == group_id)
        )
        query = query.where(Transaction.category_id.in_(group_categories))
    if types is not None:
        query = query.where(Transaction.type.in_(types))
    if date_from is not None:
        query = query.where(Transaction.date >= date_from)
    if date_to is not None:
        query = query.where(Transaction.date <= date_to)
    if search:
        query = query.where(Transaction.description.ilike(f"%{search}%"))
    # Raw NUMERIC comparison, currency-agnostic - see docs/backend-api.md.
    if amount_min is not None:
        query = query.where(Transaction.amount >= amount_min)
    if amount_max is not None:
        query = query.where(Transaction.amount <= amount_max)
    return query


async def list_transactions(
    db: AsyncSession,
    user_id: UUID,
    *,
    account_id: UUID | None = None,
    category_id: UUID | None = None,
    group_id: UUID | None = None,
    institution_id: UUID | None = None,
    types: Sequence[str] | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    search: str | None = None,
    amount_min: Decimal | None = None,
    amount_max: Decimal | None = None,
    sort: TransactionSort = "date",
    order: SortOrder = "desc",
    limit: int | None = None,
    offset: int = 0,
) -> TransactionPage:
    if group_id is not None:
        # A foreign/unknown group id 404s rather than silently returning zero rows.
        await ownership.get_owned(db, CategoryGroup, group_id, user_id)

    query = _filtered_transactions(
        user_id,
        account_id=account_id,
        category_id=category_id,
        group_id=group_id,
        institution_id=institution_id,
        types=types,
        date_from=date_from,
        date_to=date_to,
        search=search,
        amount_min=amount_min,
        amount_max=amount_max,
    )

    # id as a tiebreaker: date/description/amount are all non-unique, which
    # would let limit/offset skip or duplicate rows across pages.
    # ponytail: no index on description/amount - ORDER BY ... OFFSET n is a
    # seq scan + sort. Fine at personal-finance scale; add a composite index
    # if a user's ledger ever makes deep pages slow.
    sort_column = _SORT_COLUMNS[sort]
    direction = sort_column.asc() if order == "asc" else sort_column.desc()
    query = query.order_by(direction, Transaction.id.desc())

    if limit is None:
        rows = list((await db.execute(query)).scalars().all())
        return TransactionPage(rows=rows, total=len(rows))

    total = await db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    rows = list((await db.execute(query.limit(limit).offset(offset))).scalars().all())
    return TransactionPage(rows=rows, total=total or 0)


async def get_transaction(db: AsyncSession, user_id: UUID, transaction_id: UUID) -> Transaction:
    return await ownership.get_owned(db, Transaction, transaction_id, user_id)


async def build_transaction(
    db: AsyncSession, user_id: UUID, data: TransactionCreate
) -> Transaction:
    """Validates and constructs a Transaction, adding it to the session -
    but does not commit. Shared by create_transaction (one row, commits
    immediately) and import_transactions (many rows, one commit)."""
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
    await ownership.get_owned_or_none(db, Loan, data.loan_id, user_id)

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
        loan_id=data.loan_id,
    )
    _apply_conversion(transaction, conversion)
    db.add(transaction)
    return transaction


async def create_transaction(
    db: AsyncSession, user_id: UUID, data: TransactionCreate
) -> Transaction:
    transaction = await build_transaction(db, user_id, data)
    await db.commit()
    await db.refresh(transaction)
    return transaction


async def import_transactions(
    db: AsyncSession, user_id: UUID, items: list[TransactionCreate]
) -> int:
    """Bulk create for CSV import (app/services/csv_import.py handles
    parsing/preview - this only writes). One commit for the whole batch: if
    any item fails validation, the explicit rollback discards every row
    already staged by build_transaction() in this call, so nothing is
    persisted - the frontend already showed the user a preview, so a
    partial import here would be worse than a retry."""
    try:
        for item in items:
            await build_transaction(db, user_id, item)
    except Exception:
        await db.rollback()
        raise
    await db.commit()
    return len(items)


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
    if "loan_id" in changes:
        await ownership.get_owned_or_none(db, Loan, changes["loan_id"], user_id)

    effective_type = changes.get("type", transaction.type)
    effective_account_id = changes.get("account_id", transaction.account_id)
    effective_to_account_id = changes.get("to_account_id", transaction.to_account_id)
    effective_category_id = changes.get("category_id", transaction.category_id)
    effective_currency = changes.get("currency", transaction.currency)
    effective_amount = changes.get("amount", transaction.amount)
    effective_date = changes.get("date", transaction.date)

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
        field in changes
        for field in ("type", "account_id", "to_account_id", "currency", "amount", "date")
    )
    if conversion_provided or shape_changed:
        destination_currency = to_account.currency if to_account is not None else account.currency
        if conversion_provided:
            conversion_input = to_conversion_input(data.conversion)
        elif (
            transaction.conversion_source == CONVERSION_SOURCE_FALLBACK
            and effective_currency != destination_currency
        ):
            # The stored conversion is a "we had no rate" placeholder, not a
            # recorded decision - re-resolve it as-of the transaction's date
            # rather than replaying rate=1.
            rate_result = await get_exchange_rate(
                db,
                effective_currency,
                destination_currency,
                user_id=user_id,
                as_of=effective_date,
            )
            conversion_input = ConversionInput(
                amount=None,
                currency=destination_currency,
                fee=transaction.conversion_fee,
                rate=rate_result.rate,
                source=to_conversion_source(rate_result),
            )
        elif effective_currency == destination_currency:
            # Origin and destination now match (e.g. moved to a same-currency
            # account) - any stored conversion is meaningless, so drop it
            # rather than replaying it into `conversion_not_needed`.
            conversion_input = None
        else:
            conversion_input = _existing_conversion_input(transaction)
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


async def bulk_delete_transactions(db: AsyncSession, user_id: UUID, ids: Sequence[UUID]) -> None:
    """All-or-nothing, same contract as import_transactions: one foreign or
    unknown id 404s (via get_many_owned) and nothing is deleted."""
    owned = await ownership.get_many_owned(db, Transaction, ids, user_id)
    await db.execute(delete(Transaction).where(Transaction.id.in_(owned.keys())))
    await db.commit()


async def bulk_categorize_transactions(
    db: AsyncSession, user_id: UUID, ids: Sequence[UUID], category_id: UUID
) -> int:
    """Assign one category to every listed transaction. All-or-nothing: a
    foreign id, a transfer/interest row, or a category-kind mismatch rejects
    the whole batch before any commit."""
    category = await ownership.get_owned(db, Category, category_id, user_id)
    transactions = await ownership.get_many_owned(db, Transaction, ids, user_id)
    for transaction in transactions.values():
        # The DB CHECK ck_transactions_category_absent_for_transfer_interest
        # would abort the whole transaction as an IntegrityError 500 - reject
        # explicitly so the client gets a coded 400 instead.
        if transaction.type == TRANSACTION_TYPE_TRANSFER:
            raise ValidationAppError(code="transaction.transfer_has_category")
        if transaction.type == TRANSACTION_TYPE_INTEREST:
            raise ValidationAppError(code="transaction.interest_has_category")
        expected_kind = (
            TRANSACTION_TYPE_INCOME
            if transaction.type == TRANSACTION_TYPE_INCOME
            else TRANSACTION_TYPE_EXPENSE
        )
        if category.kind != expected_kind:
            raise ValidationAppError(code="transaction.category_kind_mismatch")
        transaction.category_id = category_id
    await db.commit()
    return len(transactions)
