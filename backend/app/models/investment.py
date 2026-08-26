"""Investment wallets, asset registries, ledger entries, and quote cache."""

import uuid
from datetime import date as date_type

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UserOwnedModel, UUIDPrimaryKeyMixin
from app.models.types import AssetPrice, CurrencyCode, MoneyAmount, UnitQuantity

ASSET_CLASS_STOCK = "stock"
ASSET_CLASS_ETF = "etf"
ASSET_CLASS_FUND = "fund"
ASSET_CLASS_CRYPTO = "crypto"
ASSET_CLASS_BOND = "bond"
ASSET_CLASS_OTHER = "other"
ASSET_CLASSES = (
    ASSET_CLASS_STOCK,
    ASSET_CLASS_ETF,
    ASSET_CLASS_FUND,
    ASSET_CLASS_CRYPTO,
    ASSET_CLASS_BOND,
    ASSET_CLASS_OTHER,
)

QUOTE_PROVIDER_TWELVE_DATA = "twelve_data"
QUOTE_PROVIDER_BRAPI = "brapi"
QUOTE_PROVIDER_MANUAL = "manual"
QUOTE_PROVIDERS = (
    QUOTE_PROVIDER_TWELVE_DATA,
    QUOTE_PROVIDER_BRAPI,
    QUOTE_PROVIDER_MANUAL,
)

INVESTMENT_TRANSACTION_TYPE_BUY = "buy"
INVESTMENT_TRANSACTION_TYPE_SELL = "sell"
INVESTMENT_TRANSACTION_TYPE_DIVIDEND = "dividend"
INVESTMENT_TRANSACTION_TYPE_FEE = "fee"
INVESTMENT_TRANSACTION_TYPES = (
    INVESTMENT_TRANSACTION_TYPE_BUY,
    INVESTMENT_TRANSACTION_TYPE_SELL,
    INVESTMENT_TRANSACTION_TYPE_DIVIDEND,
    INVESTMENT_TRANSACTION_TYPE_FEE,
)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class InvestmentWallet(UserOwnedModel):
    __tablename__ = "investment_wallets"
    __error_prefix__ = "investment_wallet"
    __table_args__ = (UniqueConstraint("account_id", name="uq_investment_wallets_account_id"),)

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="RESTRICT", name="fk_investment_wallets_account_id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_investment_wallets_currency"),
        nullable=False,
    )
    cash_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "accounts.id", ondelete="RESTRICT", name="fk_investment_wallets_cash_account_id"
        ),
    )
    institution_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "institutions.id", ondelete="RESTRICT", name="fk_investment_wallets_institution_id"
        ),
    )
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class InvestmentAsset(UserOwnedModel):
    __tablename__ = "investment_assets"
    __error_prefix__ = "investment_asset"
    __table_args__ = (
        UniqueConstraint("user_id", "symbol", name="uq_investment_assets_user_id_symbol"),
        CheckConstraint(
            _in_check("asset_class", ASSET_CLASSES), name="ck_investment_assets_asset_class"
        ),
        CheckConstraint(
            _in_check("quote_provider", QUOTE_PROVIDERS),
            name="ck_investment_assets_quote_provider",
        ),
        CheckConstraint(
            "manual_price IS NULL OR manual_price >= 0",
            name="ck_investment_assets_manual_price_non_negative",
        ),
    )

    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    asset_class: Mapped[str] = mapped_column(String(20), nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", ondelete="RESTRICT", name="fk_investment_assets_currency"),
        nullable=False,
    )
    quote_provider: Mapped[str] = mapped_column(
        String(20), nullable=False, default=QUOTE_PROVIDER_MANUAL
    )
    manual_price: Mapped[AssetPrice | None] = mapped_column()
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class InvestmentTransaction(UserOwnedModel):
    __tablename__ = "investment_transactions"
    __error_prefix__ = "investment_transaction"
    __table_args__ = (
        UniqueConstraint("transaction_id", name="uq_investment_transactions_transaction_id"),
        Index("ix_investment_transactions_wallet_id", "wallet_id"),
        Index("ix_investment_transactions_asset_id", "asset_id"),
        CheckConstraint(
            "(type IN ('buy','sell')) = (quantity IS NOT NULL AND price IS NOT NULL)",
            name="ck_investment_transactions_buy_sell_shape",
        ),
        CheckConstraint(
            "type = 'fee' OR asset_id IS NOT NULL",
            name="ck_investment_transactions_asset_required",
        ),
        CheckConstraint(
            _in_check("type", INVESTMENT_TRANSACTION_TYPES),
            name="ck_investment_transactions_type",
        ),
        CheckConstraint(
            "quantity IS NULL OR quantity > 0",
            name="ck_investment_transactions_quantity_positive",
        ),
        CheckConstraint(
            "price IS NULL OR price >= 0",
            name="ck_investment_transactions_price_non_negative",
        ),
        CheckConstraint("fee >= 0", name="ck_investment_transactions_fee_non_negative"),
        CheckConstraint("amount >= 0", name="ck_investment_transactions_amount_non_negative"),
    )

    wallet_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "investment_wallets.id",
            ondelete="RESTRICT",
            name="fk_investment_transactions_wallet_id",
        ),
        nullable=False,
    )
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "investment_assets.id",
            ondelete="RESTRICT",
            name="fk_investment_transactions_asset_id",
        ),
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    quantity: Mapped[UnitQuantity | None] = mapped_column()
    price: Mapped[AssetPrice | None] = mapped_column()
    amount: Mapped[MoneyAmount] = mapped_column(nullable=False)
    fee: Mapped[MoneyAmount] = mapped_column(nullable=False, default=0)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey(
            "currencies.code",
            ondelete="RESTRICT",
            name="fk_investment_transactions_currency",
        ),
        nullable=False,
    )
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "transactions.id",
            ondelete="RESTRICT",
            name="fk_investment_transactions_transaction_id",
        ),
    )
    notes: Mapped[str | None] = mapped_column(Text)


class AssetQuote(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "asset_quotes"
    __table_args__ = (UniqueConstraint("symbol", "as_of", name="uq_asset_quotes_symbol_as_of"),)

    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    currency: Mapped[CurrencyCode] = mapped_column(
        ForeignKey("currencies.code", name="fk_asset_quotes_currency"), nullable=False
    )
    price: Mapped[AssetPrice] = mapped_column(nullable=False)
    as_of: Mapped[date_type] = mapped_column(Date, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)


MARKET_DATA_PROVIDERS = (QUOTE_PROVIDER_TWELVE_DATA, QUOTE_PROVIDER_BRAPI)


class MarketDataCredential(UserOwnedModel):
    __tablename__ = "market_data_credentials"
    __error_prefix__ = "market_data_credential"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_market_data_credentials_user_id_provider"),
        CheckConstraint(
            _in_check("provider", MARKET_DATA_PROVIDERS),
            name="ck_market_data_credentials_provider",
        ),
    )

    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    secret_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
