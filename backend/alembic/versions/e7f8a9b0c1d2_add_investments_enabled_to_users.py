"""add investments enabled to users

Revision ID: e7f8a9b0c1d2
Revises: c8e1b6f3a7d2
Create Date: 2026-08-26 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7f8a9b0c1d2"
down_revision: str | Sequence[str] | None = "c8e1b6f3a7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Enable the opt-in Investments preference for existing users."""
    op.add_column(
        "users",
        sa.Column("investments_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("users", "investments_enabled", server_default=None)


def downgrade() -> None:
    """Remove the persisted Investments preference."""
    op.drop_column("users", "investments_enabled")
