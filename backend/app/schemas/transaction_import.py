"""DTOs for CSV transaction import: request-side parsing options and
column mapping, plus the row-by-row preview response. Commit reuses
TransactionCreate verbatim - see app/services/csv_import.py for parsing and
app/services/transactions.py::import_transactions for the write."""

from datetime import date as date_type
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import serialize_decimal
from app.schemas.transaction import TransactionCreate

ImportRowError = Literal[
    "import.row.invalid_date",
    "import.row.invalid_amount",
    "import.row.zero_amount",
    "import.row.missing_description",
]


class ImportOptions(BaseModel):
    date_format: Literal["auto", "iso", "dmy", "mdy"] = "auto"
    decimal_separator: Literal["auto", ".", ","] = "auto"
    invert_sign: bool = False


class ImportPreviewRequest(BaseModel):
    """`content` is the raw CSV text, read client-side via File.text() -
    there is no multipart upload here, just a JSON string field."""

    content: str = Field(min_length=1)
    account_id: UUID
    mapping: dict[str, str] | None = None
    options: ImportOptions = Field(default_factory=ImportOptions)


class ImportRowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    index: int
    date: date_type | None
    description: str
    type: Literal["income", "expense"] | None
    amount: Decimal | None
    category_id: UUID | None
    category_name: str | None
    rule_name: str | None
    notes: str | None
    error: ImportRowError | None
    duplicate: bool

    @field_serializer("amount")
    def _serialize_amount(self, value: Decimal | None) -> str | None:
        return serialize_decimal(value)


class ImportPreviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    headers: list[str]
    mapping: dict[str, str | None]
    rows: list[ImportRowRead]


class ImportCommitRequest(BaseModel):
    items: list[TransactionCreate] = Field(min_length=1, max_length=2000)


class ImportCommitRead(BaseModel):
    created: int
