"""Tests for the financial agent tool registry."""

import inspect
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import tools
from app.core.errors import AppError
from app.models.user import User
from app.schemas.budget import BudgetUpsert
from app.schemas.institution import InstitutionCreate
from app.services import budgets as budgets_service
from app.services import institutions as institutions_service
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> User:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)
    return user


async def _create_account(
    client: AsyncClient,
    *,
    name: str = "Checking",
    currency: str = "BRL",
    opening_balance: str = "0.00",
) -> str:
    response = await client.post(
        "/api/v1/accounts",
        json={
            "name": name,
            "type": "checking",
            "currency": currency,
            "opening_balance": opening_balance,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_group(
    client: AsyncClient, name: str, *, kind: str = "expense"
) -> tuple[str, str]:
    group_response = await client.post(
        "/api/v1/category-groups",
        json={"name": name, "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert group_response.status_code == 201, group_response.text
    group_id = group_response.json()["id"]
    category_response = await client.post(
        "/api/v1/categories",
        json={
            "name": f"{name} category",
            "kind": kind,
            "group_id": group_id,
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert category_response.status_code == 201, category_response.text
    return group_id, category_response.json()["id"]


async def _create_transaction(
    client: AsyncClient,
    *,
    account_id: str,
    transaction_type: str,
    transaction_date: str,
    amount: str,
    category_id: str | None = None,
    description: str = "Tool test transaction",
) -> dict[str, object]:
    payload: dict[str, object] = {
        "type": transaction_type,
        "date": transaction_date,
        "amount": amount,
        "currency": "BRL",
        "account_id": account_id,
        "description": description,
    }
    if category_id is not None:
        payload["category_id"] = category_id
    response = await client.post("/api/v1/transactions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def test_list_accounts_returns_string_balances_and_filters_archived(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "agent-accounts@example.com")
    active_id = await _create_account(client, opening_balance="100.00")
    archived_id = await _create_account(client, name="Archived")
    archive_response = await client.post(
        f"/api/v1/accounts/{archived_id}/archive", json={"archived": True}
    )
    assert archive_response.status_code == 200, archive_response.text
    _, expense_category = await _create_group(client, "Expenses")
    await _create_transaction(
        client,
        account_id=active_id,
        transaction_type="expense",
        transaction_date="2026-01-01",
        amount="12.50",
        category_id=expense_category,
    )

    spec = tools.SPEC_BY_NAME["list_accounts"]
    rows = await spec.run(db_session, user.id, {})
    by_id = {row["id"]: row for row in rows}
    assert set(by_id) == {active_id}
    assert by_id[active_id]["balance"] == "87.5000"
    assert isinstance(by_id[active_id]["balance"], str)

    rows_with_archived = await spec.run(db_session, user.id, {"include_archived": True})
    assert {row["id"] for row in rows_with_archived} == {active_id, archived_id}


async def test_list_institutions_returns_only_current_users_institutions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "agent-institutions@example.com")
    own = await institutions_service.create_institution(
        db_session, user.id, InstitutionCreate(name="Own Bank", icon="bank")
    )
    other_user, _ = await make_user(db_session, email="agent-other-institutions@example.com")
    other = await institutions_service.create_institution(
        db_session, other_user.id, InstitutionCreate(name="Other Bank", icon="bank")
    )

    rows = await tools.SPEC_BY_NAME["list_institutions"].run(db_session, user.id, {})

    assert [row["id"] for row in rows] == [str(own.id)]
    assert str(other.id) not in {row["id"] for row in rows}


async def test_list_categories_filters_by_kind(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "agent-categories@example.com")
    _, expense_category = await _create_group(client, "Expenses")
    _, income_category = await _create_group(client, "Income", kind="income")

    spec = tools.SPEC_BY_NAME["list_categories"]
    rows = await spec.run(db_session, user.id, {"kind": "income"})
    assert [row["id"] for row in rows] == [income_category]
    assert rows[0]["kind"] == "income"
    assert expense_category not in {row["id"] for row in rows}


async def test_search_transactions_filters_and_returns_total(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "agent-search@example.com")
    account_id = await _create_account(client)
    _, expense_category = await _create_group(client, "Expenses")
    _, income_category = await _create_group(client, "Income", kind="income")
    await _create_transaction(
        client,
        account_id=account_id,
        transaction_type="expense",
        transaction_date="2026-01-05",
        amount="10.00",
        category_id=expense_category,
        description="First expense",
    )
    await _create_transaction(
        client,
        account_id=account_id,
        transaction_type="expense",
        transaction_date="2026-01-10",
        amount="20.00",
        category_id=expense_category,
        description="Second expense",
    )
    await _create_transaction(
        client,
        account_id=account_id,
        transaction_type="income",
        transaction_date="2026-01-15",
        amount="100.00",
        category_id=income_category,
        description="Income",
    )

    result = await tools.SPEC_BY_NAME["search_transactions"].run(
        db_session,
        user.id,
        {
            "date_from": "2026-01-01",
            "date_to": "2026-01-12",
            "types": ["expense"],
            "limit": 1,
        },
    )
    assert result["total"] == 2
    assert len(result["transactions"]) == 1
    assert result["transactions"][0]["type"] == "expense"
    assert result["transactions"][0]["date"] == "2026-01-10"


async def test_analytics_tools_return_string_money_shapes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "agent-analytics@example.com")
    account_id = await _create_account(client)
    group_id, expense_category = await _create_group(client, "Expenses")
    _, income_category = await _create_group(client, "Income", kind="income")
    await _create_transaction(
        client,
        account_id=account_id,
        transaction_type="income",
        transaction_date="2026-01-05",
        amount="100.00",
        category_id=income_category,
    )
    await _create_transaction(
        client,
        account_id=account_id,
        transaction_type="expense",
        transaction_date="2026-01-10",
        amount="25.00",
        category_id=expense_category,
    )
    await budgets_service.upsert_budget(
        db_session,
        user.id,
        BudgetUpsert(
            group_id=UUID(group_id),
            month="2026-01",
            amount="50.00",
            currency="BRL",
        ),
    )

    spend = await tools.SPEC_BY_NAME["spend_by_category"].run(
        db_session,
        user.id,
        {"date_from": "2026-01-01", "date_to": "2026-01-31"},
    )
    assert spend == [{"group_id": group_id, "currency": "BRL", "total": "25.0000"}]

    monthly = await tools.SPEC_BY_NAME["monthly_totals"].run(
        db_session,
        user.id,
        {"date_from": "2026-01-01", "date_to": "2026-01-31"},
    )
    assert monthly == [
        {
            "month": "2026-01",
            "currency": "BRL",
            "income": "100.0000",
            "expense": "25.0000",
            "net": "75.0000",
        }
    ]

    status = await tools.SPEC_BY_NAME["budget_status"].run(
        db_session, user.id, {"month": "2026-01"}
    )
    assert status == [
        {
            "group_id": group_id,
            "currency": "BRL",
            "budget": "50.0000",
            "spent": "25.0000",
            "remaining": "25.0000",
        }
    ]


async def test_create_transaction_writes_and_preserves_service_errors(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "agent-create@example.com")
    account_id = await _create_account(client)
    _, category_id = await _create_group(client, "Expenses")
    spec = tools.SPEC_BY_NAME["create_transaction"]

    row = await spec.run(
        db_session,
        user.id,
        {
            "type": "expense",
            "date": "2026-01-20",
            "amount": "19.99",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Created by agent",
        },
    )
    assert row["type"] == "expense"
    assert row["category_id"] == category_id
    assert row["amount"] == "19.9900"

    with pytest.raises(AppError) as error:
        await spec.run(
            db_session,
            user.id,
            {
                "type": "expense",
                "date": "2026-01-21",
                "amount": "10.00",
                "currency": "BRL",
                "account_id": account_id,
                "description": "Missing category",
            },
        )
    assert error.value.code == "transaction.category_required"


async def test_create_institution_defaults_icon_and_wraps_invalid_icon(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "agent-create-institution@example.com")
    spec = tools.SPEC_BY_NAME["create_institution"]
    assert spec.writes

    row = await spec.run(db_session, user.id, {"name": "New Bank"})

    assert row["name"] == "New Bank"
    assert row["icon"] == "bank"
    assert len(await institutions_service.list_institutions(db_session, user.id)) == 1

    with pytest.raises(AppError) as error:
        await spec.run(db_session, user.id, {"name": "Bad Bank", "icon": "not-an-icon"})
    assert error.value.code == "agents.tool_arguments_invalid"


async def test_create_account_writes_and_preserves_service_errors(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "agent-create-account@example.com")
    spec = tools.SPEC_BY_NAME["create_account"]
    assert spec.writes

    row = await spec.run(
        db_session,
        user.id,
        {
            "name": "New Checking",
            "type": "checking",
            "currency": "BRL",
            "opening_balance": "123.45",
        },
    )

    assert row["name"] == "New Checking"
    assert row["opening_balance"] == "123.4500"
    assert row["currency"] == "BRL"

    with pytest.raises(AppError) as error:
        await spec.run(
            db_session,
            user.id,
            {
                "name": "Invalid Savings",
                "type": "savings",
                "currency": "BRL",
                "credit_limit": "100.00",
            },
        )
    assert error.value.code == "account.credit_fields_not_applicable"

    with pytest.raises(AppError) as error:
        await spec.run(
            db_session,
            user.id,
            {"name": "Unknown Currency", "type": "checking", "currency": "XYZ"},
        )
    assert error.value.code == "currency.not_found"


async def test_create_account_rejects_foreign_institution(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _authed(client, db_session, "agent-institution-owner@example.com")
    institution = await institutions_service.create_institution(
        db_session, owner.id, InstitutionCreate(name="Owner Bank", icon="bank")
    )
    other_user, _ = await make_user(db_session, email="agent-account-other@example.com")

    with pytest.raises(AppError) as error:
        await tools.SPEC_BY_NAME["create_account"].run(
            db_session,
            other_user.id,
            {
                "name": "Foreign Institution Account",
                "type": "checking",
                "currency": "BRL",
                "institution_id": str(institution.id),
            },
        )

    assert error.value.status_code == 404
    assert error.value.code == "institution.not_found"


async def test_create_transaction_rejects_foreign_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner = await _authed(client, db_session, "agent-owner@example.com")
    account_id = await _create_account(client)
    other_user, _ = await make_user(db_session, email="agent-other@example.com")

    with pytest.raises(AppError) as error:
        await tools.SPEC_BY_NAME["create_transaction"].run(
            db_session,
            other_user.id,
            {
                "type": "expense",
                "date": "2026-01-22",
                "amount": "10.00",
                "currency": "BRL",
                "account_id": account_id,
                "description": "Foreign account",
            },
        )
    assert owner.id != other_user.id
    assert error.value.status_code == 404


def test_registry_has_provider_safe_schemas_and_async_runners() -> None:
    assert tools.SPEC_BY_NAME.keys() == {spec.name for spec in tools.SPECS}
    for spec in tools.SPECS:
        assert "user_id" not in spec.schema.get("properties", {})
        assert inspect.iscoroutinefunction(spec.run)
