"""Row-level journal of changes made by AI tool calls, used to undo them.

Rows are written by a Postgres trigger, not by application code: several write
paths (raw bulk DML in `cascade_delete_accounts` / `delete_category_structure`,
and FK `ON DELETE CASCADE`) never pass through the ORM, so only the database
sees every one of them. The trigger is inert unless the transaction carries a
`lealfinance.agent_call` setting (see app/services/change_journal.py), so
ordinary writes cost one settings lookup and journal nothing.

The trigger DDL lives here because tests build the schema with
`Base.metadata.create_all`, which never runs Alembic. The migration carries its
own frozen copy; tests/test_change_journal.py fails if the two drift apart.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    event,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UserOwnedModel

JOURNAL_OPERATIONS = ("insert", "update", "delete")

# Tables that hold secrets or are themselves bookkeeping: journaling them would
# copy encrypted credentials into `before`/`after`, or recurse.
UNJOURNALED_TABLES = frozenset(
    {
        "agent_conversations",
        "agent_credentials",
        "agent_memories",
        "agent_messages",
        "change_journal",
        "import_idempotency",
        "market_data_credentials",
        "transaction_history",
    }
)

TRIGGER_NAME = "lf_journal"
FUNCTION_NAME = "lf_journal_change"

JOURNAL_FUNCTION_SQL = f"""
CREATE OR REPLACE FUNCTION {FUNCTION_NAME}() RETURNS trigger AS $$
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


class ChangeJournal(UserOwnedModel):
    __tablename__ = "change_journal"
    __error_prefix__ = "change_journal"
    __table_args__ = (
        CheckConstraint(
            "operation IN ('insert', 'update', 'delete')",
            name="ck_change_journal_operation",
        ),
        Index("ix_change_journal_user_id_agent_call_id", "user_id", "agent_call_id"),
        Index("ix_change_journal_user_id_seq", "user_id", "seq"),
    )

    # Replay order. `created_at` cannot serve: now() is constant inside a
    # transaction, so every row of one tool call would tie.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True), nullable=False)
    agent_call_id: Mapped[str] = mapped_column(String(128), nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "agent_conversations.id",
            ondelete="SET NULL",
            name="fk_change_journal_conversation_id",
        ),
    )
    table_name: Mapped[str] = mapped_column(String(64), nullable=False)
    row_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    operation: Mapped[str] = mapped_column(String(6), nullable=False)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def journaled_tables() -> frozenset[str]:
    """Every user-owned domain table whose changes the journal records.

    Derived from the mapped models so a new user-owned table is journaled by
    default and must be opted *out* by name in `UNJOURNALED_TABLES`.
    """
    return (
        frozenset(
            mapper.class_.__tablename__
            for mapper in Base.registry.mappers
            if issubclass(mapper.class_, UserOwnedModel)
        )
        - UNJOURNALED_TABLES
    )


def trigger_sql(table: str) -> str:
    return (
        f"CREATE TRIGGER {TRIGGER_NAME} AFTER INSERT OR UPDATE OR DELETE ON {table} "
        f"FOR EACH ROW EXECUTE FUNCTION {FUNCTION_NAME}()"
    )


@event.listens_for(Base.metadata, "after_create")
def _install_triggers(_target: object, connection: Connection, **_kw: object) -> None:
    connection.execute(text(JOURNAL_FUNCTION_SQL))
    for table in sorted(journaled_tables()):
        connection.execute(text(f"DROP TRIGGER IF EXISTS {TRIGGER_NAME} ON {table}"))
        connection.execute(text(trigger_sql(table)))


@event.listens_for(Base.metadata, "after_drop")
def _drop_function(_target: object, connection: Connection, **_kw: object) -> None:
    connection.execute(text(f"DROP FUNCTION IF EXISTS {FUNCTION_NAME}()"))
