"""Bank reconciliation request and response DTOs."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import serialize_decimal

ReconciliationStatus = Literal["open", "completed"]
ReconciliationLeg = Literal["own", "incoming"]


class ReconciliationCreate(BaseModel):
    account_id: UUID
    statement_date: date
    statement_balance: Decimal


class ReconciliationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    statement_date: date
    statement_balance: Decimal
    currency: str
    status: ReconciliationStatus
    completed_at: datetime | None
    created_at: datetime

    @field_serializer("statement_balance")
    def _serialize_statement_balance(self, value: Decimal) -> str:
        result = serialize_decimal(value)
        assert result is not None
        return result


class ReconciliationEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    transaction_id: UUID
    leg: ReconciliationLeg
    date: date
    description: str
    amount: Decimal
    cleared: bool
    cleared_by: UUID | None

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        result = serialize_decimal(value)
        assert result is not None
        return result


class ReconciliationDetailRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reconciliation: ReconciliationRead
    statement_balance: Decimal
    book_balance: Decimal
    cleared_balance: Decimal
    difference: Decimal
    entries: list[ReconciliationEntryRead]

    @field_serializer("statement_balance", "book_balance", "cleared_balance", "difference")
    def _serialize_money(self, value: Decimal) -> str:
        result = serialize_decimal(value)
        assert result is not None
        return result


class ReconciliationEntriesRequest(BaseModel):
    transaction_ids: list[UUID] = Field(min_length=1)
    cleared: bool
