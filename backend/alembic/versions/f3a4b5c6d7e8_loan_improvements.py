"""contracted loan installments and numbered loan payments

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-09-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f3a4b5c6d7e8"
down_revision: str | Sequence[str] | None = "e2f3a4b5c6d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "loans",
        sa.Column("contracted_installment_amount", sa.Numeric(19, 4), nullable=True),
    )
    op.create_check_constraint(
        "ck_loans_contracted_installment_amount_positive",
        "loans",
        "contracted_installment_amount IS NULL OR contracted_installment_amount > 0",
    )

    op.drop_constraint("ck_transactions_installment_shape", "transactions", type_="check")
    op.execute(
        """
        WITH ranked AS (
            SELECT tx.id,
                   tx.loan_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY tx.loan_id
                       ORDER BY tx.date, tx.created_at, tx.id
                   ) AS installment_number,
                   COUNT(*) OVER (PARTITION BY tx.loan_id) AS payment_count
            FROM transactions AS tx
            WHERE tx.loan_id IS NOT NULL
        )
        UPDATE transactions AS tx
        SET installment_group_id = NULL,
            installment_number = ranked.installment_number,
            installment_count = GREATEST(loan.installment_count, ranked.payment_count)
        FROM ranked
        JOIN loans AS loan ON loan.id = ranked.loan_id
        WHERE tx.id = ranked.id
        """
    )
    op.create_check_constraint(
        "ck_transactions_installment_shape",
        "transactions",
        "(installment_group_id IS NULL AND installment_number IS NULL "
        "AND installment_count IS NULL) OR "
        "(installment_group_id IS NOT NULL AND loan_id IS NULL "
        "AND installment_count >= 2 "
        "AND installment_number BETWEEN 1 AND installment_count) OR "
        "(installment_group_id IS NULL AND installment_count >= 1 "
        "AND installment_number BETWEEN 1 AND installment_count)",
    )
    op.create_index(
        "ux_transactions_loan_installment_number",
        "transactions",
        ["loan_id", "installment_number"],
        unique=True,
        postgresql_where=sa.text("loan_id IS NOT NULL AND installment_number IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ux_transactions_loan_installment_number", table_name="transactions")
    op.drop_constraint("ck_transactions_installment_shape", "transactions", type_="check")
    op.execute(
        """
        UPDATE transactions
        SET installment_group_id = NULL,
            installment_number = NULL,
            installment_count = NULL
        WHERE loan_id IS NOT NULL
        """
    )
    op.create_check_constraint(
        "ck_transactions_installment_shape",
        "transactions",
        "(installment_group_id IS NULL AND installment_number IS NULL "
        "AND installment_count IS NULL) OR "
        "(installment_group_id IS NOT NULL AND installment_count >= 2 "
        "AND installment_number BETWEEN 1 AND installment_count)",
    )
    op.drop_constraint("ck_loans_contracted_installment_amount_positive", "loans", type_="check")
    op.drop_column("loans", "contracted_installment_amount")
