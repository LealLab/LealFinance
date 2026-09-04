"""Loan CRUD plus payment recording. Thin router - all logic and
ownership scoping live in app/services/loans.py. Archive only, no delete:
a loan with recorded payments must keep its provenance."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.loan import Loan
from app.models.transaction import Transaction
from app.schemas.common import ArchiveRequest
from app.schemas.loan import LoanAdvanceCreate, LoanCreate, LoanPaymentCreate, LoanRead, LoanUpdate
from app.schemas.transaction import TransactionRead
from app.services import loans as loans_service

router = APIRouter(prefix="/loans", tags=["loans"])


@router.get("", response_model=list[LoanRead])
async def list_loans(user: CurrentUser, db: DbSession) -> list[Loan]:
    return await loans_service.list_loans(db, user.id)


@router.post("", response_model=LoanRead, status_code=status.HTTP_201_CREATED)
async def create_loan(payload: LoanCreate, user: CurrentUser, db: DbSession) -> Loan:
    return await loans_service.create_loan(db, user.id, payload)


@router.patch("/{loan_id}", response_model=LoanRead)
async def update_loan(loan_id: UUID, payload: LoanUpdate, user: CurrentUser, db: DbSession) -> Loan:
    return await loans_service.update_loan(db, user.id, loan_id, payload)


@router.post("/{loan_id}/archive", response_model=LoanRead)
async def archive_loan(
    loan_id: UUID, payload: ArchiveRequest, user: CurrentUser, db: DbSession
) -> Loan:
    return await loans_service.set_loan_archived(db, user.id, loan_id, payload.archived)


@router.post(
    "/{loan_id}/payments", response_model=TransactionRead, status_code=status.HTTP_201_CREATED
)
async def record_payment(
    loan_id: UUID, payload: LoanPaymentCreate, user: CurrentUser, db: DbSession
) -> object:
    return await loans_service.record_payment(db, user.id, loan_id, payload, today=date.today())


@router.post(
    "/{loan_id}/advance-payments",
    response_model=list[TransactionRead],
    status_code=status.HTTP_201_CREATED,
)
async def advance_payments(
    loan_id: UUID, payload: LoanAdvanceCreate, user: CurrentUser, db: DbSession
) -> list[Transaction]:
    return await loans_service.advance_payments(db, user.id, loan_id, payload, today=date.today())
