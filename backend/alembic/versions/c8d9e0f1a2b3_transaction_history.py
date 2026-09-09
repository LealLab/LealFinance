"""add transaction history

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-09-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b3"
down_revision: str | Sequence[str] | None = "b7c8d9e0f1a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create immutable transaction audit history."""
    op.create_table(
        "transaction_history",
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
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operation", sa.String(length=10), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        sa.CheckConstraint(
            "operation IN ('create', 'update', 'delete')",
            name="ck_transaction_history_operation",
        ),
        sa.CheckConstraint(
            "source IN ("
            "'manual', 'import', 'import_undo', 'recurring', 'loan', 'card', "
            "'investment', 'bulk')",
            name="ck_transaction_history_source",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_transaction_history_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["import_idempotency.id"],
            name="fk_transaction_history_batch_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_transaction_history_user_id", "transaction_history", ["user_id"], unique=False
    )
    op.create_index(
        "ix_transaction_history_transaction_id",
        "transaction_history",
        ["transaction_id"],
        unique=False,
    )
    op.create_index(
        "ix_transaction_history_batch_id", "transaction_history", ["batch_id"], unique=False
    )
    op.create_index(
        "ix_transaction_history_user_id_transaction_id",
        "transaction_history",
        ["user_id", "transaction_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop transaction audit history."""
    op.drop_index("ix_transaction_history_user_id_transaction_id", table_name="transaction_history")
    op.drop_index("ix_transaction_history_batch_id", table_name="transaction_history")
    op.drop_index("ix_transaction_history_transaction_id", table_name="transaction_history")
    op.drop_index("ix_transaction_history_user_id", table_name="transaction_history")
    op.drop_table("transaction_history")
