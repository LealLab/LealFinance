"""The generic create/read/update/delete agent tools and their entity registry."""

import inspect
import json
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models  # noqa: F401 - populates Base.registry.mappers
from app.agents import entities, tools
from app.core.errors import AppError
from app.models.account import Account
from app.models.base import UserOwnedModel
from app.models.change_journal import journaled_tables
from app.models.transaction import Transaction
from app.schemas.account import AccountCreate
from app.schemas.category_group import CategoryGroupCreate
from app.schemas.transaction import TransactionCreate
from app.services import accounts as accounts_service
from app.services import category_groups as category_groups_service
from app.services import change_journal
from app.services import transactions as transactions_service
from tests.factories import make_user


async def _run(db: AsyncSession, user_id: UUID, tool: str, **args: Any) -> Any:
    return await tools.SPEC_BY_NAME[tool].run(db, user_id, args)


async def _account(
    db: AsyncSession, user_id: UUID, name: str = "Checking", type_: str = "checking"
) -> Account:
    return await accounts_service.create_account(
        db,
        user_id,
        AccountCreate(name=name, type=type_, currency="BRL", opening_balance=Decimal("100")),
    )


def test_registry_binds_every_entity_to_real_async_callables() -> None:
    assert tuple(sorted(entities.ENTITIES)) == entities.ENTITY_NAMES
    for spec in entities.ENTITIES.values():
        assert issubclass(spec.model, UserOwnedModel), spec.name
        operations = [
            spec.list_,
            spec.create[1] if spec.create else None,
            spec.update[1] if spec.update else None,
            spec.delete,
        ]
        for operation in operations:
            assert operation is None or inspect.iscoroutinefunction(operation), spec.name


def test_every_journaled_table_is_exposed_or_deliberately_left_out() -> None:
    """A new user-owned table must be given a registry entry (or be named here)."""
    exposed = {spec.model.__tablename__ for spec in entities.ENTITIES.values()}
    # Reconciliation entries are edited as a set through their reconciliation.
    assert exposed | {"reconciliation_entries"} == journaled_tables()


def test_generated_schemas_are_self_contained_and_never_ask_for_a_user_id() -> None:
    for spec in entities.ENTITIES.values():
        for pair in (spec.create, spec.update):
            if pair is None:
                continue
            flat = entities.flatten_schema(pair[0].model_json_schema())
            rendered = json.dumps(flat)
            assert "$ref" not in rendered and "$defs" not in rendered, spec.name
            assert "user_id" not in flat.get("properties", {}), spec.name


def test_flatten_schema_inlines_refs_and_keeps_a_field_called_title() -> None:
    class Inner(BaseModel):
        amount: int

    class Outer(BaseModel):
        title: str
        inner: Inner | None = None

    flat = entities.flatten_schema(Outer.model_json_schema())

    assert set(flat["properties"]) == {"title", "inner"}
    assert flat["properties"]["inner"]["type"] == "object"
    assert flat["properties"]["inner"]["properties"]["amount"]["type"] == "integer"
    assert "anyOf" not in flat["properties"]["inner"]
    assert "$defs" not in flat


async def test_every_entity_lists_an_empty_ledger_or_says_why_not(
    db_session: AsyncSession,
) -> None:
    user, _ = await make_user(db_session)

    for name, spec in entities.ENTITIES.items():
        if spec.list_ is None:
            with pytest.raises(AppError) as error:
                await _run(db_session, user.id, "list_entities", entity=name)
            assert error.value.code == "entity.operation_unsupported", name
            continue
        result = await _run(db_session, user.id, "list_entities", entity=name)
        assert result == {"total": 0, "items": []}, name


async def test_describe_entity_reports_operations_and_input_schemas(
    db_session: AsyncSession,
) -> None:
    user, _ = await make_user(db_session)

    goal = await _run(db_session, user.id, "describe_entity", entity="goal")

    assert goal["operations"] == ["list", "get", "create", "update"]
    assert "target_amount" in goal["create_schema"]["properties"]
    assert "archived" in goal["update_schema"]["properties"]
    assert "archived" in goal["hint"]
    assert "target_amount" in goal["fields"]


async def test_unknown_entity_is_rejected_with_the_valid_names(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)

    with pytest.raises(AppError) as error:
        await _run(db_session, user.id, "get_entity", entity="spaceship", id=str(UUID(int=1)))

    assert error.value.code == "entity.unknown"
    assert "account" in error.value.params["known"]


@pytest.mark.parametrize(
    ("entity", "operation", "tool", "extra"),
    [
        ("goal", "delete", "delete_entity", {"id": str(UUID(int=1))}),
        ("investment_wallet", "delete", "delete_entity", {"id": str(UUID(int=1))}),
        ("expected_income", "update", "update_entity", {"id": str(UUID(int=1)), "changes": {}}),
        ("reconciliation", "update", "update_entity", {"id": str(UUID(int=1)), "changes": {}}),
    ],
)
async def test_unsupported_operations_say_what_to_do_instead(
    db_session: AsyncSession, entity: str, operation: str, tool: str, extra: dict[str, Any]
) -> None:
    user, _ = await make_user(db_session)

    with pytest.raises(AppError) as error:
        await _run(db_session, user.id, tool, entity=entity, **extra)

    assert error.value.code == "entity.operation_unsupported"
    assert error.value.params["operation"] == operation
    assert error.value.params["entity"] == entity


async def test_goal_is_created_read_and_archived_but_never_deleted(
    db_session: AsyncSession,
) -> None:
    user, _ = await make_user(db_session)
    goal_account = await _account(db_session, user.id, "Trip", "goal")

    goal = await _run(
        db_session,
        user.id,
        "create_entity",
        entity="goal",
        data={
            "account_id": str(goal_account.id),
            "name": "Trip",
            "target_amount": "5000",
            "currency": "BRL",
        },
    )
    assert goal["archived"] is False

    archived = await _run(
        db_session,
        user.id,
        "update_entity",
        entity="goal",
        id=goal["id"],
        changes={"archived": True},
    )
    assert archived["archived"] is True
    await db_session.refresh(goal_account)
    assert goal_account.archived is True
    fetched = await _run(db_session, user.id, "get_entity", entity="goal", id=goal["id"])
    assert fetched["archived"] is True
    listed = await _run(db_session, user.id, "list_entities", entity="goal")
    assert listed["total"] == 1

    async with change_journal.journaling(db_session, call_id="unarchive-goal"):
        restored = await _run(
            db_session,
            user.id,
            "update_entity",
            entity="goal",
            id=goal["id"],
            changes={"archived": False, "target_amount": "6000"},
        )
    assert restored["archived"] is False
    assert Decimal(restored["target_amount"]) == Decimal("6000")
    await db_session.refresh(goal_account)
    assert goal_account.archived is False

    await change_journal.undo(db_session, user.id, "unarchive-goal")
    fetched = await _run(db_session, user.id, "get_entity", entity="goal", id=goal["id"])
    assert fetched["archived"] is True
    assert Decimal(fetched["target_amount"]) == Decimal("5000")
    await db_session.refresh(goal_account)
    assert goal_account.archived is True


async def test_budget_create_is_an_upsert_and_can_be_deleted(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    group = await category_groups_service.create_group(
        db_session,
        user.id,
        CategoryGroupCreate(name="Food", kind="expense", color="#112233", icon="tag"),
    )
    data = {"group_id": str(group.id), "month": "2026-01", "currency": "BRL"}

    first = await _run(
        db_session, user.id, "create_entity", entity="budget", data={**data, "amount": "50"}
    )
    second = await _run(
        db_session, user.id, "create_entity", entity="budget", data={**data, "amount": "75"}
    )

    assert second["id"] == first["id"]
    assert Decimal(second["amount"]) == Decimal("75")
    assert (await _run(db_session, user.id, "list_entities", entity="budget"))["total"] == 1
    await _run(db_session, user.id, "delete_entity", entity="budget", id=first["id"])
    assert (await _run(db_session, user.id, "list_entities", entity="budget"))["total"] == 0


async def test_manual_rate_is_keyed_by_pair_and_date(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    data = {"base_code": "USD", "quote_code": "BRL", "as_of": "2026-01-01"}

    first = await _run(
        db_session, user.id, "create_entity", entity="manual_rate", data={**data, "rate": "5.10"}
    )
    replaced = await _run(
        db_session, user.id, "create_entity", entity="manual_rate", data={**data, "rate": "5.20"}
    )

    assert replaced["id"] == first["id"]
    assert Decimal(replaced["rate"]) == Decimal("5.20")
    await _run(db_session, user.id, "delete_entity", entity="manual_rate", id=first["id"])
    assert (await _run(db_session, user.id, "list_entities", entity="manual_rate"))["total"] == 0


async def test_archiving_a_wallet_also_archives_its_account(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    wallet = await _run(
        db_session,
        user.id,
        "create_entity",
        entity="investment_wallet",
        data={"name": "Brokerage", "currency": "BRL"},
    )

    updated = await _run(
        db_session,
        user.id,
        "update_entity",
        entity="investment_wallet",
        id=wallet["id"],
        changes={"name": "Brokerage 2", "archived": True},
    )

    assert updated["name"] == "Brokerage 2"
    assert updated["archived"] is True
    account = await db_session.scalar(
        select(Account).where(Account.id == UUID(updated["account_id"]))
    )
    assert account is not None and account.archived is True


async def test_transaction_can_be_updated_and_deleted(db_session: AsyncSession) -> None:
    user, _ = await make_user(db_session)
    source = await _account(db_session, user.id, "Source")
    target = await _account(db_session, user.id, "Target")
    created = await _run(
        db_session,
        user.id,
        "create_entity",
        entity="transaction",
        data={
            "type": "transfer",
            "date": "2026-01-01",
            "amount": "10",
            "currency": "BRL",
            "account_id": str(source.id),
            "to_account_id": str(target.id),
            "description": "Before",
        },
    )

    updated = await _run(
        db_session,
        user.id,
        "update_entity",
        entity="transaction",
        id=created["id"],
        changes={"description": "After"},
    )
    assert updated["description"] == "After"

    await _run(db_session, user.id, "delete_entity", entity="transaction", id=created["id"])
    gone = await db_session.scalar(select(Transaction).where(Transaction.id == UUID(created["id"])))
    assert gone is None


async def test_deleting_an_account_through_the_tool_can_be_undone(
    db_session: AsyncSession,
) -> None:
    """The headline scenario: a destructive cascade the assistant ran, then reversed."""
    user, _ = await make_user(db_session)
    source = await _account(db_session, user.id, "Source")
    target = await _account(db_session, user.id, "Target")
    source_id = source.id
    transaction_id = (
        await transactions_service.create_transaction(
            db_session,
            user.id,
            TransactionCreate(
                type="transfer",
                date=date(2026, 1, 1),
                amount=Decimal("10"),
                currency="BRL",
                account_id=source.id,
                to_account_id=target.id,
                description="Move money",
            ),
        )
    ).id

    async with change_journal.journaling(db_session, call_id="call-1"):
        await _run(db_session, user.id, "delete_entity", entity="account", id=str(source_id))

    (recent,) = await _run(db_session, user.id, "list_recent_changes")
    assert recent["call_id"] == "call-1" and recent["undone"] is False
    assert {"table": "transactions", "operation": "delete", "count": 1} in recent["changes"]

    result = await _run(db_session, user.id, "undo_changes", call_id="call-1")

    assert result["reverted"] >= 2
    assert await db_session.scalar(select(Account.id).where(Account.id == source_id)) == source_id
    assert (
        await db_session.scalar(select(Transaction.id).where(Transaction.id == transaction_id))
        == transaction_id
    )
