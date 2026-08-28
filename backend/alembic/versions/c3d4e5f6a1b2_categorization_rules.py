"""add categorization rules

Revision ID: c3d4e5f6a1b2
Revises: b2c3d4e5f6a1
Create Date: 2026-08-28 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a1b2"
down_revision: str | Sequence[str] | None = "b2c3d4e5f6a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create user-owned categorization rules."""
    op.create_table(
        "categorization_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("match_op", sa.String(length=3), nullable=False),
        sa.Column("conditions", postgresql.JSONB(), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_categorization_rules_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_categorization_rules_category_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_categorization_rules"),
        sa.UniqueConstraint("user_id", "name", name="uq_categorization_rules_user_id_name"),
        sa.CheckConstraint("match_op IN ('and', 'or')", name="ck_categorization_rules_match_op"),
    )
    op.create_index("ix_categorization_rules_user_id", "categorization_rules", ["user_id"])
    op.create_index("ix_categorization_rules_category_id", "categorization_rules", ["category_id"])


def downgrade() -> None:
    """Drop categorization rules."""
    op.drop_index("ix_categorization_rules_category_id", table_name="categorization_rules")
    op.drop_index("ix_categorization_rules_user_id", table_name="categorization_rules")
    op.drop_table("categorization_rules")
