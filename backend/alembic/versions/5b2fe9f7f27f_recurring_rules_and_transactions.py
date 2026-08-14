"""recurring rules and transactions

Revision ID: 5b2fe9f7f27f
Revises: 5cc87512cfbe
Create Date: 2026-08-14 14:55:00.216969

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b2fe9f7f27f"
down_revision: str | Sequence[str] | None = "5cc87512cfbe"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _conversion_columns(prefix: str) -> list[sa.Column]:
    return [
        sa.Column(f"{prefix}amount", sa.Numeric(precision=19, scale=4), nullable=True),
        sa.Column(f"{prefix}currency", sa.String(length=3), nullable=True),
        sa.Column(f"{prefix}fee", sa.Numeric(precision=19, scale=4), nullable=True),
        sa.Column(f"{prefix}rate", sa.Numeric(precision=19, scale=10), nullable=True),
        sa.Column(f"{prefix}source", sa.String(length=20), nullable=True),
    ]


def _conversion_checks(table: str, prefix: str) -> list[sa.CheckConstraint]:
    a, c, f, r, s = (f"{prefix}{name}" for name in ("amount", "currency", "fee", "rate", "source"))
    return [
        sa.CheckConstraint(
            f"({a} IS NULL AND {c} IS NULL AND {r} IS NULL AND {s} IS NULL AND {f} IS NULL)"
            f" OR ({a} IS NOT NULL AND {c} IS NOT NULL AND {r} IS NOT NULL AND {s} IS NOT NULL)",
            name=f"ck_{table}_conversion_all_or_nothing",
        ),
        sa.CheckConstraint(
            f"{a} IS NULL OR {a} > 0", name=f"ck_{table}_conversion_amount_positive"
        ),
        sa.CheckConstraint(
            f"{f} IS NULL OR {f} >= 0", name=f"ck_{table}_conversion_fee_non_negative"
        ),
        sa.CheckConstraint(f"{r} IS NULL OR {r} > 0", name=f"ck_{table}_conversion_rate_positive"),
        sa.CheckConstraint(
            f"{s} IS NULL OR {s} IN ('manual', 'quote', 'fallback')",
            name=f"ck_{table}_conversion_source",
        ),
    ]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "recurring_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("frequency", sa.String(length=20), nullable=False),
        sa.Column("interval", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("template_type", sa.String(length=20), nullable=False),
        sa.Column("template_amount", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("template_currency", sa.String(length=3), nullable=False),
        sa.Column("template_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_to_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("template_category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("template_description", sa.String(length=200), nullable=False),
        sa.Column("template_notes", sa.Text(), nullable=True),
        *_conversion_columns("template_conversion_"),
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
            ["user_id"], ["users.id"], name="fk_recurring_rules_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["template_currency"],
            ["currencies.code"],
            name="fk_recurring_rules_template_currency",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["template_account_id"],
            ["accounts.id"],
            name="fk_recurring_rules_template_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["template_to_account_id"],
            ["accounts.id"],
            name="fk_recurring_rules_template_to_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["template_category_id"],
            ["categories.id"],
            name="fk_recurring_rules_template_category_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["template_conversion_currency"],
            ["currencies.code"],
            name="fk_recurring_rules_template_conversion_currency",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "frequency IN ('weekly', 'monthly', 'yearly')", name="ck_recurring_rules_frequency"
        ),
        sa.CheckConstraint('"interval" >= 1', name="ck_recurring_rules_interval_positive"),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= start_date", name="ck_recurring_rules_date_order"
        ),
        sa.CheckConstraint(
            "template_type IN ('income', 'expense', 'transfer', 'interest')",
            name="ck_recurring_rules_template_type",
        ),
        sa.CheckConstraint(
            "template_amount > 0", name="ck_recurring_rules_template_amount_positive"
        ),
        sa.CheckConstraint(
            "(template_type = 'transfer') = (template_to_account_id IS NOT NULL)",
            name="ck_recurring_rules_template_transfer_shape",
        ),
        sa.CheckConstraint(
            "template_to_account_id IS NULL OR template_to_account_id <> template_account_id",
            name="ck_recurring_rules_template_distinct_accounts",
        ),
        sa.CheckConstraint(
            "template_type NOT IN ('transfer', 'interest') OR template_category_id IS NULL",
            name="ck_recurring_rules_template_category_absent",
        ),
        *_conversion_checks("recurring_rules", "template_conversion_"),
    )
    op.create_index("ix_recurring_rules_user_id", "recurring_rules", ["user_id"])

    op.create_table(
        "transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=19, scale=4), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("to_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("description", sa.String(length=200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("recurring_rule_id", postgresql.UUID(as_uuid=True), nullable=True),
        *_conversion_columns("conversion_"),
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
            ["user_id"], ["users.id"], name="fk_transactions_user_id", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["currency"], ["currencies.code"], name="fk_transactions_currency", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_transactions_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["to_account_id"],
            ["accounts.id"],
            name="fk_transactions_to_account_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_transactions_category_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recurring_rule_id"],
            ["recurring_rules.id"],
            name="fk_transactions_recurring_rule_id",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["conversion_currency"],
            ["currencies.code"],
            name="fk_transactions_conversion_currency",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        sa.CheckConstraint(
            "type IN ('income', 'expense', 'transfer', 'interest')", name="ck_transactions_type"
        ),
        sa.CheckConstraint(
            "(type = 'transfer') = (to_account_id IS NOT NULL)",
            name="ck_transactions_transfer_shape",
        ),
        sa.CheckConstraint(
            "to_account_id IS NULL OR to_account_id <> account_id",
            name="ck_transactions_transfer_distinct_accounts",
        ),
        sa.CheckConstraint(
            "type NOT IN ('transfer', 'interest') OR category_id IS NULL",
            name="ck_transactions_category_absent_for_transfer_interest",
        ),
        *_conversion_checks("transactions", "conversion_"),
    )
    op.create_index("ix_transactions_user_id", "transactions", ["user_id"])
    op.create_index("ix_transactions_user_id_date", "transactions", ["user_id", "date"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_transactions_user_id_date", table_name="transactions")
    op.drop_index("ix_transactions_user_id", table_name="transactions")
    op.drop_table("transactions")
    op.drop_index("ix_recurring_rules_user_id", table_name="recurring_rules")
    op.drop_table("recurring_rules")
