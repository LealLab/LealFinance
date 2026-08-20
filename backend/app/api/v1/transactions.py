"""Transaction CRUD with optional account/category/type/date-range
filters on the list endpoint."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models.transaction import Transaction
from app.schemas.transaction import (
    TransactionCreate,
    TransactionRead,
    TransactionType,
    TransactionUpdate,
)
from app.schemas.transaction_import import (
    ImportCommitRead,
    ImportCommitRequest,
    ImportPreviewRead,
    ImportPreviewRequest,
)
from app.services import csv_import as csv_import_service
from app.services import transactions as transactions_service
from app.services.csv_import import ImportPreview

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("", response_model=list[TransactionRead])
async def list_transactions(
    user: CurrentUser,
    db: DbSession,
    account_id: UUID | None = None,
    category_id: UUID | None = None,
    institution_id: UUID | None = None,
    transaction_type: Annotated[list[TransactionType] | None, Query(alias="type")] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[Transaction]:
    return await transactions_service.list_transactions(
        db,
        user.id,
        account_id=account_id,
        category_id=category_id,
        institution_id=institution_id,
        types=transaction_type,
        date_from=date_from,
        date_to=date_to,
        search=search,
        limit=limit,
        offset=offset,
    )


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
    created = await transactions_service.import_transactions(db, user.id, payload.items)
    return ImportCommitRead(created=created)


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
