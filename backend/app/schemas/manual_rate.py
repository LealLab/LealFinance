"""Manual exchange rate DTOs."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class ManualRateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    base_code: str
    quote_code: str
    rate: Decimal
    as_of: date

    @field_serializer("rate")
    def _serialize_rate(self, value: Decimal) -> str:
        return str(value)


class ManualRateUpsert(BaseModel):
    rate: Decimal = Field(gt=0)
