"""Bank reconciliation endpoints."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.reconciliation import Reconciliation
from app.schemas.reconciliation import (
    ReconciliationCreate,
    ReconciliationDetailRead,
    ReconciliationEntriesRequest,
    ReconciliationRead,
)
from app.services import reconciliations as reconciliations_service
from app.services.reconciliations import ReconciliationDetail

router = APIRouter(prefix="/reconciliations", tags=["reconciliations"])


@router.get("", response_model=list[ReconciliationRead])
async def list_reconciliations(
    user: CurrentUser, db: DbSession, account_id: UUID | None = None
) -> list[Reconciliation]:
    return await reconciliations_service.list_(db, user.id, account_id=account_id)


@router.post("", response_model=ReconciliationRead, status_code=status.HTTP_201_CREATED)
async def create_reconciliation(
    payload: ReconciliationCreate, user: CurrentUser, db: DbSession
) -> Reconciliation:
    return await reconciliations_service.create(db, user.id, payload)


@router.post("/{reconciliation_id}/entries", response_model=ReconciliationDetailRead)
async def set_reconciliation_entries(
    reconciliation_id: UUID,
    payload: ReconciliationEntriesRequest,
    user: CurrentUser,
    db: DbSession,
) -> ReconciliationDetail:
    return await reconciliations_service.set_entries(
        db,
        user.id,
        reconciliation_id,
        transaction_ids=payload.transaction_ids,
        cleared=payload.cleared,
    )


@router.post("/{reconciliation_id}/complete", response_model=ReconciliationRead)
async def complete_reconciliation(
    reconciliation_id: UUID, user: CurrentUser, db: DbSession
) -> Reconciliation:
    return await reconciliations_service.complete(db, user.id, reconciliation_id)


@router.post("/{reconciliation_id}/reopen", response_model=ReconciliationRead)
async def reopen_reconciliation(
    reconciliation_id: UUID, user: CurrentUser, db: DbSession
) -> Reconciliation:
    return await reconciliations_service.reopen(db, user.id, reconciliation_id)


@router.get("/{reconciliation_id}", response_model=ReconciliationDetailRead)
async def get_reconciliation(
    reconciliation_id: UUID, user: CurrentUser, db: DbSession
) -> ReconciliationDetail:
    return await reconciliations_service.detail(db, user.id, reconciliation_id)


@router.delete("/{reconciliation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reconciliation(reconciliation_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await reconciliations_service.delete(db, user.id, reconciliation_id)
