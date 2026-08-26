"""Investment DTOs and computed position/summary responses."""

from datetime import date as date_type
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.common import CurrencyCodeInput, PatchModel, serialize_decimal

InvestmentAssetClass = Literal["stock", "etf", "fund", "crypto", "bond", "other"]
InvestmentQuoteProvider = Literal["twelve_data", "brapi", "manual"]
InvestmentTransactionType = Literal["buy", "sell", "dividend", "fee"]


class InvestmentWalletRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    name: str
    currency: str
    cash_account_id: UUID | None
    institution_id: UUID | None
    archived: bool


class InvestmentWalletCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    currency: CurrencyCodeInput
    cash_account_id: UUID | None = None
    institution_id: UUID | None = None
    archived: bool = False


class InvestmentWalletUpdate(PatchModel):
    non_nullable_fields = frozenset({"name", "currency"})

    name: str | None = Field(default=None, min_length=1, max_length=100)
    currency: CurrencyCodeInput | None = None
    cash_account_id: UUID | None = None
    institution_id: UUID | None = None


class InvestmentAssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    symbol: str
    name: str
    asset_class: InvestmentAssetClass
    currency: str
    quote_provider: InvestmentQuoteProvider
    manual_price: Decimal | None
    archived: bool

    @field_serializer("manual_price")
    def _serialize_manual_price(self, value: Decimal | None) -> str | None:
        return serialize_decimal(value)


class InvestmentAssetCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    asset_class: InvestmentAssetClass
    currency: CurrencyCodeInput
    quote_provider: InvestmentQuoteProvider = "manual"
    manual_price: Decimal | None = Field(default=None, ge=0)
    archived: bool = False


class InvestmentAssetUpdate(PatchModel):
    non_nullable_fields = frozenset({"symbol", "name", "asset_class", "currency", "quote_provider"})

    symbol: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=100)
    asset_class: InvestmentAssetClass | None = None
    currency: CurrencyCodeInput | None = None
    quote_provider: InvestmentQuoteProvider | None = None
    manual_price: Decimal | None = Field(default=None, ge=0)
    archived: bool | None = None


class InvestmentTransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    wallet_id: UUID
    asset_id: UUID | None
    type: InvestmentTransactionType
    date: date_type
    quantity: Decimal | None
    price: Decimal | None
    amount: Decimal
    fee: Decimal
    currency: str
    transaction_id: UUID | None
    notes: str | None

    @field_serializer("quantity", "price", "amount", "fee")
    def _serialize_decimal(self, value: Decimal | None) -> str | None:
        return serialize_decimal(value)


class InvestmentTransactionCreate(BaseModel):
    wallet_id: UUID
    asset_id: UUID | None = None
    type: InvestmentTransactionType
    date: date_type
    quantity: Decimal | None = Field(default=None, gt=0)
    price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal = Field(ge=0)
    fee: Decimal = Field(default=Decimal("0"), ge=0)
    currency: CurrencyCodeInput
    notes: str | None = None


class InvestmentTransactionUpdate(PatchModel):
    non_nullable_fields = frozenset({"type", "date", "amount", "currency"})

    wallet_id: UUID | None = None
    asset_id: UUID | None = None
    type: InvestmentTransactionType | None = None
    date: date_type | None = None
    quantity: Decimal | None = Field(default=None, gt=0)
    price: Decimal | None = Field(default=None, ge=0)
    amount: Decimal | None = Field(default=None, ge=0)
    fee: Decimal | None = Field(default=None, ge=0)
    currency: CurrencyCodeInput | None = None
    notes: str | None = None


class InvestmentPositionRead(BaseModel):
    asset: InvestmentAssetRead
    quantity: Decimal
    average_cost: Decimal
    book_value: Decimal
    price: Decimal | None
    price_as_of: date_type | None
    price_is_stale: bool
    market_value: Decimal | None
    unrealized_gain: Decimal | None
    realized_gain: Decimal
    dividend_income: Decimal
    fees_paid: Decimal
    market_value_is_fallback: bool

    @field_serializer(
        "quantity",
        "average_cost",
        "book_value",
        "price",
        "market_value",
        "unrealized_gain",
        "realized_gain",
        "dividend_income",
        "fees_paid",
    )
    def _serialize_decimal(self, value: Decimal | None) -> str | None:
        return serialize_decimal(value)


class InvestmentSummaryRead(BaseModel):
    total_book_value: Decimal
    total_market_value: Decimal | None
    total_unrealized_gain: Decimal | None
    wallet_count: int

    @field_serializer("total_book_value", "total_market_value", "total_unrealized_gain")
    def _serialize_decimal(self, value: Decimal | None) -> str | None:
        return serialize_decimal(value)
