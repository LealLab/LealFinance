"""Recurring rule DTOs. `template` mirrors TransactionCreate/Read minus
id/date/recurring_rule_id - see app/models/recurring.py."""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import CurrencyCodeInput, PatchModel
from app.schemas.transaction import ConversionInput, ConversionRead, TransactionType

RecurringFrequency = Literal["weekly", "monthly", "yearly"]


class RecurringTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    type: TransactionType
    amount: Decimal
    currency: str
    account_id: UUID
    to_account_id: UUID | None
    category_id: UUID | None
    description: str
    notes: str | None
    conversion: ConversionRead | None

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return str(value)


class RecurringTemplateInput(BaseModel):
    type: TransactionType
    amount: Decimal = Field(gt=0)
    currency: CurrencyCodeInput
    account_id: UUID
    to_account_id: UUID | None = None
    category_id: UUID | None = None
    description: str = Field(min_length=1, max_length=200)
    notes: str | None = None
    conversion: ConversionInput | None = None


class RecurringRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    frequency: RecurringFrequency
    interval: int
    start_date: date
    end_date: date | None
    last_posted_date: date | None
    template: RecurringTemplateRead


class RecurringRuleCreate(BaseModel):
    frequency: RecurringFrequency
    interval: int = Field(default=1, ge=1)
    start_date: date
    end_date: date | None = None
    template: RecurringTemplateInput


class RecurringRuleUpdate(PatchModel):
    non_nullable_fields = frozenset({"frequency", "interval", "start_date", "template"})

    frequency: RecurringFrequency | None = None
    interval: int | None = Field(default=None, ge=1)
    start_date: date | None = None
    end_date: date | None = None
    # Not deep-partial: providing `template` replaces it in full, matching
    # the frontend's Partial<Omit<RecurringRule, 'id'>> (template itself is
    # not itself a Partial<...>).
    template: RecurringTemplateInput | None = None
