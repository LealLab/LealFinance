"""Tag a session so its writes are journaled, and undo a tagged group of writes.

Recording is done by the Postgres trigger in app/models/change_journal.py. This
module only (a) tells Postgres which tool call the current transaction belongs
to and (b) replays a call's journal rows backwards.

# ponytail: an undo only succeeds while nobody has touched the affected rows
# since the AI changed them (same trade as transaction_history.undo_batch).
# Lifting that needs row versioning, which is a much larger feature.
"""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any
from uuid import UUID

from sqlalchemy import delete, event, func, text, update
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, SessionTransaction

from app.core.errors import ConflictError, NotFoundError
from app.models.base import Base
from app.models.change_journal import ChangeJournal, journaled_tables
from app.services import ownership
from app.services.reconciliations import assert_not_reconciled

_TAG_KEY = "lealfinance.journal_tag"
_SET_TAG = text(
    "SELECT set_config('lealfinance.agent_call', :call, true), "
    "set_config('lealfinance.agent_conversation', :conv, true)"
)
_UNDO_TAG_PREFIX = "undo:"
_INVERSE_OPERATION = {"insert": "delete", "update": "update", "delete": "insert"}
# The nightly rates.backfill_fallback_conversions job rewrites conversion_* on
# existing transactions, and updated_at moves on every write; neither means a
# person edited the row, so neither may block an undo.
_IGNORED_COLUMNS = frozenset({"updated_at"})
_IGNORED_PREFIXES = ("conversion_",)


def _quote(name: str) -> str:
    """Quote a column name taken from the table metadata (never from a journal row)."""
    return '"' + name.replace('"', '""') + '"'


@event.listens_for(Session, "after_begin")
def _retag_new_transaction(
    session: Session, _transaction: SessionTransaction, connection: Connection
) -> None:
    """Re-apply the tag to every transaction the session opens.

    The write services `commit()` internally, which ends the transaction and
    drops its transaction-local setting. `session.info` outlives commits, so
    this restores the tag for whatever transaction begins next.
    """
    tag = session.info.get(_TAG_KEY)
    if tag is not None:
        connection.execute(_SET_TAG, {"call": tag[0], "conv": tag[1]})


async def _set_tag(db: AsyncSession, call_id: str, conversation_id: str) -> None:
    await db.execute(_SET_TAG, {"call": call_id, "conv": conversation_id})


@asynccontextmanager
async def journaling(
    db: AsyncSession, *, call_id: str, conversation_id: UUID | None = None
) -> AsyncIterator[None]:
    """Journal every journaled-table write made through `db` inside the block."""
    conversation = str(conversation_id) if conversation_id else ""
    info = db.sync_session.info
    info[_TAG_KEY] = (call_id, conversation)
    await _set_tag(db, call_id, conversation)
    try:
        yield
    finally:
        info.pop(_TAG_KEY, None)
        # A failed or rolled-back transaction has already discarded the setting
        # and refuses further statements; that is the only error swallowed here.
        with suppress(SQLAlchemyError):
            if db.in_transaction():
                await _set_tag(db, "", "")


async def list_recent(db: AsyncSession, user_id: UUID, *, limit: int = 10) -> list[dict[str, Any]]:
    groups = (
        await db.execute(
            ownership.owned(ChangeJournal, user_id)
            .with_only_columns(
                ChangeJournal.agent_call_id,
                func.max(ChangeJournal.created_at).label("at"),
                func.bool_and(ChangeJournal.undone_at.is_not(None)).label("undone"),
            )
            .group_by(ChangeJournal.agent_call_id)
            .order_by(func.max(ChangeJournal.seq).desc())
            .limit(limit)
        )
    ).all()
    if not groups:
        return []
    counts = (
        await db.execute(
            ownership.owned(ChangeJournal, user_id)
            .with_only_columns(
                ChangeJournal.agent_call_id,
                ChangeJournal.table_name,
                ChangeJournal.operation,
                func.count().label("n"),
            )
            .where(ChangeJournal.agent_call_id.in_([group.agent_call_id for group in groups]))
            .group_by(
                ChangeJournal.agent_call_id, ChangeJournal.table_name, ChangeJournal.operation
            )
            .order_by(ChangeJournal.table_name, ChangeJournal.operation)
        )
    ).all()
    changes: dict[str, list[dict[str, Any]]] = {}
    for row in counts:
        changes.setdefault(row.agent_call_id, []).append(
            {"table": row.table_name, "operation": row.operation, "count": row.n}
        )
    return [
        {
            "call_id": group.agent_call_id,
            "at": group.at.isoformat(),
            "undone": group.undone,
            "changes": changes.get(group.agent_call_id, []),
        }
        for group in groups
    ]


def _matches(current: dict[str, Any], expected: dict[str, Any]) -> bool:
    return all(
        current.get(column) == value
        for column, value in expected.items()
        if column not in _IGNORED_COLUMNS and not column.startswith(_IGNORED_PREFIXES)
    )


def _modified(row: ChangeJournal) -> ConflictError:
    return ConflictError(
        code="agents.change_modified",
        params={"table": row.table_name, "id": str(row.row_id)},
    )


async def _revert(db: AsyncSession, user_id: UUID, row: ChangeJournal) -> None:
    """Apply the inverse of one journaled write, refusing if the row moved on.

    `table` is interpolated into SQL only after it is confirmed to be one of the
    journaled tables; every value is bound.
    """
    table = row.table_name
    if table not in journaled_tables():
        raise _modified(row)
    current: dict[str, Any] | None = await db.scalar(
        text(f"SELECT to_jsonb(t) FROM {table} AS t WHERE t.id = :id AND t.user_id = :uid"),
        {"id": row.row_id, "uid": user_id},
    )
    if row.operation == "delete":
        if current is not None or not row.before or str(row.before.get("user_id")) != str(user_id):
            raise _modified(row)
        await db.execute(
            text(
                f"INSERT INTO {table} SELECT r.* "
                f"FROM jsonb_populate_record(NULL::{table}, CAST(:data AS jsonb)) AS r"
            ),
            {"data": json.dumps(row.before)},
        )
        return

    if current is None or not row.after or not _matches(current, row.after):
        raise _modified(row)
    if row.operation == "insert":
        await db.execute(
            text(f"DELETE FROM {table} WHERE id = :id AND user_id = :uid"),
            {"id": row.row_id, "uid": user_id},
        )
        return

    before = row.before or {}
    if table == "transactions" and any(
        before.get(column) != current.get(column)
        for column in before
        if column in {"amount", "date", "account_id", "to_account_id", "type", "currency"}
        or column.startswith("conversion_")
    ):
        try:
            await assert_not_reconciled(db, user_id, (row.row_id,))
        except ConflictError as exc:
            raise _modified(row) from exc
    columns = [
        column.name
        for column in Base.metadata.tables[table].c
        if column.name in before and column.name not in ("id", "user_id")
    ]
    assignments = ", ".join(f"{_quote(name)} = r.{_quote(name)}" for name in columns)
    await db.execute(
        text(
            f"UPDATE {table} AS x SET {assignments} "
            f"FROM jsonb_populate_record(NULL::{table}, CAST(:data AS jsonb)) AS r "
            "WHERE x.id = :id AND x.user_id = :uid"
        ),
        {"data": json.dumps(before), "id": row.row_id, "uid": user_id},
    )


async def _replay(
    db: AsyncSession, user_id: UUID, rows: list[ChangeJournal], undo_tag: str
) -> None:
    # FK cascades can journal a parent before its children. Retry blocked
    # inverses after their dependencies, keeping each row's own history ordered.
    # ponytail: repeated passes are quadratic in dependency depth; topologically
    # order the replay if large, deeply nested cascades become common.
    pending = rows
    while pending:
        deferred: list[ChangeJournal] = []
        blocked: set[tuple[str, UUID]] = set()
        for row in pending:
            key = (row.table_name, row.row_id)
            if key in blocked:
                deferred.append(row)
                continue
            try:
                async with db.begin_nested():
                    # after_begin also runs for savepoints and may reapply the
                    # enclosing chat/MCP call tag; these writes are undo probes.
                    await _set_tag(db, undo_tag, "")
                    await _revert(db, user_id, row)
            except IntegrityError as exc:
                if getattr(exc.orig, "sqlstate", None) != "23503":
                    raise
                deferred.append(row)
                blocked.add(key)
        if len(deferred) == len(pending):
            raise _modified(deferred[0])
        pending = deferred


async def undo(db: AsyncSession, user_id: UUID, call_id: str) -> int:
    """Reverse every journaled write of one tool call, all-or-nothing.

    Returns the number of writes reversed; an already-undone call returns 0.
    Raises `agents.change_modified` when a row changed since the AI wrote it, or
    when reversing would touch anything the call itself did not write.
    """
    rows = list(
        (
            await db.execute(
                ownership.owned(ChangeJournal, user_id)
                .where(ChangeJournal.agent_call_id == call_id, ChangeJournal.undone_at.is_(None))
                .order_by(ChangeJournal.seq.desc())
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        known = await db.scalar(
            ownership.owned(ChangeJournal, user_id)
            .with_only_columns(ChangeJournal.id)
            .where(ChangeJournal.agent_call_id == call_id)
            .limit(1)
        )
        if known is None:
            raise NotFoundError(code="agents.change_not_found", params={"call_id": call_id})
        return 0

    # The undo runs under its own tag so that anything Postgres does on its own
    # while reversing (FK cascades, SET NULL) is recorded and can be inspected.
    undo_tag = f"{_UNDO_TAG_PREFIX}{call_id}"
    expected = {(row.table_name, row.row_id, _INVERSE_OPERATION[row.operation]) for row in rows}
    try:
        async with db.begin_nested():
            await _set_tag(db, undo_tag, "")
            await _replay(db, user_id, rows, undo_tag)
            side_effects = (
                await db.execute(
                    ownership.owned(ChangeJournal, user_id)
                    .with_only_columns(
                        ChangeJournal.table_name, ChangeJournal.row_id, ChangeJournal.operation
                    )
                    .where(ChangeJournal.agent_call_id == undo_tag)
                )
            ).all()
            for effect in side_effects:
                if (effect.table_name, effect.row_id, effect.operation) not in expected:
                    raise ConflictError(
                        code="agents.change_modified",
                        params={"table": effect.table_name, "id": str(effect.row_id)},
                    )
            # The undo's own rows were only a probe; keep the journal to AI calls.
            await db.execute(
                delete(ChangeJournal).where(
                    ChangeJournal.user_id == user_id, ChangeJournal.agent_call_id == undo_tag
                )
            )
            await db.execute(
                update(ChangeJournal)
                .where(ChangeJournal.id.in_([row.id for row in rows]))
                .values(undone_at=func.now())
            )
    except IntegrityError as exc:
        # A row that still references what we tried to remove, or a parent that
        # is gone: the data moved on since the AI wrote it.
        raise ConflictError(code="agents.change_modified", params={}) from exc
    await db.commit()
    return len(rows)
