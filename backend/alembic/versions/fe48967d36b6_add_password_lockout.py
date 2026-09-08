"""add password lockout

Revision ID: fe48967d36b6
Revises: f3a4b5c6d7e8
Create Date: 2026-09-08 01:08:26.492445

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fe48967d36b6"
down_revision: str | Sequence[str] | None = "f3a4b5c6d7e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add password lockout state to users."""
    op.add_column(
        "users",
        sa.Column("password_failed_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("users", "password_failed_attempts", server_default=None)
    op.add_column(
        "users", sa.Column("password_locked_until", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    """Remove password lockout state from users."""
    op.drop_column("users", "password_locked_until")
    op.drop_column("users", "password_failed_attempts")
