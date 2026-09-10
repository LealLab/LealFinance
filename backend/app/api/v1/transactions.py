"""Transaction CRUD with optional account/category/type/date-range
filters on the list endpoint."""

from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUser, DbSession
from app.models.transaction import Transaction
from app.models.transaction_history import TransactionHistory
from app.schemas.transaction import (
    BulkResultRead,
    TransactionBulkCategorize,
    TransactionBulkDelete,
    TransactionCreate,
    TransactionRead,
    TransactionType,
    TransactionUpdate,
)
from app.schemas.transaction_history import ImportBatchRead, TransactionHistoryRead
from app.schemas.transaction_import import (
    ImportCommitRead,
    ImportCommitRequest,
    ImportPreviewRead,
    ImportPreviewRequest,
)
from app.services import csv_import as csv_import_service
from app.services import transaction_history as transaction_history_service
from app.services import transactions as transactions_service
from app.services.csv_import import ImportPreview
from app.services.transaction_history import ImportBatchSummary
from app.services.transactions import SortOrder, TransactionSort

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("", response_model=list[TransactionRead])
async def list_transactions(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    account_id: UUID | None = None,
    category_id: UUID | None = None,
    group_id: UUID | None = None,
    institution_id: UUID | None = None,
    installment_group_id: UUID | None = None,
    transaction_type: Annotated[list[TransactionType] | None, Query(alias="type")] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    amount_min: Annotated[Decimal | None, Query(ge=0)] = None,
    amount_max: Annotated[Decimal | None, Query(ge=0)] = None,
    sort: TransactionSort = "date",
    order: SortOrder = "desc",
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Transaction]:
    page = await transactions_service.list_transactions(
        db,
        user.id,
        account_id=account_id,
        category_id=category_id,
        group_id=group_id,
        institution_id=institution_id,
        installment_group_id=installment_group_id,
        types=transaction_type,
        date_from=date_from,
        date_to=date_to,
        search=search,
        amount_min=amount_min,
        amount_max=amount_max,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )
    # Exposed via CORS in app/main.py for paginated clients.
    response.headers["X-Total-Count"] = str(page.total)
    return page.rows


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    payload: TransactionCreate, user: CurrentUser, db: DbSession
) -> Transaction:
    return await transactions_service.create_transaction(db, user.id, payload)


@router.post("/import/preview", response_model=ImportPreviewRead)
async def preview_import(
    payload: ImportPreviewRequest, user: CurrentUser, db: DbSession
) -> ImportPreview:
    return await csv_import_service.preview_import(
        db,
        user.id,
        content=payload.content,
        account_id=payload.account_id,
        mapping=payload.mapping,
        options=payload.options,
    )


@router.post("/import", response_model=ImportCommitRead, status_code=status.HTTP_201_CREATED)
async def commit_import(
    payload: ImportCommitRequest, user: CurrentUser, db: DbSession
) -> ImportCommitRead:
    created = await transactions_service.import_transactions(
        db, user.id, payload.items, idempotency_key=payload.idempotency_key
    )
    return ImportCommitRead(created=created)


@router.get("/import/batches", response_model=list[ImportBatchRead])
async def list_import_batches(user: CurrentUser, db: DbSession) -> list[ImportBatchSummary]:
    return await transaction_history_service.list_batches(db, user.id)


@router.get("/import/batches/{batch_id}", response_model=list[TransactionRead])
async def list_import_batch_transactions(
    batch_id: UUID, user: CurrentUser, db: DbSession
) -> list[Transaction]:
    return await transaction_history_service.batch_transactions(db, user.id, batch_id)


@router.delete("/import/batches/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def undo_import_batch(batch_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await transaction_history_service.undo_batch(db, user.id, batch_id)


@router.post("/bulk-delete", status_code=status.HTTP_204_NO_CONTENT)
async def bulk_delete_transactions(
    payload: TransactionBulkDelete, user: CurrentUser, db: DbSession
) -> None:
    await transactions_service.bulk_delete_transactions(db, user.id, payload.ids)


@router.post("/bulk-categorize", response_model=BulkResultRead)
async def bulk_categorize_transactions(
    payload: TransactionBulkCategorize, user: CurrentUser, db: DbSession
) -> BulkResultRead:
    updated = await transactions_service.bulk_categorize_transactions(
        db, user.id, payload.ids, payload.category_id
    )
    return BulkResultRead(updated=updated)


@router.get("/{transaction_id}/history", response_model=list[TransactionHistoryRead])
async def transaction_history(
    transaction_id: UUID, user: CurrentUser, db: DbSession
) -> list[TransactionHistory]:
    return await transaction_history_service.list_for_transaction(db, user.id, transaction_id)


@router.get("/{transaction_id}", response_model=TransactionRead)
async def get_transaction(transaction_id: UUID, user: CurrentUser, db: DbSession) -> Transaction:
    return await transactions_service.get_transaction(db, user.id, transaction_id)


@router.patch("/{transaction_id}", response_model=TransactionRead)
async def update_transaction(
    transaction_id: UUID, payload: TransactionUpdate, user: CurrentUser, db: DbSession
) -> Transaction:
    return await transactions_service.update_transaction(db, user.id, transaction_id, payload)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(transaction_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await transactions_service.delete_transaction(db, user.id, transaction_id)
