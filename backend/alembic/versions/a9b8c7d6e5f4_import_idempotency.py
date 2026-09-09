"""import idempotency

Revision ID: a9b8c7d6e5f4
Revises: f76376f1e3bf
Create Date: 2026-09-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9b8c7d6e5f4"
down_revision: str | Sequence[str] | None = "f76376f1e3bf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the persisted transaction-import idempotency table."""
    op.create_table(
        "import_idempotency",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("created_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_import_idempotency_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "key", name="uq_import_idempotency_user_key"),
    )
    op.create_index(
        "ix_import_idempotency_user_id", "import_idempotency", ["user_id"], unique=False
    )


def downgrade() -> None:
    """Drop the persisted transaction-import idempotency table."""
    op.drop_index("ix_import_idempotency_user_id", table_name="import_idempotency")
    op.drop_table("import_idempotency")
