"""The AI change journal: trigger recording, tagging, and undo."""

import importlib.util
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app import models  # noqa: F401 - populates Base.registry.mappers
from app.core.errors import ConflictError, NotFoundError
from app.models.account import Account
from app.models.change_journal import (
    JOURNAL_FUNCTION_SQL,
    ChangeJournal,
    journaled_tables,
)
from app.models.currency import Currency
from app.models.institution import Institution
from app.models.reconciliation import Reconciliation, ReconciliationEntry
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.account import AccountCreate, AccountUpdate
from app.schemas.institution import InstitutionCreate
from app.schemas.reconciliation import ReconciliationCreate
from app.schemas.transaction import TransactionCreate, TransactionUpdate
from app.services import accounts as accounts_service
from app.services import change_journal
from app.services import institutions as institutions_service
from app.services import reconciliations as reconciliations_service
from app.services import transactions as transactions_service
from tests.factories import make_user

_MIGRATION = (
    Path(__file__).parent.parent / "alembic" / "versions" / "e1f2a3b4c5d6_change_journal.py"
)


async def _account(db: AsyncSession, user: User, name: str = "Checking") -> Account:
    return await accounts_service.create_account(
        db,
        user.id,
        AccountCreate(name=name, type="checking", currency="BRL", opening_balance=Decimal("100")),
    )


async def _transfer(
    db: AsyncSession, user: User, source: Account, target: Account, amount: str = "10"
) -> Transaction:
    return await transactions_service.create_transaction(
        db,
        user.id,
        TransactionCreate(
            type="transfer",
            date=date(2026, 1, 1),
            amount=Decimal(amount),
            currency="BRL",
            account_id=source.id,
            to_account_id=target.id,
            description="Move money",
        ),
    )


async def _journal(db: AsyncSession, user: User, call_id: str) -> list[ChangeJournal]:
    result = await db.execute(
        select(ChangeJournal)
        .where(ChangeJournal.user_id == user.id, ChangeJournal.agent_call_id == call_id)
        .order_by(ChangeJournal.seq)
    )
    return list(result.scalars().all())


async def _exists(db: AsyncSession, model: type[Account] | type[Transaction], id_: UUID) -> bool:
    return await db.scalar(select(func.count()).select_from(model).where(model.id == id_)) == 1


async def test_untagged_writes_are_not_journaled(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    await _account(db_session, user)

    count = await db_session.scalar(select(func.count()).select_from(ChangeJournal))
    assert count == 0


async def test_tagged_writes_are_journaled_across_internal_commits(
    db_session: AsyncSession,
) -> None:
    user, _ = await make_user(db_session)

    # Both writes must be recorded under the one call id. (Under this fixture a
    # commit only releases a savepoint, so this does not exercise re-tagging after
    # a real commit; test_tag_is_reapplied_after_a_real_commit does.)
    async with change_journal.journaling(db_session, call_id="call-1"):
        institution = await institutions_service.create_institution(
            db_session, user.id, InstitutionCreate(name="Bank", icon="bank")
        )
        account = await _account(db_session, user)

    rows = await _journal(db_session, user, "call-1")
    assert [(row.table_name, row.operation, row.row_id) for row in rows] == [
        ("institutions", "insert", institution.id),
        ("accounts", "insert", account.id),
    ]
    assert rows[0].before is None
    assert rows[1].after is not None and rows[1].after["name"] == "Checking"

    # Leaving the block stops journaling.
    await _account(db_session, user, "Untracked")
    assert len(await _journal(db_session, user, "call-1")) == 2


async def test_tag_is_reapplied_after_a_real_commit(_engine: AsyncEngine) -> None:
    """The db_session fixture nests every test in one outer transaction, so a
    service's commit() never ends the transaction there and the tag would survive
    on its own. Only a session with real commits proves `after_begin` re-applies it,
    which is what production relies on."""
    async with AsyncSession(_engine, expire_on_commit=False) as db:
        # Users default to a USD base currency; accounts here use BRL.
        db.add_all(
            [
                Currency(code="BRL", name="Brazilian Real", symbol="R$", decimal_digits=2),
                Currency(code="USD", name="US Dollar", symbol="$", decimal_digits=2),
            ]
        )
        await db.commit()
        user, _ = await make_user(db, email="real-commit@example.com")
        try:
            async with change_journal.journaling(db, call_id="real-1"):
                first = await _account(db, user, "One")
                second = await _account(db, user, "Two")

            assert {row.row_id for row in await _journal(db, user, "real-1")} == {
                first.id,
                second.id,
            }
        finally:
            await db.rollback()
            # Real commits leave real rows; the user's FK cascade removes the
            # accounts and their journal rows.
            await db.execute(delete(User).where(User.email == "real-commit@example.com"))
            await db.execute(delete(Currency).where(Currency.code.in_(["BRL", "USD"])))
            await db.commit()


async def test_update_records_before_and_after(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    account = await _account(db_session, user)

    async with change_journal.journaling(db_session, call_id="call-1"):
        await accounts_service.update_account(
            db_session, user.id, account.id, AccountUpdate(name="Renamed")
        )

    (row,) = await _journal(db_session, user, "call-1")
    assert row.operation == "update"
    assert row.before is not None and row.before["name"] == "Checking"
    assert row.after is not None and row.after["name"] == "Renamed"


async def test_bulk_sql_cascade_delete_is_journaled(db_session: AsyncSession) -> None:
    """cascade_delete_accounts uses raw DELETEs an ORM listener would never see."""
    user, _ = await make_user(db_session)
    source = await _account(db_session, user, "Source")
    target = await _account(db_session, user, "Target")
    transaction = await _transfer(db_session, user, source, target)

    async with change_journal.journaling(db_session, call_id="call-1"):
        await accounts_service.delete_account(db_session, user.id, source.id)

    deleted = {(row.table_name, row.row_id) for row in await _journal(db_session, user, "call-1")}
    assert ("accounts", source.id) in deleted
    assert ("transactions", transaction.id) in deleted


async def test_undo_create_removes_rows_and_is_idempotent(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    async with change_journal.journaling(db_session, call_id="call-1"):
        account_id = (await _account(db_session, user)).id

    assert await change_journal.undo(db_session, user.id, "call-1") == 1

    assert not await _exists(db_session, Account, account_id)
    # The probe rows of the undo itself must not linger in the journal.
    assert {row.agent_call_id for row in await _all_journal(db_session)} == {"call-1"}
    assert await change_journal.undo(db_session, user.id, "call-1") == 0


async def _all_journal(db: AsyncSession) -> list[ChangeJournal]:
    return list((await db.execute(select(ChangeJournal))).scalars().all())


async def test_undo_update_restores_previous_values(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    account_id = (await _account(db_session, user)).id
    async with change_journal.journaling(db_session, call_id="call-1"):
        await accounts_service.update_account(
            db_session, user.id, account_id, AccountUpdate(name="Renamed")
        )

    await change_journal.undo(db_session, user.id, "call-1")

    restored = await db_session.scalar(select(Account.name).where(Account.id == account_id))
    assert restored == "Checking"


async def test_undo_cascade_delete_restores_parent_and_children(
    db_session: AsyncSession,
) -> None:
    user, _ = await make_user(db_session)
    source = await _account(db_session, user, "Source")
    target = await _account(db_session, user, "Target")
    source_id = source.id
    transaction_id = (await _transfer(db_session, user, source, target)).id
    async with change_journal.journaling(db_session, call_id="call-1"):
        await accounts_service.delete_account(db_session, user.id, source_id)
    assert not await _exists(db_session, Account, source_id)

    await change_journal.undo(db_session, user.id, "call-1")

    assert await _exists(db_session, Account, source_id)
    restored = await db_session.scalar(select(Transaction).where(Transaction.id == transaction_id))
    assert restored is not None
    assert restored.amount == Decimal("10")
    assert restored.account_id == source_id


async def test_undo_refuses_a_row_edited_after_the_ai_wrote_it(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    async with change_journal.journaling(db_session, call_id="call-1"):
        account = await _account(db_session, user)
    await accounts_service.update_account(
        db_session, user.id, account.id, AccountUpdate(name="Edited by hand")
    )

    with pytest.raises(ConflictError) as raised:
        await change_journal.undo(db_session, user.id, "call-1")

    assert raised.value.code == "agents.change_modified"
    assert await _exists(db_session, Account, account.id)
    (row,) = await _journal(db_session, user, "call-1")
    assert row.undone_at is None


@pytest.mark.parametrize("delete_account", [False, True])
async def test_undo_restores_cascaded_reconciliation_entries(
    db_session: AsyncSession, delete_account: bool
) -> None:
    user, _ = await make_user(db_session)
    source = await _account(db_session, user, "Source")
    target = await _account(db_session, user, "Target")
    transaction = await _transfer(db_session, user, source, target)
    reconciliation = await reconciliations_service.create(
        db_session,
        user.id,
        ReconciliationCreate(
            account_id=source.id, statement_date=date(2026, 1, 31), statement_balance=Decimal("90")
        ),
    )
    await reconciliations_service.set_entries(
        db_session, user.id, reconciliation.id, transaction_ids=[transaction.id], cleared=True
    )
    await reconciliations_service.complete(db_session, user.id, reconciliation.id)

    async with change_journal.journaling(db_session, call_id="delete"):
        if delete_account:
            await accounts_service.delete_account(db_session, user.id, source.id)
        else:
            await reconciliations_service.delete(db_session, user.id, reconciliation.id)

    # Exercise the same enclosing tag used by chat and MCP undo calls.
    async with change_journal.journaling(db_session, call_id="undo"):
        assert await change_journal.undo(db_session, user.id, "delete") >= 2

    assert (
        await db_session.scalar(
            select(Reconciliation.status).where(Reconciliation.id == reconciliation.id)
        )
        == "completed"
    )
    assert (
        await db_session.scalar(
            select(ReconciliationEntry.transaction_id).where(
                ReconciliationEntry.reconciliation_id == reconciliation.id
            )
        )
        == transaction.id
    )
    detail = await reconciliations_service.detail(db_session, user.id, reconciliation.id)
    assert detail.difference == 0
    assert {row.agent_call_id for row in await _all_journal(db_session)} == {"delete"}
    assert await change_journal.undo(db_session, user.id, "delete") == 0


@pytest.mark.parametrize("completed", [False, True])
@pytest.mark.parametrize("financial_edit", [False, True])
async def test_undo_respects_reconciled_transaction_fields(
    db_session: AsyncSession, completed: bool, financial_edit: bool
) -> None:
    user, _ = await make_user(db_session)
    source = await _account(db_session, user, "Source")
    target = await _account(db_session, user, "Target")
    transaction = await _transfer(db_session, user, source, target)
    async with change_journal.journaling(db_session, call_id="edit"):
        await transactions_service.update_transaction(
            db_session,
            user.id,
            transaction.id,
            TransactionUpdate(amount=Decimal("20"))
            if financial_edit
            else TransactionUpdate(description="Updated"),
        )
    reconciliation = await reconciliations_service.create(
        db_session,
        user.id,
        ReconciliationCreate(
            account_id=source.id,
            statement_date=date(2026, 1, 31),
            statement_balance=Decimal("80" if financial_edit else "90"),
        ),
    )
    await reconciliations_service.set_entries(
        db_session, user.id, reconciliation.id, transaction_ids=[transaction.id], cleared=True
    )
    if completed:
        await reconciliations_service.complete(db_session, user.id, reconciliation.id)

    if financial_edit:
        with pytest.raises(ConflictError) as raised:
            await change_journal.undo(db_session, user.id, "edit")
        assert raised.value.code == "agents.change_modified"
        (row,) = await _journal(db_session, user, "edit")
        assert row.undone_at is None
    else:
        assert await change_journal.undo(db_session, user.id, "edit") == 1

    assert await db_session.scalar(
        select(Transaction.amount).where(Transaction.id == transaction.id)
    ) == Decimal("20" if financial_edit else "10")
    assert (
        await db_session.scalar(
            select(Transaction.description).where(Transaction.id == transaction.id)
        )
        == "Move money"
    )
    detail = await reconciliations_service.detail(db_session, user.id, reconciliation.id)
    assert detail.difference == 0


async def test_undo_is_all_or_nothing(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    async with change_journal.journaling(db_session, call_id="call-1"):
        first = await _account(db_session, user, "First")
        second = await _account(db_session, user, "Second")
    # Only the earlier row is edited, so the later one reverts first and the
    # refusal comes mid-replay.
    await accounts_service.update_account(
        db_session, user.id, first.id, AccountUpdate(name="Edited by hand")
    )

    with pytest.raises(ConflictError):
        await change_journal.undo(db_session, user.id, "call-1")

    assert await _exists(db_session, Account, first.id)
    assert await _exists(db_session, Account, second.id)


async def test_undo_refuses_when_a_foreign_key_still_points_at_the_row(
    db_session: AsyncSession,
) -> None:
    user, _ = await make_user(db_session)
    async with change_journal.journaling(db_session, call_id="call-1"):
        institution = await institutions_service.create_institution(
            db_session, user.id, InstitutionCreate(name="Bank", icon="bank")
        )
    await accounts_service.create_account(
        db_session,
        user.id,
        AccountCreate(name="Later", type="checking", currency="BRL", institution_id=institution.id),
    )

    with pytest.raises(ConflictError) as raised:
        await change_journal.undo(db_session, user.id, "call-1")

    assert raised.value.code == "agents.change_modified"
    still_there = await db_session.scalar(
        select(func.count()).select_from(Institution).where(Institution.id == institution.id)
    )
    assert still_there == 1


async def test_undo_refuses_when_reversing_would_cascade_into_other_rows(
    db_session: AsyncSession,
) -> None:
    """Deleting a transaction cascades to its reconciliation entries. Those were
    not written by the AI call, so the undo must refuse rather than drop them."""
    user, _ = await make_user(db_session)
    source = await _account(db_session, user, "Source")
    target = await _account(db_session, user, "Target")
    async with change_journal.journaling(db_session, call_id="call-1"):
        transaction = await _transfer(db_session, user, source, target)
    reconciliation = await reconciliations_service.create(
        db_session,
        user.id,
        ReconciliationCreate(
            account_id=source.id, statement_date=date(2026, 1, 31), statement_balance=Decimal("90")
        ),
    )
    await reconciliations_service.set_entries(
        db_session, user.id, reconciliation.id, transaction_ids=[transaction.id], cleared=True
    )

    with pytest.raises(ConflictError) as raised:
        await change_journal.undo(db_session, user.id, "call-1")

    assert raised.value.code == "agents.change_modified"
    assert await _exists(db_session, Transaction, transaction.id)
    entries = await db_session.scalar(text("SELECT count(*) FROM reconciliation_entries"))
    assert entries == 1


def test_backfilled_conversion_columns_do_not_count_as_edits() -> None:
    expected = {"amount": "10", "conversion_rate": "2", "updated_at": "then"}

    assert change_journal._matches(
        {"amount": "10", "conversion_rate": "3", "updated_at": "now"}, expected
    )
    assert not change_journal._matches({"amount": "11", "conversion_rate": "2"}, expected)


async def test_undo_is_scoped_to_the_owner(db_session: AsyncSession) -> None:
    owner, _ = await make_user(db_session, email="owner@example.com")
    other, _ = await make_user(db_session, email="other@example.com")
    async with change_journal.journaling(db_session, call_id="call-1"):
        account_id = (await _account(db_session, owner)).id

    assert await change_journal.list_recent(db_session, other.id) == []
    with pytest.raises(NotFoundError) as raised:
        await change_journal.undo(db_session, other.id, "call-1")

    assert raised.value.code == "agents.change_not_found"
    assert await _exists(db_session, Account, account_id)


async def test_undo_unknown_call_is_not_found(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)

    with pytest.raises(NotFoundError):
        await change_journal.undo(db_session, user.id, f"missing-{uuid4()}")


async def test_list_recent_summarises_calls_newest_first(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    async with change_journal.journaling(db_session, call_id="older"):
        await _account(db_session, user, "A")
    async with change_journal.journaling(db_session, call_id="newer"):
        await _account(db_session, user, "B")
    await change_journal.undo(db_session, user.id, "newer")

    recent = await change_journal.list_recent(db_session, user.id)

    assert [group["call_id"] for group in recent] == ["newer", "older"]
    assert recent[0]["undone"] is True
    assert recent[1]["undone"] is False
    assert recent[1]["changes"] == [{"table": "accounts", "operation": "insert", "count": 1}]


async def test_every_journaled_table_has_the_trigger(db_session: AsyncSession) -> None:
    rows = await db_session.execute(
        text(
            "SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
            "WHERE t.tgname = 'lf_journal' AND NOT t.tgisinternal"
        )
    )

    assert {name for (name,) in rows} == journaled_tables()


def test_journal_never_records_secret_or_bookkeeping_tables() -> None:
    tables = journaled_tables()

    assert {"agent_credentials", "market_data_credentials", "change_journal"}.isdisjoint(tables)
    assert {"accounts", "transactions", "goals", "loans"} <= tables


def test_migration_carries_the_same_trigger_definition_as_the_models() -> None:
    spec = importlib.util.spec_from_file_location("change_journal_migration", _MIGRATION)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    assert set(migration.JOURNALED_TABLES) == journaled_tables()
    assert migration.JOURNAL_FUNCTION_SQL.strip() == JOURNAL_FUNCTION_SQL.strip()
