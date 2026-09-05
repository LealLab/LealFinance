"""Pluggy credential and item-lifecycle DTOs."""

from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import serialize_decimal

PluggyEnvironment = Literal["sandbox", "production"]


class PluggyCredentialStatusRead(BaseModel):
    configured: bool
    environment: PluggyEnvironment | None


class PluggyCredentialWrite(BaseModel):
    client_id: str = Field(min_length=1)
    client_secret: str = Field(min_length=1)
    environment: PluggyEnvironment = "sandbox"


class ConnectTokenRequest(BaseModel):
    item_id: str | None = Field(default=None, min_length=1, max_length=64)


class ConnectTokenRead(BaseModel):
    access_token: str


class PluggyItemCreate(BaseModel):
    external_id: str = Field(min_length=1, max_length=64)


class PluggyItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    external_id: str
    connector_id: int
    connector_name: str
    connector_image_url: str | None
    status: str
    execution_status: str | None
    status_detail: dict[str, object] | None
    institution_id: UUID | None
    last_synced_at: datetime | None
    last_sync_error: str | None
    consent_expires_at: datetime | None


class PluggyAccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pluggy_item_id: UUID
    account_id: UUID | None
    external_id: str
    type: str
    subtype: str
    name: str
    number: str | None
    currency: str
    synced_balance: Decimal
    credit_limit: Decimal | None
    available_credit_limit: Decimal | None
    raw: dict[str, object]
    last_transaction_date: date_type | None
    sync_enabled: bool

    @field_serializer("synced_balance", "credit_limit", "available_credit_limit")
    def _serialize_money(self, value: Decimal | None) -> str | None:
        return serialize_decimal(value)


class SyncResultRead(BaseModel):
    transactions_imported: int
    accounts_synced: int
    error: str | None = None
