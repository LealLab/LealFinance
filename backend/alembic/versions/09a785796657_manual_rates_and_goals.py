"""manual rates and goals

Revision ID: 09a785796657
Revises: 5b2fe9f7f27f
Create Date: 2026-08-14 16:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "09a785796657"
down_revision: str | Sequence[str] | None = "5b2fe9f7f27f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "manual_rates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("base_code", sa.String(length=3), nullable=False),
        sa.Column("quote_code", sa.String(length=3), nullable=False),
        sa.Column("rate", sa.Numeric(precision=19, scale=10), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_manual_rates_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["base_code"],
            ["currencies.code"],
            name="fk_manual_rates_base_code",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["quote_code"],
            ["currencies.code"],
            name="fk_manual_rates_quote_code",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "base_code", "quote_code", "as_of", name="uq_manual_rates_user_pair_as_of"
        ),
        sa.CheckConstraint("rate > 0", name="ck_manual_rates_rate_positive"),
        sa.CheckConstraint("base_code <> quote_code", name="ck_manual_rates_distinct_codes"),
    )
    op.create_index("ix_manual_rates_user_id", "manual_rates", ["user_id"])

    op.create_table(
        "goals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("target_amount", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("frequency", sa.String(length=20), nullable=True),
        sa.Column("interval", sa.Integer(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_goals_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"], name="fk_goals_account_id", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["currency"], ["currencies.code"], name="fk_goals_currency", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", name="uq_goals_account_id"),
        sa.CheckConstraint("target_amount > 0", name="ck_goals_target_amount_positive"),
        sa.CheckConstraint(
            "frequency IN ('weekly', 'monthly', 'yearly') OR frequency IS NULL",
            name="ck_goals_frequency",
        ),
        sa.CheckConstraint(
            '"interval" IS NULL OR "interval" >= 1', name="ck_goals_interval_positive"
        ),
        sa.CheckConstraint(
            'frequency IS NOT NULL OR "interval" IS NULL',
            name="ck_goals_interval_requires_frequency",
        ),
    )
    op.create_index("ix_goals_user_id", "goals", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_goals_user_id", table_name="goals")
    op.drop_table("goals")
    op.drop_index("ix_manual_rates_user_id", table_name="manual_rates")
    op.drop_table("manual_rates")
