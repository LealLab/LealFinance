"""Account DTOs.

Every monetary field is serialized as a JSON string, never a number -
see docs/money-and-currency.md and app/schemas/common.py::serialize_decimal.
"""

from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import serialize_decimal

AccountType = Literal["checking", "savings", "cash", "credit_card", "investment", "goal"]


class AccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: AccountType
    currency: str
    opening_balance: Decimal
    institution_id: UUID | None
    archived: bool
    credit_limit: Decimal | None
    closing_day: int | None
    due_day: int | None

    @field_serializer("opening_balance", "credit_limit")
    def _serialize_money(self, value: Decimal | None) -> str | None:
        return serialize_decimal(value)


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: AccountType
    currency: str = Field(min_length=3, max_length=3)
    opening_balance: Decimal = Decimal("0")
    institution_id: UUID | None = None
    archived: bool = False
    credit_limit: Decimal | None = None
    closing_day: int | None = Field(default=None, ge=1, le=31)
    due_day: int | None = Field(default=None, ge=1, le=31)


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    type: AccountType | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    opening_balance: Decimal | None = None
    institution_id: UUID | None = None
    archived: bool | None = None
    credit_limit: Decimal | None = None
    closing_day: int | None = Field(default=None, ge=1, le=31)
    due_day: int | None = Field(default=None, ge=1, le=31)
