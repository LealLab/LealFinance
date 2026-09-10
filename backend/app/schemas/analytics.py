"""Pydantic read models for ledger analytics."""

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_serializer

from app.schemas.common import serialize_decimal


class GroupSpendRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    group_id: UUID
    currency: str
    total: Decimal

    @field_serializer("total")
    def _serialize_money(self, value: Decimal) -> str | None:
        return serialize_decimal(value)


class MonthTotalsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: str
    currency: str
    income: Decimal
    expense: Decimal
    net: Decimal

    @field_serializer("income", "expense", "net")
    def _serialize_money(self, value: Decimal) -> str | None:
        return serialize_decimal(value)


class AccountBalancePointRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: str
    account_id: UUID
    currency: str
    balance: Decimal

    @field_serializer("balance")
    def _serialize_money(self, value: Decimal) -> str | None:
        return serialize_decimal(value)
