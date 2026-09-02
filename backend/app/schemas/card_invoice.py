"""Credit-card invoice DTOs. An invoice is derived, never stored - see
app/services/card_invoices.py. Money fields are wire-serialized as strings,
like every other monetary DTO.
"""

from datetime import date as date_type
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import serialize_decimal

CardInvoiceStatus = Literal["open", "closed", "overdue", "paid", "projected"]


class CardInvoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    close_date: date_type
    due_date: date_type
    period_start: date_type
    period_end: date_type
    currency: str
    total: Decimal
    paid: Decimal
    remaining: Decimal
    status: CardInvoiceStatus

    @field_serializer("total", "paid", "remaining")
    def _serialize_money(self, value: Decimal) -> str | None:
        return serialize_decimal(value)


class CardInvoicePaymentCreate(BaseModel):
    """Body for POST /accounts/{id}/invoices/{close_date}/pay. Every field
    is optional: source defaults to the card's `payment_account_id`, date to
    today, amount to the invoice's remaining balance."""

    account_id: UUID | None = None
    date: date_type | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, min_length=1, max_length=200)
