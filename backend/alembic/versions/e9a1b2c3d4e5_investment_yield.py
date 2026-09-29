"""Allow manual investment yield transactions.

Revision ID: e9a1b2c3d4e5
Revises: d6e8f0a2b4c6
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e9a1b2c3d4e5"
down_revision: str | Sequence[str] | None = "d6e8f0a2b4c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_investment_transactions_type", "investment_transactions", type_="check")
    op.create_check_constraint(
        "ck_investment_transactions_type",
        "investment_transactions",
        "type IN ('buy', 'sell', 'dividend', 'fee', 'yield')",
    )
    op.create_check_constraint(
        "ck_investment_transactions_yield_amount_fee",
        "investment_transactions",
        "type != 'yield' OR (quantity IS NULL AND price IS NULL AND amount > 0 AND fee = 0)",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_investment_transactions_yield_amount_fee", "investment_transactions", type_="check"
    )
    op.drop_constraint("ck_investment_transactions_type", "investment_transactions", type_="check")
    op.create_check_constraint(
        "ck_investment_transactions_type",
        "investment_transactions",
        "type IN ('buy', 'sell', 'dividend', 'fee')",
    )
