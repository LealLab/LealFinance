"""Transaction audit history and import-batch operations."""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.models.import_idempotency import ImportIdempotency
from app.models.transaction import Transaction
from app.models.transaction_history import (
    HISTORY_OPERATION_CREATE,
    HISTORY_OPERATION_DELETE,
    HISTORY_OPERATION_UPDATE,
    HISTORY_SOURCE_BULK,
    HISTORY_SOURCE_CARD,
    HISTORY_SOURCE_IMPORT,
    HISTORY_SOURCE_IMPORT_UNDO,
    HISTORY_SOURCE_INVESTMENT,
    HISTORY_SOURCE_LOAN,
    HISTORY_SOURCE_MANUAL,
    HISTORY_SOURCE_RECURRING,
    TransactionHistory,
)
from app.services import ownership

_SNAPSHOT_FIELDS = (
    "type",
    "date",
    "amount",
    "currency",
    "account_id",
    "to_account_id",
    "category_id",
    "description",
    "notes",
    "recurring_rule_id",
    "loan_id",
    "card_invoice_close_date",
    "installment_group_id",
    "installment_number",
    "installment_count",
    "conversion_amount",
    "conversion_currency",
    "conversion_fee",
    "conversion_rate",
    "conversion_source",
)


@dataclass(frozen=True, slots=True)
class ImportBatchSummary:
    id: UUID
    created_at: datetime
    created_count: int
    remaining_count: int


def snapshot(transaction: Transaction) -> dict[str, Any]:
    """Return the JSON-safe financial state of a transaction."""
    result: dict[str, Any] = {}
    for field in _SNAPSHOT_FIELDS:
        value = getattr(transaction, field)
        if isinstance(value, (Decimal, UUID)):
            result[field] = str(value)
        elif isinstance(value, (date, datetime)):
            result[field] = value.isoformat()
        else:
            result[field] = value
    return result


def record(
    db: AsyncSession,
    user_id: UUID,
    transaction: Transaction,
    *,
    operation: str,
    source: str,
    batch_id: UUID | None = None,
    before: dict[str, Any] | None = None,
) -> None:
    """Stage one history row in the caller's transaction."""
    if transaction.id is None:
        transaction.id = uuid4()
    db.add(
        TransactionHistory(
            user_id=user_id,
            transaction_id=transaction.id,
            operation=operation,
            source=source,
            batch_id=batch_id,
            created_at=datetime.now(UTC),
            before=before,
            after=(
                snapshot(transaction)
                if operation in (HISTORY_OPERATION_CREATE, HISTORY_OPERATION_UPDATE)
                else None
            ),
        )
    )


async def list_for_transaction(
    db: AsyncSession, user_id: UUID, transaction_id: UUID
) -> list[TransactionHistory]:
    await ownership.get_owned(db, Transaction, transaction_id, user_id)
    result = await db.execute(
        select(TransactionHistory)
        .where(
            TransactionHistory.user_id == user_id,
            TransactionHistory.transaction_id == transaction_id,
        )
        .order_by(TransactionHistory.created_at.asc(), TransactionHistory.id.asc())
    )
    return list(result.scalars().all())


async def list_batches(db: AsyncSession, user_id: UUID) -> list[ImportBatchSummary]:
    created_ids = (
        select(TransactionHistory.transaction_id)
        .where(
            TransactionHistory.user_id == user_id,
            TransactionHistory.batch_id == ImportIdempotency.id,
            TransactionHistory.operation == HISTORY_OPERATION_CREATE,
        )
        .correlate(ImportIdempotency)
    )
    remaining_count = (
        select(func.count(Transaction.id))
        .where(Transaction.user_id == user_id, Transaction.id.in_(created_ids))
        .correlate(ImportIdempotency)
        .scalar_subquery()
    )
    result = await db.execute(
        select(
            ImportIdempotency.id,
            ImportIdempotency.created_at,
            ImportIdempotency.created_count,
            remaining_count.label("remaining_count"),
        )
        .where(ImportIdempotency.user_id == user_id)
        .order_by(ImportIdempotency.created_at.desc(), ImportIdempotency.id.desc())
    )
    return [
        ImportBatchSummary(
            id=row.id,
            created_at=row.created_at,
            created_count=row.created_count,
            remaining_count=row.remaining_count or 0,
        )
        for row in result
    ]


async def batch_transactions(db: AsyncSession, user_id: UUID, batch_id: UUID) -> list[Transaction]:
    await ownership.get_owned(db, ImportIdempotency, batch_id, user_id)
    result = await db.execute(
        select(Transaction)
        .join(
            TransactionHistory,
            and_(
                TransactionHistory.transaction_id == Transaction.id,
                TransactionHistory.user_id == user_id,
                TransactionHistory.batch_id == batch_id,
                TransactionHistory.operation == HISTORY_OPERATION_CREATE,
            ),
        )
        .where(Transaction.user_id == user_id)
        .order_by(Transaction.id.asc())
    )
    return list(result.scalars().unique().all())


async def undo_batch(db: AsyncSession, user_id: UUID, batch_id: UUID) -> int:
    await ownership.get_owned(db, ImportIdempotency, batch_id, user_id)
    result = await db.execute(
        select(TransactionHistory)
        .where(
            TransactionHistory.user_id == user_id,
            TransactionHistory.batch_id == batch_id,
            TransactionHistory.operation == HISTORY_OPERATION_CREATE,
        )
        .order_by(TransactionHistory.created_at.asc(), TransactionHistory.id.asc())
    )
    creates = list(result.scalars().all())
    if not creates:
        await db.commit()
        return 0

    transaction_result = await db.execute(
        ownership.owned(Transaction, user_id).where(
            Transaction.id.in_({history.transaction_id for history in creates})
        )
    )
    transactions = {
        transaction.id: transaction for transaction in transaction_result.scalars().all()
    }
    remaining: list[tuple[Transaction, dict[str, Any]]] = []
    for history in creates:
        transaction = transactions.get(history.transaction_id)
        if transaction is None:
            continue
        if transaction.loan_id is not None or transaction.card_invoice_close_date is not None:
            raise ConflictError(code="import.batch_modified")
        later_update = await db.scalar(
            select(TransactionHistory.id)
            .where(
                TransactionHistory.user_id == user_id,
                TransactionHistory.transaction_id == transaction.id,
                TransactionHistory.operation == HISTORY_OPERATION_UPDATE,
            )
            .limit(1)
        )
        if later_update is not None:
            raise ConflictError(code="import.batch_modified")
        remaining.append((transaction, snapshot(transaction)))

    if not remaining:
        await db.commit()
        return 0
    ids = [transaction.id for transaction, _ in remaining]
    await db.execute(delete(Transaction).where(Transaction.id.in_(ids)))
    for transaction, before in remaining:
        record(
            db,
            user_id,
            transaction,
            operation=HISTORY_OPERATION_DELETE,
            source=HISTORY_SOURCE_IMPORT_UNDO,
            batch_id=batch_id,
            before=before,
        )
    await db.commit()
    return len(remaining)


__all__ = [
    "HISTORY_OPERATION_CREATE",
    "HISTORY_OPERATION_DELETE",
    "HISTORY_OPERATION_UPDATE",
    "HISTORY_SOURCE_BULK",
    "HISTORY_SOURCE_CARD",
    "HISTORY_SOURCE_IMPORT",
    "HISTORY_SOURCE_IMPORT_UNDO",
    "HISTORY_SOURCE_INVESTMENT",
    "HISTORY_SOURCE_LOAN",
    "HISTORY_SOURCE_MANUAL",
    "HISTORY_SOURCE_RECURRING",
    "ImportBatchSummary",
    "batch_transactions",
    "list_batches",
    "list_for_transaction",
    "record",
    "snapshot",
    "undo_batch",
]
