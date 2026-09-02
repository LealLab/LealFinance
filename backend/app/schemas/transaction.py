"""Transaction DTOs, including the nested conversion object."""

from datetime import date as date_type
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import CurrencyCodeInput, PatchModel, serialize_decimal

TransactionType = Literal["income", "expense", "transfer", "interest"]
ConversionSource = Literal["manual", "quote", "fallback"]

# ponytail: matches the 200-row list page cap with headroom for select-all.
# Raise (and reconsider the list limit cap) if a real bulk case needs more.
MAX_BULK_IDS = 500


class ConversionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    amount: Decimal
    currency: str
    fee: Decimal | None
    rate: Decimal
    source: ConversionSource

    @field_serializer("amount", "fee", "rate")
    def _serialize(self, value: Decimal | None) -> str | None:
        return serialize_decimal(value)


class ConversionInput(BaseModel):
    """What actually posted to the destination account is supplied by the
    client but re-validated server-side - see app/services/conversion.py.
    `amount` may be omitted; the server fills it in from `(origin - fee) *
    rate` when it is."""

    amount: Decimal | None = None
    currency: CurrencyCodeInput
    fee: Decimal | None = Field(default=None, ge=0)
    rate: Decimal = Field(gt=0)
    source: ConversionSource


class TransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: TransactionType
    date: date_type
    amount: Decimal
    currency: str
    account_id: UUID
    to_account_id: UUID | None
    category_id: UUID | None
    description: str
    notes: str | None
    recurring_rule_id: UUID | None
    loan_id: UUID | None
    card_invoice_close_date: date_type | None
    installment_group_id: UUID | None
    installment_number: int | None
    installment_count: int | None
    conversion: ConversionRead | None

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return str(value)


class TransactionCreate(BaseModel):
    type: TransactionType
    date: date_type
    amount: Decimal = Field(gt=0)
    currency: CurrencyCodeInput
    account_id: UUID
    to_account_id: UUID | None = None
    category_id: UUID | None = None
    description: str = Field(min_length=1, max_length=200)
    notes: str | None = None
    recurring_rule_id: UUID | None = None
    loan_id: UUID | None = None
    # Provenance for a credit-card invoice payment - set by
    # app/services/card_invoices.py::pay_invoice, same as loan_id is set by
    # the loan payment flow. Only valid on a transfer into a credit_card
    # account (enforced in transactions.build_transaction).
    card_invoice_close_date: date_type | None = None
    # Split this expense into N equal monthly installments on a credit
    # card. Handled by transactions.create_transaction, which writes N rows
    # (see ck_transactions_installment_shape); not accepted anywhere else.
    installments: int | None = Field(default=None, ge=2, le=99)
    conversion: ConversionInput | None = None


class TransactionBulkDelete(BaseModel):
    ids: Annotated[list[UUID], Field(min_length=1, max_length=MAX_BULK_IDS)]


class TransactionBulkCategorize(TransactionBulkDelete):
    category_id: UUID


class BulkResultRead(BaseModel):
    updated: int


class TransactionUpdate(PatchModel):
    non_nullable_fields = frozenset(
        {"type", "date", "amount", "currency", "account_id", "description"}
    )

    type: TransactionType | None = None
    date: date_type | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    currency: CurrencyCodeInput | None = None
    account_id: UUID | None = None
    to_account_id: UUID | None = None
    category_id: UUID | None = None
    description: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    recurring_rule_id: UUID | None = None
    loan_id: UUID | None = None
    card_invoice_close_date: date_type | None = None
    conversion: ConversionInput | None = None
