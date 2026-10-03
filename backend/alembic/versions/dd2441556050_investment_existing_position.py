"""Add existing-position flag to investment transactions.

Revision ID: dd2441556050
Revises: 0f4a8c2e6b9d
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "dd2441556050"
down_revision: str | Sequence[str] | None = "0f4a8c2e6b9d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "investment_transactions",
        sa.Column(
            "existing_position", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.create_check_constraint(
        "ck_investment_transactions_existing_position_buy",
        "investment_transactions",
        "NOT existing_position OR type = 'buy'",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_investment_transactions_existing_position_buy",
        "investment_transactions",
        type_="check",
    )
    op.drop_column("investment_transactions", "existing_position")
