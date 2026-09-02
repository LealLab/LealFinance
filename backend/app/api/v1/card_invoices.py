"""Credit-card invoices (faturas) for one account. Thin router - all cycle
math and ownership scoping live in app/services/card_invoices.py."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models.transaction import Transaction
from app.schemas.card_invoice import CardInvoicePaymentCreate, CardInvoiceRead
from app.schemas.transaction import TransactionRead
from app.services import card_invoices as card_invoices_service

router = APIRouter(prefix="/accounts", tags=["card-invoices"])


@router.get("/{account_id}/invoices", response_model=list[CardInvoiceRead])
async def list_card_invoices(
    account_id: UUID,
    user: CurrentUser,
    db: DbSession,
    months_back: Annotated[int, Query(ge=0, le=36)] = card_invoices_service.DEFAULT_MONTHS_BACK,
    months_ahead: Annotated[int, Query(ge=0, le=36)] = card_invoices_service.DEFAULT_MONTHS_AHEAD,
) -> list[card_invoices_service.CardInvoice]:
    return await card_invoices_service.list_invoices(
        db,
        user.id,
        account_id,
        today=date.today(),
        months_back=months_back,
        months_ahead=months_ahead,
    )


@router.post(
    "/{account_id}/invoices/{close_date}/pay",
    response_model=TransactionRead,
    status_code=status.HTTP_201_CREATED,
)
async def pay_card_invoice(
    account_id: UUID,
    close_date: date,
    payload: CardInvoicePaymentCreate,
    user: CurrentUser,
    db: DbSession,
) -> Transaction:
    return await card_invoices_service.pay_invoice(
        db, user.id, account_id, close_date, payload, today=date.today()
    )
