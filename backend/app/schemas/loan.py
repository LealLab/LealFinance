"""Loan DTOs. A loan is standalone metadata (app/models/loan.py); the link
to the ledger is `Transaction.loan_id`, set on every payment recorded
against the loan. `installment_amount` and `installments_paid` are both
derived server-side and never accepted from the client - see
app/services/loans.py.
"""

from datetime import date as date_type
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import CurrencyCodeInput, PatchModel, serialize_decimal

LoanRatePeriod = Literal["annual", "monthly"]


class LoanRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    category_id: UUID
    currency: str
    amount_borrowed: Decimal
    fees: Decimal
    interest_rate: Decimal
    rate_period: LoanRatePeriod
    installment_count: int
    installment_amount: Decimal
    first_payment_date: date_type
    auto_post: bool
    payment_account_id: UUID | None
    notes: str | None
    archived: bool
    # Derived: COUNT(transactions WHERE loan_id = this loan). Populated by
    # the service, not a column.
    installments_paid: int

    @field_serializer("amount_borrowed", "fees", "interest_rate", "installment_amount")
    def _serialize_decimals(self, value: Decimal) -> str | None:
        return serialize_decimal(value)


class LoanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category_id: UUID
    currency: CurrencyCodeInput
    amount_borrowed: Decimal = Field(gt=0)
    fees: Decimal = Field(default=Decimal(0), ge=0)
    interest_rate: Decimal = Field(default=Decimal(0), ge=0)
    rate_period: LoanRatePeriod = "annual"
    installment_count: int = Field(ge=1)
    first_payment_date: date_type
    auto_post: bool = False
    payment_account_id: UUID | None = None
    notes: str | None = None
    archived: bool = False


class LoanUpdate(PatchModel):
    non_nullable_fields = frozenset(
        {
            "name",
            "category_id",
            "currency",
            "amount_borrowed",
            "fees",
            "interest_rate",
            "rate_period",
            "installment_count",
            "first_payment_date",
            "auto_post",
            "archived",
        }
    )

    name: str | None = Field(default=None, min_length=1, max_length=100)
    category_id: UUID | None = None
    currency: CurrencyCodeInput | None = None
    amount_borrowed: Decimal | None = Field(default=None, gt=0)
    fees: Decimal | None = Field(default=None, ge=0)
    interest_rate: Decimal | None = Field(default=None, ge=0)
    rate_period: LoanRatePeriod | None = None
    installment_count: int | None = Field(default=None, ge=1)
    first_payment_date: date_type | None = None
    auto_post: bool | None = None
    payment_account_id: UUID | None = None
    notes: str | None = None
    archived: bool | None = None


class LoanPaymentCreate(BaseModel):
    """A single installment payment. `amount` defaults to the loan's
    computed installment when omitted; `date` defaults to today. The same
    endpoint backs both the manual "record payment" modal and the "pay
    now" advance button - only the prefilled date differs."""

    amount: Decimal | None = Field(default=None, gt=0)
    date: date_type | None = None
    account_id: UUID | None = None
    description: str | None = Field(default=None, max_length=200)
