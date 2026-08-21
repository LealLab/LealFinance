"""agent credential reasoning effort

Revision ID: c8e1b6f3a7d2
Revises: d4f7a1b2c9e6
Create Date: 2026-08-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8e1b6f3a7d2"
down_revision: str | Sequence[str] | None = "d4f7a1b2c9e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "agent_credentials", sa.Column("reasoning_effort", sa.String(length=16), nullable=True)
    )
    op.create_check_constraint(
        "ck_agent_credentials_reasoning_effort",
        "agent_credentials",
        "reasoning_effort IS NULL OR reasoning_effort IN ('low', 'medium', 'high', 'xhigh')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_agent_credentials_reasoning_effort", "agent_credentials", type_="check")
    op.drop_column("agent_credentials", "reasoning_effort")
