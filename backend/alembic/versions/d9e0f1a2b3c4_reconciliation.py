"""bank reconciliation

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-09-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d9e0f1a2b3c4"
down_revision: str | Sequence[str] | None = "c8d9e0f1a2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create reconciliation and cleared-leg tables."""
    op.create_table(
        "reconciliations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("statement_date", sa.Date(), nullable=False),
        sa.Column("statement_balance", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=10), server_default="open", nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('open', 'completed')", name="ck_reconciliations_status"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_reconciliations_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_reconciliations_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["currency"],
            ["currencies.code"],
            name="fk_reconciliations_currency",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reconciliations_user_id", "reconciliations", ["user_id"], unique=False)
    op.create_index(
        "ix_reconciliations_account_id", "reconciliations", ["account_id"], unique=False
    )
    op.create_index(
        "ux_reconciliations_open_per_account",
        "reconciliations",
        ["user_id", "account_id"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
    )

    op.create_table(
        "reconciliation_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.Column("reconciliation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_reconciliation_entries_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reconciliation_id"],
            ["reconciliations.id"],
            name="fk_reconciliation_entries_reconciliation_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            name="fk_reconciliation_entries_transaction_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_reconciliation_entries_account_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "transaction_id", "account_id", name="uq_reconciliation_entries_txn_account"
        ),
    )
    op.create_index(
        "ix_reconciliation_entries_user_id", "reconciliation_entries", ["user_id"], unique=False
    )
    op.create_index(
        "ix_reconciliation_entries_reconciliation_id",
        "reconciliation_entries",
        ["reconciliation_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop reconciliation and cleared-leg tables."""
    op.drop_index(
        "ix_reconciliation_entries_reconciliation_id", table_name="reconciliation_entries"
    )
    op.drop_index("ix_reconciliation_entries_user_id", table_name="reconciliation_entries")
    op.drop_table("reconciliation_entries")
    op.drop_index("ux_reconciliations_open_per_account", table_name="reconciliations")
    op.drop_index("ix_reconciliations_account_id", table_name="reconciliations")
    op.drop_index("ix_reconciliations_user_id", table_name="reconciliations")
    op.drop_table("reconciliations")
