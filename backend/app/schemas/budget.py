"""Budget DTOs."""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

_MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


class BudgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category_id: UUID
    month: str
    amount: Decimal
    currency: str

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal) -> str:
        return str(value)


class BudgetUpsert(BaseModel):
    category_id: UUID
    month: str = Field(pattern=_MONTH_PATTERN)
    amount: Decimal = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)
