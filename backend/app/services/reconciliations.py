"""Bank reconciliation calculations and cleared-leg ownership."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, ValidationAppError
from app.models.account import Account
from app.models.reconciliation import (
    RECONCILIATION_STATUS_COMPLETED,
    RECONCILIATION_STATUS_OPEN,
    Reconciliation,
    ReconciliationEntry,
)
from app.models.transaction import Transaction
from app.schemas.reconciliation import ReconciliationCreate
from app.services import accounts as accounts_service
from app.services import ownership


@dataclass(frozen=True)
class ReconciliationEntryDetail:
    transaction_id: UUID
    leg: str
    date: date
    description: str
    amount: Decimal
    cleared: bool
    cleared_by: UUID | None


@dataclass(frozen=True)
class ReconciliationDetail:
    reconciliation: Reconciliation
    statement_balance: Decimal
    book_balance: Decimal
    cleared_balance: Decimal
    difference: Decimal
    entries: list[ReconciliationEntryDetail]


async def assert_not_reconciled(
    db: AsyncSession, user_id: UUID, transaction_ids: Iterable[UUID]
) -> None:
    ids = set(transaction_ids)
    if not ids:
        return
    found = await db.scalar(
        select(ReconciliationEntry.id)
        .where(
            ReconciliationEntry.user_id == user_id,
            ReconciliationEntry.transaction_id.in_(ids),
        )
        .limit(1)
    )
    if found is not None:
        raise ConflictError(code="transaction.reconciled")


async def create(db: AsyncSession, user_id: UUID, data: ReconciliationCreate) -> Reconciliation:
    account = await ownership.get_owned(db, Account, data.account_id, user_id)
    if account.archived:
        raise ValidationAppError(code="reconciliation.account_archived")
    existing = await db.scalar(
        ownership.owned(Reconciliation, user_id).where(
            Reconciliation.account_id == account.id,
            Reconciliation.status == RECONCILIATION_STATUS_OPEN,
        )
    )
    if existing is not None:
        raise ConflictError(code="reconciliation.already_open")
    reconciliation = Reconciliation(
        user_id=user_id,
        account_id=account.id,
        statement_date=data.statement_date,
        statement_balance=data.statement_balance,
        currency=account.currency,
        status=RECONCILIATION_STATUS_OPEN,
    )
    db.add(reconciliation)
    await db.commit()
    await db.refresh(reconciliation)
    return reconciliation


async def _cleared_balance(
    db: AsyncSession, user_id: UUID, reconciliation: Reconciliation
) -> Decimal:
    legs = accounts_service._account_leg_deltas(
        user_id, as_of=reconciliation.statement_date
    ).subquery()
    total = await db.scalar(
        select(func.coalesce(func.sum(legs.c.delta), 0))
        .select_from(legs)
        .join(
            ReconciliationEntry,
            and_(
                ReconciliationEntry.user_id == user_id,
                ReconciliationEntry.transaction_id == legs.c.transaction_id,
                ReconciliationEntry.account_id == legs.c.account_id,
            ),
        )
        .where(legs.c.account_id == reconciliation.account_id)
    )
    return Decimal(total or 0)


async def detail(db: AsyncSession, user_id: UUID, reconciliation_id: UUID) -> ReconciliationDetail:
    reconciliation = await ownership.get_owned(db, Reconciliation, reconciliation_id, user_id)
    account = await ownership.get_owned(db, Account, reconciliation.account_id, user_id)
    balances = await accounts_service.account_balances(
        db, user_id, as_of=reconciliation.statement_date
    )
    book_balance = next(
        balance.balance for balance in balances if balance.account_id == reconciliation.account_id
    )
    cleared_balance = account.opening_balance + await _cleared_balance(db, user_id, reconciliation)
    legs = accounts_service._account_leg_deltas(
        user_id, as_of=reconciliation.statement_date
    ).subquery()
    rows = await db.execute(
        select(
            legs.c.transaction_id,
            legs.c.leg,
            Transaction.date,
            Transaction.description,
            legs.c.delta,
            ReconciliationEntry.reconciliation_id.label("cleared_by"),
        )
        .select_from(legs)
        .join(Transaction, Transaction.id == legs.c.transaction_id)
        .outerjoin(
            ReconciliationEntry,
            and_(
                ReconciliationEntry.user_id == user_id,
                ReconciliationEntry.transaction_id == legs.c.transaction_id,
                ReconciliationEntry.account_id == legs.c.account_id,
            ),
        )
        .where(legs.c.account_id == reconciliation.account_id)
        .order_by(Transaction.date, Transaction.id)
    )
    entries = [
        ReconciliationEntryDetail(
            transaction_id=row.transaction_id,
            leg=row.leg,
            date=row.date,
            description=row.description,
            amount=Decimal(row.delta or 0),
            cleared=row.cleared_by is not None,
            cleared_by=row.cleared_by,
        )
        for row in rows
    ]
    return ReconciliationDetail(
        reconciliation=reconciliation,
        statement_balance=reconciliation.statement_balance,
        book_balance=book_balance,
        cleared_balance=cleared_balance,
        difference=reconciliation.statement_balance - cleared_balance,
        entries=entries,
    )


async def set_entries(
    db: AsyncSession,
    user_id: UUID,
    reconciliation_id: UUID,
    *,
    transaction_ids: list[UUID],
    cleared: bool,
) -> ReconciliationDetail:
    reconciliation = await ownership.get_owned(db, Reconciliation, reconciliation_id, user_id)
    if reconciliation.status != RECONCILIATION_STATUS_OPEN:
        raise ConflictError(code="reconciliation.completed")
    ids = list(dict.fromkeys(transaction_ids))
    rows = await db.execute(ownership.owned(Transaction, user_id).where(Transaction.id.in_(ids)))
    transactions = {transaction.id: transaction for transaction in rows.scalars().all()}
    if len(transactions) != len(ids) or any(
        transaction.account_id != reconciliation.account_id
        and transaction.to_account_id != reconciliation.account_id
        or transaction.date > reconciliation.statement_date
        for transaction in transactions.values()
    ):
        raise ValidationAppError(code="reconciliation.transaction_not_eligible")

    existing_rows = await db.execute(
        select(ReconciliationEntry).where(
            ReconciliationEntry.user_id == user_id,
            ReconciliationEntry.transaction_id.in_(ids),
            ReconciliationEntry.account_id == reconciliation.account_id,
        )
    )
    existing = {entry.transaction_id: entry for entry in existing_rows.scalars().all()}
    for transaction_id in ids:
        entry = existing.get(transaction_id)
        if entry is not None and entry.reconciliation_id != reconciliation.id and not cleared:
            raise ConflictError(code="reconciliation.leg_locked")
        if cleared and entry is None:
            db.add(
                ReconciliationEntry(
                    user_id=user_id,
                    reconciliation_id=reconciliation.id,
                    transaction_id=transaction_id,
                    account_id=reconciliation.account_id,
                )
            )
        elif not cleared and entry is not None:
            await db.delete(entry)
    await db.commit()
    return await detail(db, user_id, reconciliation.id)


async def complete(db: AsyncSession, user_id: UUID, reconciliation_id: UUID) -> Reconciliation:
    reconciliation = await ownership.get_owned(db, Reconciliation, reconciliation_id, user_id)
    if reconciliation.status != RECONCILIATION_STATUS_OPEN:
        raise ConflictError(code="reconciliation.completed")
    current = await detail(db, user_id, reconciliation.id)
    if current.difference != Decimal(0):
        raise ValidationAppError(code="reconciliation.difference_not_zero")
    reconciliation.status = RECONCILIATION_STATUS_COMPLETED
    reconciliation.completed_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(reconciliation)
    return reconciliation


async def reopen(db: AsyncSession, user_id: UUID, reconciliation_id: UUID) -> Reconciliation:
    reconciliation = await ownership.get_owned(db, Reconciliation, reconciliation_id, user_id)
    existing = await db.scalar(
        ownership.owned(Reconciliation, user_id).where(
            Reconciliation.account_id == reconciliation.account_id,
            Reconciliation.status == RECONCILIATION_STATUS_OPEN,
            Reconciliation.id != reconciliation.id,
        )
    )
    if existing is not None:
        raise ConflictError(code="reconciliation.already_open")
    reconciliation.status = RECONCILIATION_STATUS_OPEN
    reconciliation.completed_at = None
    await db.commit()
    await db.refresh(reconciliation)
    return reconciliation


async def delete(db: AsyncSession, user_id: UUID, reconciliation_id: UUID) -> None:
    reconciliation = await ownership.get_owned(db, Reconciliation, reconciliation_id, user_id)
    await db.delete(reconciliation)
    await db.commit()


async def list_(
    db: AsyncSession, user_id: UUID, *, account_id: UUID | None = None
) -> list[Reconciliation]:
    query: Select[tuple[Reconciliation]] = ownership.owned(Reconciliation, user_id)
    if account_id is not None:
        query = query.where(Reconciliation.account_id == account_id)
    query = query.order_by(Reconciliation.statement_date.desc())
    return list((await db.execute(query)).scalars().all())
