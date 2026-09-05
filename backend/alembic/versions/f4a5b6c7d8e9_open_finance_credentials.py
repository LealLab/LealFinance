"""Pluggy credentials, item/account snapshots, and transaction provenance.

Revision ID: f4a5b6c7d8e9
Revises: f3a4b5c6d7e8
Create Date: 2026-09-05 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "f4a5b6c7d8e9"
down_revision: str | Sequence[str] | None = "f3a4b5c6d7e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create Pluggy storage and the transaction deduplication key."""
    op.create_table(
        "pluggy_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id_ciphertext", sa.Text(), nullable=False),
        sa.Column("client_secret_ciphertext", sa.Text(), nullable=False),
        sa.Column("environment", sa.String(length=20), nullable=False),
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
            name="fk_pluggy_credentials_user_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_pluggy_credentials_user_id"),
        sa.CheckConstraint(
            "environment IN ('sandbox', 'production')",
            name="ck_pluggy_credentials_environment",
        ),
    )
    op.create_index("ix_pluggy_credentials_user_id", "pluggy_credentials", ["user_id"])

    op.create_table(
        "pluggy_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("connector_id", sa.Integer(), nullable=False),
        sa.Column("connector_name", sa.String(length=100), nullable=False),
        sa.Column("connector_image_url", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("execution_status", sa.String(length=50), nullable=True),
        sa.Column("status_detail", postgresql.JSONB(), nullable=True),
        sa.Column("institution_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_error", sa.String(length=200), nullable=True),
        sa.Column("consent_expires_at", sa.DateTime(timezone=True), nullable=True),
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
            name="fk_pluggy_items_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["institution_id"],
            ["institutions.id"],
            name="fk_pluggy_items_institution_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "external_id", name="uq_pluggy_items_user_id_external_id"),
    )
    op.create_index("ix_pluggy_items_user_id", "pluggy_items", ["user_id"])

    op.create_table(
        "pluggy_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pluggy_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("subtype", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("number", sa.String(length=100), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("synced_balance", sa.Numeric(19, 4), nullable=False),
        sa.Column("credit_limit", sa.Numeric(19, 4), nullable=True),
        sa.Column("available_credit_limit", sa.Numeric(19, 4), nullable=True),
        sa.Column("raw", postgresql.JSONB(), nullable=False),
        sa.Column("last_transaction_date", sa.Date(), nullable=True),
        sa.Column("sync_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
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
            name="fk_pluggy_accounts_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["pluggy_item_id"],
            ["pluggy_items.id"],
            name="fk_pluggy_accounts_pluggy_item_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_pluggy_accounts_account_id",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["currency"],
            ["currencies.code"],
            name="fk_pluggy_accounts_currency",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "external_id", name="uq_pluggy_accounts_user_id_external_id"
        ),
    )
    op.alter_column("pluggy_accounts", "sync_enabled", server_default=None)
    op.create_index("ix_pluggy_accounts_user_id", "pluggy_accounts", ["user_id"])

    op.add_column(
        "transactions",
        sa.Column("pluggy_transaction_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ux_transactions_pluggy_transaction_id",
        "transactions",
        ["user_id", "pluggy_transaction_id"],
        unique=True,
        postgresql_where=sa.text("pluggy_transaction_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Drop Pluggy storage and transaction provenance."""
    op.drop_index("ux_transactions_pluggy_transaction_id", table_name="transactions")
    op.drop_column("transactions", "pluggy_transaction_id")

    op.drop_index("ix_pluggy_accounts_user_id", table_name="pluggy_accounts")
    op.drop_table("pluggy_accounts")
    op.drop_index("ix_pluggy_items_user_id", table_name="pluggy_items")
    op.drop_table("pluggy_items")
    op.drop_index("ix_pluggy_credentials_user_id", table_name="pluggy_credentials")
    op.drop_table("pluggy_credentials")
