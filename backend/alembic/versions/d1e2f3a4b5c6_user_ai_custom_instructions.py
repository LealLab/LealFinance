"""add ai custom instructions to users

Revision ID: d1e2f3a4b5c6
Revises: b9c0d1e2f3a4
Create Date: 2026-09-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: str | Sequence[str] | None = "b9c0d1e2f3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Store the user's own instructions for the AI assistant."""
    op.add_column("users", sa.Column("ai_custom_instructions", sa.Text(), nullable=True))


def downgrade() -> None:
    """Drop the user's stored assistant instructions."""
    op.drop_column("users", "ai_custom_instructions")
