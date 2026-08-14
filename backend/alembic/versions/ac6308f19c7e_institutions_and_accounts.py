"""institutions and accounts

Revision ID: ac6308f19c7e
Revises: 47379d62fa35
Create Date: 2026-08-14 15:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ac6308f19c7e"
down_revision: str | Sequence[str] | None = "47379d62fa35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "institutions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("icon", sa.String(length=50), nullable=False),
        sa.Column("color", sa.String(length=9), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_institutions_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_institutions_user_id", "institutions", ["user_id"])

    op.create_table(
        "accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("opening_balance", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("institution_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("credit_limit", sa.Numeric(precision=19, scale=4), nullable=True),
        sa.Column("closing_day", sa.SmallInteger(), nullable=True),
        sa.Column("due_day", sa.SmallInteger(), nullable=True),
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
            ["user_id"], ["users.id"], name="fk_accounts_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["currency"], ["currencies.code"], name="fk_accounts_currency", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["institution_id"],
            ["institutions.id"],
            name="fk_accounts_institution_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "type IN ('checking', 'savings', 'cash', 'credit_card', 'investment', 'goal')",
            name="ck_accounts_type",
        ),
        sa.CheckConstraint(
            "closing_day IS NULL OR closing_day BETWEEN 1 AND 31",
            name="ck_accounts_closing_day_range",
        ),
        sa.CheckConstraint(
            "due_day IS NULL OR due_day BETWEEN 1 AND 31", name="ck_accounts_due_day_range"
        ),
        sa.CheckConstraint(
            "credit_limit IS NULL OR credit_limit >= 0",
            name="ck_accounts_credit_limit_non_negative",
        ),
        sa.CheckConstraint(
            "type = 'credit_card' OR "
            "(credit_limit IS NULL AND closing_day IS NULL AND due_day IS NULL)",
            name="ck_accounts_credit_card_fields_only",
        ),
    )
    op.create_index("ix_accounts_user_id", "accounts", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_accounts_user_id", table_name="accounts")
    op.drop_table("accounts")
    op.drop_index("ix_institutions_user_id", table_name="institutions")
    op.drop_table("institutions")
