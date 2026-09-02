"""credit-card purchase installments

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-09-01 00:00:01.000000

A purchase split into N equal monthly installments on a credit card: one
transaction row per installment, tied together by installment_group_id.
number/count ("3/10") are stored - immutable facts of the purchase, and
cheaper than a window function on every ledger read.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9c0d1e2f3a4"
down_revision: str | Sequence[str] | None = "a8b9c0d1e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "transactions",
        sa.Column("installment_group_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("transactions", sa.Column("installment_number", sa.SmallInteger(), nullable=True))
    op.add_column("transactions", sa.Column("installment_count", sa.SmallInteger(), nullable=True))
    op.create_index(
        "ix_transactions_installment_group_id",
        "transactions",
        ["installment_group_id"],
    )
    op.create_check_constraint(
        "ck_transactions_installment_shape",
        "transactions",
        "(installment_group_id IS NULL AND installment_number IS NULL "
        "AND installment_count IS NULL) OR "
        "(installment_group_id IS NOT NULL AND installment_count >= 2 "
        "AND installment_number BETWEEN 1 AND installment_count)",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_transactions_installment_shape", "transactions", type_="check")
    op.drop_index("ix_transactions_installment_group_id", table_name="transactions")
    op.drop_column("transactions", "installment_count")
    op.drop_column("transactions", "installment_number")
    op.drop_column("transactions", "installment_group_id")
