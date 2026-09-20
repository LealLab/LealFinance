"""add change journal

Revision ID: e1f2a3b4c5d6
Revises: d9e0f1a2b3c4
Create Date: 2026-09-20

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: str | Sequence[str] | None = "d9e0f1a2b3c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen on purpose: a later migration that journals a new table adds its own
# trigger. Importing the live list from app code would make this migration fail
# on a fresh database the day that table appears.
JOURNALED_TABLES = (
    "accounts",
    "budget_allocations",
    "budgets",
    "categories",
    "categorization_rules",
    "category_groups",
    "expected_income",
    "goals",
    "institutions",
    "investment_assets",
    "investment_transactions",
    "investment_wallets",
    "loans",
    "manual_rates",
    "reconciliation_entries",
    "reconciliations",
    "recurring_rules",
    "transactions",
)

JOURNAL_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION lf_journal_change() RETURNS trigger AS $$
DECLARE
    call_id text := current_setting('lealfinance.agent_call', true);
    conv text := current_setting('lealfinance.agent_conversation', true);
    old_row jsonb;
    new_row jsonb;
    snap jsonb;
BEGIN
    IF call_id IS NULL OR call_id = '' THEN
        RETURN NULL;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        old_row := to_jsonb(OLD);
    END IF;
    IF TG_OP <> 'DELETE' THEN
        new_row := to_jsonb(NEW);
    END IF;
    snap := coalesce(new_row, old_row);
    INSERT INTO change_journal (
        id, user_id, agent_call_id, conversation_id, table_name, row_id,
        operation, before, after
    ) VALUES (
        gen_random_uuid(), (snap->>'user_id')::uuid, call_id,
        nullif(conv, '')::uuid, TG_TABLE_NAME, (snap->>'id')::uuid,
        lower(TG_OP), old_row, new_row
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql
"""


def upgrade() -> None:
    """Create the AI change journal, its recording function, and the triggers."""
    op.create_table(
        "change_journal",
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
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("agent_call_id", sa.String(length=128), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("table_name", sa.String(length=64), nullable=False),
        sa.Column("row_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("operation", sa.String(length=6), nullable=False),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "operation IN ('insert', 'update', 'delete')",
            name="ck_change_journal_operation",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_change_journal_user_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["agent_conversations.id"],
            name="fk_change_journal_conversation_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_change_journal_user_id", "change_journal", ["user_id"], unique=False)
    op.create_index(
        "ix_change_journal_user_id_agent_call_id",
        "change_journal",
        ["user_id", "agent_call_id"],
        unique=False,
    )
    op.create_index(
        "ix_change_journal_user_id_seq", "change_journal", ["user_id", "seq"], unique=False
    )

    op.execute(sa.text(JOURNAL_FUNCTION_SQL))
    for table in JOURNALED_TABLES:
        op.execute(
            f"CREATE TRIGGER lf_journal AFTER INSERT OR UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION lf_journal_change()"
        )


def downgrade() -> None:
    """Drop the triggers, the recording function, and the change journal."""
    for table in reversed(JOURNALED_TABLES):
        op.execute(f"DROP TRIGGER IF EXISTS lf_journal ON {table}")
    op.execute("DROP FUNCTION IF EXISTS lf_journal_change()")
    op.drop_index("ix_change_journal_user_id_seq", table_name="change_journal")
    op.drop_index("ix_change_journal_user_id_agent_call_id", table_name="change_journal")
    op.drop_index("ix_change_journal_user_id", table_name="change_journal")
    op.drop_table("change_journal")
