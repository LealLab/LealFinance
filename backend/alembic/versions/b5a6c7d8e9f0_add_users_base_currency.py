"""add users base currency

Revision ID: b5a6c7d8e9f0
Revises: 6f3d1c2e4a7b
Create Date: 2026-08-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5a6c7d8e9f0"
down_revision: str | Sequence[str] | None = "6f3d1c2e4a7b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the registration default without touching financial records."""
    op.add_column("users", sa.Column("base_currency", sa.String(length=3), nullable=True))
    op.execute(sa.text("UPDATE users SET base_currency = 'USD'"))
    op.alter_column("users", "base_currency", nullable=False)
    op.create_foreign_key(
        "fk_users_base_currency", "users", "currencies", ["base_currency"], ["code"]
    )


def downgrade() -> None:
    """Remove the persisted registration default."""
    op.drop_constraint("fk_users_base_currency", "users", type_="foreignkey")
    op.drop_column("users", "base_currency")
