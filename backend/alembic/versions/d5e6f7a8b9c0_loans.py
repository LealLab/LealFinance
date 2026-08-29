"""loans and transactions.loan_id

Revision ID: d5e6f7a8b9c0
Revises: c3d4e5f6a1b2
Create Date: 2026-08-29 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"
down_revision: str | Sequence[str] | None = "c3d4e5f6a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "loans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("amount_borrowed", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("fees", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("interest_rate", sa.Numeric(precision=7, scale=4), nullable=False),
        sa.Column("rate_period", sa.String(length=10), nullable=False),
        sa.Column("installment_count", sa.Integer(), nullable=False),
        sa.Column("installment_amount", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("first_payment_date", sa.Date(), nullable=False),
        sa.Column("auto_post", sa.Boolean(), nullable=False),
        sa.Column("payment_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
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
            ["user_id"], ["users.id"], name="fk_loans_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_loans_category_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["currency"], ["currencies.code"], name="fk_loans_currency", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["payment_account_id"],
            ["accounts.id"],
            name="fk_loans_payment_account_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("amount_borrowed > 0", name="ck_loans_amount_borrowed_positive"),
        sa.CheckConstraint("fees >= 0", name="ck_loans_fees_non_negative"),
        sa.CheckConstraint("interest_rate >= 0", name="ck_loans_interest_rate_non_negative"),
        sa.CheckConstraint("rate_period IN ('annual', 'monthly')", name="ck_loans_rate_period"),
        sa.CheckConstraint("installment_count >= 1", name="ck_loans_installment_count_positive"),
        sa.CheckConstraint("installment_amount > 0", name="ck_loans_installment_amount_positive"),
        sa.CheckConstraint(
            "NOT auto_post OR payment_account_id IS NOT NULL",
            name="ck_loans_auto_post_requires_account",
        ),
    )
    op.create_index("ix_loans_user_id", "loans", ["user_id"])

    op.add_column(
        "transactions",
        sa.Column("loan_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_transactions_loan_id",
        "transactions",
        "loans",
        ["loan_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_transactions_loan_id", "transactions", ["loan_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_transactions_loan_id", table_name="transactions")
    op.drop_constraint("fk_transactions_loan_id", "transactions", type_="foreignkey")
    op.drop_column("transactions", "loan_id")

    op.drop_index("ix_loans_user_id", table_name="loans")
    op.drop_table("loans")
