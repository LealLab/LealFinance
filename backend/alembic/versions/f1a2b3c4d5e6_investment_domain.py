"""investment domain tables

Revision ID: f1a2b3c4d5e6
Revises: e7f8a9b0c1d2
Create Date: 2026-08-26 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "e7f8a9b0c1d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the investment domain tables."""
    op.create_table(
        "investment_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("asset_class", sa.String(length=20), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("quote_provider", sa.String(length=20), nullable=False),
        sa.Column("manual_price", sa.Numeric(precision=19, scale=10), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_investment_assets_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["currency"],
            ["currencies.code"],
            name="fk_investment_assets_currency",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "symbol", name="uq_investment_assets_user_id_symbol"),
        sa.CheckConstraint(
            "asset_class IN ('stock', 'etf', 'fund', 'crypto', 'bond', 'other')",
            name="ck_investment_assets_asset_class",
        ),
        sa.CheckConstraint(
            "quote_provider IN ('twelve_data', 'brapi', 'manual')",
            name="ck_investment_assets_quote_provider",
        ),
        sa.CheckConstraint(
            "manual_price IS NULL OR manual_price >= 0",
            name="ck_investment_assets_manual_price_non_negative",
        ),
    )
    op.create_index("ix_investment_assets_user_id", "investment_assets", ["user_id"])

    op.create_table(
        "asset_quotes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("symbol", sa.String(length=32), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("price", sa.Numeric(precision=19, scale=10), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["currency"], ["currencies.code"], name="fk_asset_quotes_currency"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("symbol", "as_of", name="uq_asset_quotes_symbol_as_of"),
    )

    op.create_table(
        "investment_wallets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("cash_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("institution_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_investment_wallets_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_investment_wallets_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["currency"],
            ["currencies.code"],
            name="fk_investment_wallets_currency",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["cash_account_id"],
            ["accounts.id"],
            name="fk_investment_wallets_cash_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["institution_id"],
            ["institutions.id"],
            name="fk_investment_wallets_institution_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", name="uq_investment_wallets_account_id"),
    )
    op.create_index("ix_investment_wallets_user_id", "investment_wallets", ["user_id"])

    op.create_table(
        "investment_transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("wallet_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=28, scale=10), nullable=True),
        sa.Column("price", sa.Numeric(precision=19, scale=10), nullable=True),
        sa.Column("amount", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("fee", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_investment_transactions_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["wallet_id"],
            ["investment_wallets.id"],
            name="fk_investment_transactions_wallet_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["asset_id"],
            ["investment_assets.id"],
            name="fk_investment_transactions_asset_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["currency"],
            ["currencies.code"],
            name="fk_investment_transactions_currency",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            name="fk_investment_transactions_transaction_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("transaction_id", name="uq_investment_transactions_transaction_id"),
        sa.CheckConstraint(
            "(type IN ('buy','sell')) = (quantity IS NOT NULL AND price IS NOT NULL)",
            name="ck_investment_transactions_buy_sell_shape",
        ),
        sa.CheckConstraint(
            "type = 'fee' OR asset_id IS NOT NULL",
            name="ck_investment_transactions_asset_required",
        ),
        sa.CheckConstraint(
            "type IN ('buy', 'sell', 'dividend', 'fee')",
            name="ck_investment_transactions_type",
        ),
        sa.CheckConstraint(
            "quantity IS NULL OR quantity > 0",
            name="ck_investment_transactions_quantity_positive",
        ),
        sa.CheckConstraint(
            "price IS NULL OR price >= 0",
            name="ck_investment_transactions_price_non_negative",
        ),
        sa.CheckConstraint("fee >= 0", name="ck_investment_transactions_fee_non_negative"),
        sa.CheckConstraint("amount >= 0", name="ck_investment_transactions_amount_non_negative"),
    )
    op.create_index("ix_investment_transactions_user_id", "investment_transactions", ["user_id"])
    op.create_index(
        "ix_investment_transactions_wallet_id", "investment_transactions", ["wallet_id"]
    )
    op.create_index("ix_investment_transactions_asset_id", "investment_transactions", ["asset_id"])


def downgrade() -> None:
    """Drop investment tables in foreign-key-safe order."""
    op.drop_index("ix_investment_transactions_asset_id", table_name="investment_transactions")
    op.drop_index("ix_investment_transactions_wallet_id", table_name="investment_transactions")
    op.drop_index("ix_investment_transactions_user_id", table_name="investment_transactions")
    op.drop_table("investment_transactions")
    op.drop_index("ix_investment_wallets_user_id", table_name="investment_wallets")
    op.drop_table("investment_wallets")
    op.drop_index("ix_investment_assets_user_id", table_name="investment_assets")
    op.drop_table("investment_assets")
    op.drop_table("asset_quotes")
