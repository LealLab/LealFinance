"""Goal DTOs - metadata over a goal-type Account (app/models/account.py).
Balance stays derived from the linked account's ledger."""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

GoalFrequency = Literal["weekly", "monthly", "yearly"]


class GoalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    name: str
    target_amount: Decimal
    currency: str
    target_date: date | None
    frequency: GoalFrequency | None
    interval: int | None
    archived: bool

    @field_serializer("target_amount")
    def _serialize_target_amount(self, value: Decimal) -> str:
        return str(value)


class GoalCreate(BaseModel):
    account_id: UUID
    name: str = Field(min_length=1, max_length=100)
    target_amount: Decimal = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)
    target_date: date | None = None
    frequency: GoalFrequency | None = None
    interval: int | None = Field(default=None, ge=1)
    archived: bool = False


class GoalUpdate(BaseModel):
    account_id: UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=100)
    target_amount: Decimal | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    target_date: date | None = None
    frequency: GoalFrequency | None = None
    interval: int | None = Field(default=None, ge=1)
    archived: bool | None = None
