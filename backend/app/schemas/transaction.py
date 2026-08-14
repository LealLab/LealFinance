"""Transaction DTOs, including the nested conversion object."""

from datetime import date as date_type
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import serialize_decimal

TransactionType = Literal["income", "expense", "transfer", "interest"]
ConversionSource = Literal["manual", "quote", "fallback"]


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
    currency: str = Field(min_length=3, max_length=3)
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
    conversion: ConversionRead | None

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return str(value)


class TransactionCreate(BaseModel):
    type: TransactionType
    date: date_type
    amount: Decimal = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)
    account_id: UUID
    to_account_id: UUID | None = None
    category_id: UUID | None = None
    description: str = Field(min_length=1, max_length=200)
    notes: str | None = None
    recurring_rule_id: UUID | None = None
    conversion: ConversionInput | None = None


class TransactionUpdate(BaseModel):
    type: TransactionType | None = None
    date: date_type | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    account_id: UUID | None = None
    to_account_id: UUID | None = None
    category_id: UUID | None = None
    description: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    recurring_rule_id: UUID | None = None
    conversion: ConversionInput | None = None
