"""Budget allocation and expected-income DTOs - the inputs
domain/calc/budget-plan.ts derives auto-generated budgets from."""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import CurrencyCodeInput

_MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


class BudgetAllocationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category_id: UUID
    percentage: Decimal

    @field_serializer("percentage")
    def _serialize_percentage(self, value: Decimal) -> str:
        return str(value)


class BudgetAllocationUpsert(BaseModel):
    category_id: UUID
    percentage: Decimal = Field(ge=0, le=100)


class ExpectedIncomeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    month: str
    amount: Decimal
    currency: str

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return str(value)


class ExpectedIncomeUpsert(BaseModel):
    month: str = Field(pattern=_MONTH_PATTERN)
    amount: Decimal = Field(ge=0)
    currency: CurrencyCodeInput
