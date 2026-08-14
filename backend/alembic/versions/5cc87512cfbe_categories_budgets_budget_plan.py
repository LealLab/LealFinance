"""categories budgets budget plan

Revision ID: 5cc87512cfbe
Revises: ac6308f19c7e
Create Date: 2026-08-14 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5cc87512cfbe"
down_revision: str | Sequence[str] | None = "ac6308f19c7e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MONTH_CHECK = r"month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("color", sa.String(length=9), nullable=False),
        sa.Column("icon", sa.String(length=50), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_categories_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["categories.id"],
            name="fk_categories_parent_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("kind IN ('income', 'expense')", name="ck_categories_kind"),
    )
    op.create_index("ix_categories_user_id", "categories", ["user_id"])

    op.create_table(
        "budgets",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("amount", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_budgets_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_budgets_category_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["currency"], ["currencies.code"], name="fk_budgets_currency", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "category_id", "month", name="uq_budgets_user_category_month"
        ),
        sa.CheckConstraint(_MONTH_CHECK, name="ck_budgets_month_format"),
        sa.CheckConstraint("amount >= 0", name="ck_budgets_amount_non_negative"),
    )
    op.create_index("ix_budgets_user_id", "budgets", ["user_id"])

    op.create_table(
        "budget_allocations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("percentage", sa.Numeric(precision=7, scale=4), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_budget_allocations_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_budget_allocations_category_id",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "category_id", name="uq_budget_allocations_user_category"),
        sa.CheckConstraint(
            "percentage >= 0 AND percentage <= 100", name="ck_budget_allocations_percentage_range"
        ),
    )
    op.create_index("ix_budget_allocations_user_id", "budget_allocations", ["user_id"])

    op.create_table(
        "expected_income",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("amount", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_expected_income_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["currency"],
            ["currencies.code"],
            name="fk_expected_income_currency",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "month", name="uq_expected_income_user_month"),
        sa.CheckConstraint(_MONTH_CHECK, name="ck_expected_income_month_format"),
        sa.CheckConstraint("amount >= 0", name="ck_expected_income_amount_non_negative"),
    )
    op.create_index("ix_expected_income_user_id", "expected_income", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_expected_income_user_id", table_name="expected_income")
    op.drop_table("expected_income")
    op.drop_index("ix_budget_allocations_user_id", table_name="budget_allocations")
    op.drop_table("budget_allocations")
    op.drop_index("ix_budgets_user_id", table_name="budgets")
    op.drop_table("budgets")
    op.drop_index("ix_categories_user_id", table_name="categories")
    op.drop_table("categories")
