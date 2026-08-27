"""replace nested categories with category groups

Revision ID: b2c3d4e5f6a1
Revises: a7b8c9d0e1f2
Create Date: 2026-08-26 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a1"
down_revision: str | Sequence[str] | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Replace nested categories and category-owned budgets with groups."""
    # The deployed compose image is postgres:18.4-alpine, where
    # gen_random_uuid() is provided by PostgreSQL core; pgcrypto is not needed.
    op.create_table(
        "category_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("color", sa.String(length=9), nullable=False),
        sa.Column("icon", sa.String(length=50), nullable=False),
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
            ["user_id"], ["users.id"], name="fk_category_groups_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("kind IN ('income', 'expense')", name="ck_category_groups_kind"),
    )
    op.create_index("ix_category_groups_user_id", "category_groups", ["user_id"])

    # Keep the temporary mapping on categories: every top-level category is
    # also the source row for exactly one new group.
    op.add_column(
        "categories", sa.Column("temp_group_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.execute(
        sa.text(
            """
            UPDATE categories
            SET temp_group_id = gen_random_uuid()
            WHERE parent_id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO category_groups
                (id, user_id, name, kind, color, icon, position, created_at, updated_at)
            SELECT temp_group_id, user_id, name, kind, color, icon, position, created_at, updated_at
            FROM categories
            WHERE parent_id IS NULL
            """
        )
    )

    op.add_column("categories", sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE categories
            SET group_id = temp_group_id
            WHERE parent_id IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE categories AS child
            SET group_id = parent.temp_group_id
            FROM categories AS parent
            WHERE child.parent_id = parent.id
            """
        )
    )
    op.alter_column("categories", "group_id", nullable=False)
    op.create_foreign_key(
        "fk_categories_group_id",
        "categories",
        "category_groups",
        ["group_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_categories_group_id", "categories", ["group_id"])
    op.drop_column("categories", "temp_group_id")

    # Roll child budgets and allocations up to their group. Keep the parent
    # row when it has one; otherwise keep the oldest row, with id as a stable
    # tie-breaker for identical timestamps.
    op.add_column("budgets", sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE budgets AS budget
            SET group_id = category.group_id
            FROM categories AS category
            WHERE budget.category_id = category.id
            """
        )
    )
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT budget.id,
                       ROW_NUMBER() OVER (
                           PARTITION BY budget.user_id, budget.group_id, budget.month
                           ORDER BY (budget.category_id = top_category.id) DESC,
                                    budget.created_at,
                                    budget.id
                       ) AS row_number
                FROM budgets AS budget
                JOIN categories AS top_category
                  ON top_category.group_id = budget.group_id
                 AND top_category.parent_id IS NULL
            )
            DELETE FROM budgets AS budget
            USING ranked
            WHERE budget.id = ranked.id
              AND ranked.row_number > 1
            """
        )
    )
    op.drop_constraint("uq_budgets_user_category_month", "budgets", type_="unique")
    op.drop_constraint("fk_budgets_category_id", "budgets", type_="foreignkey")
    op.drop_column("budgets", "category_id")
    op.alter_column("budgets", "group_id", nullable=False)
    op.create_foreign_key(
        "fk_budgets_group_id",
        "budgets",
        "category_groups",
        ["group_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_budgets_user_group_month", "budgets", ["user_id", "group_id", "month"]
    )

    op.add_column(
        "budget_allocations", sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.execute(
        sa.text(
            """
            UPDATE budget_allocations AS allocation
            SET group_id = category.group_id
            FROM categories AS category
            WHERE allocation.category_id = category.id
            """
        )
    )
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT allocation.id,
                       ROW_NUMBER() OVER (
                           PARTITION BY allocation.user_id, allocation.group_id
                           ORDER BY (allocation.category_id = top_category.id) DESC,
                                    allocation.created_at,
                                    allocation.id
                       ) AS row_number
                FROM budget_allocations AS allocation
                JOIN categories AS top_category
                  ON top_category.group_id = allocation.group_id
                 AND top_category.parent_id IS NULL
            )
            DELETE FROM budget_allocations AS allocation
            USING ranked
            WHERE allocation.id = ranked.id
              AND ranked.row_number > 1
            """
        )
    )
    op.drop_constraint("uq_budget_allocations_user_category", "budget_allocations", type_="unique")
    op.drop_constraint(
        "fk_budget_allocations_category_id", "budget_allocations", type_="foreignkey"
    )
    op.drop_column("budget_allocations", "category_id")
    op.alter_column("budget_allocations", "group_id", nullable=False)
    op.create_foreign_key(
        "fk_budget_allocations_group_id",
        "budget_allocations",
        "category_groups",
        ["group_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_budget_allocations_user_group", "budget_allocations", ["user_id", "group_id"]
    )

    # Budget FKs now point at groups, so old top-level categories can be
    # removed without losing budgets. Drop the obsolete self-FK first; child
    # parent_id values are temporarily dangling and the column is removed
    # immediately after this delete.
    op.drop_constraint("fk_categories_parent_id", "categories", type_="foreignkey")
    op.execute(
        sa.text(
            """
            DELETE FROM categories AS top_category
            WHERE top_category.parent_id IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM transactions
                  WHERE transactions.category_id = top_category.id
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM recurring_rules
                  WHERE recurring_rules.template_category_id = top_category.id
              )
            """
        )
    )

    op.drop_column("categories", "parent_id")
    op.drop_column("categories", "archived")


def downgrade() -> None:
    """Restore nested categories, category budgets, and allocation constraints."""
    op.add_column(
        "categories", sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "categories",
        sa.Column("archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )

    # Reuse a surviving category whose name matches the group. Otherwise add
    # the missing top-level category; group_id is retained until all dependent
    # budget rows have been pointed at these representatives.
    op.execute(
        sa.text(
            """
            INSERT INTO categories
                (id, user_id, name, kind, group_id, color, icon, archived, position,
                 created_at, updated_at)
            SELECT gen_random_uuid(), group_row.user_id, group_row.name, group_row.kind,
                   group_row.id, group_row.color, group_row.icon, false, group_row.position,
                   group_row.created_at, group_row.updated_at
            FROM category_groups AS group_row
            WHERE NOT EXISTS (
                SELECT 1
                FROM categories AS category
                WHERE category.group_id = group_row.id
                  AND category.name = group_row.name
            )
            """
        )
    )
    op.execute(
        sa.text(
            """
            WITH representatives AS (
                SELECT DISTINCT ON (category.group_id)
                       category.group_id,
                       category.id
                FROM categories AS category
                JOIN category_groups AS group_row ON group_row.id = category.group_id
                WHERE category.name = group_row.name
                ORDER BY category.group_id,
                         (category.created_at = group_row.created_at) DESC,
                         category.created_at,
                         category.id
            )
            UPDATE categories AS category
            SET parent_id = representatives.id
            FROM representatives
            WHERE category.group_id = representatives.group_id
              AND category.id <> representatives.id
            """
        )
    )

    op.add_column("budgets", sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute(
        sa.text(
            """
            WITH representatives AS (
                SELECT DISTINCT ON (category.group_id)
                       category.group_id,
                       category.id
                FROM categories AS category
                WHERE category.parent_id IS NULL
                ORDER BY category.group_id, category.created_at, category.id
            )
            UPDATE budgets AS budget
            SET category_id = representatives.id
            FROM representatives
            WHERE budget.group_id = representatives.group_id
            """
        )
    )
    op.drop_constraint("uq_budgets_user_group_month", "budgets", type_="unique")
    op.drop_constraint("fk_budgets_group_id", "budgets", type_="foreignkey")
    op.drop_column("budgets", "group_id")
    op.alter_column("budgets", "category_id", nullable=False)
    op.create_foreign_key(
        "fk_budgets_category_id",
        "budgets",
        "categories",
        ["category_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_budgets_user_category_month", "budgets", ["user_id", "category_id", "month"]
    )

    op.add_column(
        "budget_allocations", sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.execute(
        sa.text(
            """
            WITH representatives AS (
                SELECT DISTINCT ON (category.group_id)
                       category.group_id,
                       category.id
                FROM categories AS category
                WHERE category.parent_id IS NULL
                ORDER BY category.group_id, category.created_at, category.id
            )
            UPDATE budget_allocations AS allocation
            SET category_id = representatives.id
            FROM representatives
            WHERE allocation.group_id = representatives.group_id
            """
        )
    )
    op.drop_constraint("uq_budget_allocations_user_group", "budget_allocations", type_="unique")
    op.drop_constraint("fk_budget_allocations_group_id", "budget_allocations", type_="foreignkey")
    op.drop_column("budget_allocations", "group_id")
    op.alter_column("budget_allocations", "category_id", nullable=False)
    op.create_foreign_key(
        "fk_budget_allocations_category_id",
        "budget_allocations",
        "categories",
        ["category_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_budget_allocations_user_category", "budget_allocations", ["user_id", "category_id"]
    )

    op.drop_constraint("fk_categories_group_id", "categories", type_="foreignkey")
    op.drop_index("ix_categories_group_id", table_name="categories")
    op.drop_column("categories", "group_id")
    op.create_foreign_key(
        "fk_categories_parent_id",
        "categories",
        "categories",
        ["parent_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.alter_column("categories", "archived", server_default=None)
    op.drop_index("ix_category_groups_user_id", table_name="category_groups")
    op.drop_table("category_groups")
