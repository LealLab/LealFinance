"""recurring rule posting

Revision ID: a1c9f4d7e2b3
Revises: b5a6c7d8e9f0
Create Date: 2026-08-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c9f4d7e2b3"
down_revision: str | Sequence[str] | None = "b5a6c7d8e9f0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("recurring_rules", sa.Column("last_posted_date", sa.Date(), nullable=True))
    # Existing rules are backfilled to today: posting starts from each
    # rule's next occurrence forward, not from its original start_date -
    # otherwise a rule created a year ago would post a year of history the
    # first time the beat task runs.
    op.execute("UPDATE recurring_rules SET last_posted_date = CURRENT_DATE")

    # Idempotency guard: the same rule can never post two transactions on
    # the same occurrence date.
    op.create_index(
        "ux_transactions_recurring_rule_id_date",
        "transactions",
        ["recurring_rule_id", "date"],
        unique=True,
        postgresql_where=sa.text("recurring_rule_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ux_transactions_recurring_rule_id_date", table_name="transactions")
    op.drop_column("recurring_rules", "last_posted_date")
