"""Tests for the read-only ledger aggregation service."""

from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.user import User
from app.schemas.budget import BudgetUpsert
from app.services import analytics, manual_rates
from app.services import budgets as budgets_service
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> User:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)
    return user


async def _create_account(
    client: AsyncClient, *, name: str = "Checking", currency: str = "BRL"
) -> str:
    response = await client.post(
        "/api/v1/accounts", json={"name": name, "type": "checking", "currency": currency}
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


async def _create_category(client: AsyncClient, group_id: str, name: str) -> str:
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": name,
            "kind": "expense",
            "group_id": group_id,
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _post_transaction(
    client: AsyncClient,
    account_id: str,
    *,
    tx_type: str,
    transaction_date: str,
    amount: str,
    currency: str = "BRL",
    category_id: str | None = None,
    to_account_id: str | None = None,
    conversion: dict[str, str] | None = None,
) -> None:
    payload: dict[str, object] = {
        "type": tx_type,
        "date": transaction_date,
        "amount": amount,
        "currency": currency,
        "account_id": account_id,
        "description": f"{tx_type} row",
    }
    if category_id is not None:
        payload["category_id"] = category_id
    if to_account_id is not None:
        payload["to_account_id"] = to_account_id
    if conversion is not None:
        payload["conversion"] = conversion
    response = await client.post("/api/v1/transactions", json=payload)
    assert response.status_code == 201, response.text


async def test_spend_by_category_group_filters_and_groups(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "analytics-spend@example.com")
    account_id = await _create_account(client)
    second_account_id = await _create_account(client, name="Savings")
    groceries_group, groceries_category = await _create_group(client, "Groceries")
    groceries_second_category = await _create_category(client, groceries_group, "Market")
    dining_group, dining_category = await _create_group(client, "Dining")
    _, income_category = await _create_group(client, "Salary", kind="income")

    await _post_transaction(
        client,
        account_id,
        tx_type="expense",
        transaction_date="2026-01-01",
        amount="20.00",
        category_id=groceries_category,
    )
    await _post_transaction(
        client,
        account_id,
        tx_type="expense",
        transaction_date="2026-01-31",
        amount="30.00",
        category_id=groceries_second_category,
    )
    await _post_transaction(
        client,
        account_id,
        tx_type="expense",
        transaction_date="2026-01-15",
        amount="7.00",
        category_id=dining_category,
    )
    await _post_transaction(
        client,
        account_id,
        tx_type="expense",
        transaction_date="2025-12-31",
        amount="100.00",
        category_id=groceries_category,
    )
    await _post_transaction(
        client,
        account_id,
        tx_type="expense",
        transaction_date="2026-02-01",
        amount="100.00",
        category_id=groceries_category,
    )
    await _post_transaction(
        client,
        account_id,
        tx_type="income",
        transaction_date="2026-01-15",
        amount="1000.00",
        category_id=income_category,
    )
    await _post_transaction(
        client,
        account_id,
        tx_type="interest",
        transaction_date="2026-01-15",
        amount="5.00",
    )
    await _post_transaction(
        client,
        account_id,
        tx_type="transfer",
        transaction_date="2026-01-15",
        amount="15.00",
        to_account_id=second_account_id,
    )

    rows = await analytics.spend_by_category_group(
        db_session,
        user.id,
        date_from=date(2026, 1, 1),
        date_to=date(2026, 1, 31),
    )

    assert {(row.group_id, row.currency): row.total for row in rows} == {
        (UUID(groceries_group), "BRL"): Decimal("50.0000"),
        (UUID(dining_group), "BRL"): Decimal("7.0000"),
    }


async def test_spend_uses_conversion_amount_and_currency(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "analytics-conversion@example.com")
    account_id = await _create_account(client, currency="USD")
    group_id, category_id = await _create_group(client, "Converted groceries")

    await _post_transaction(
        client,
        account_id,
        tx_type="expense",
        transaction_date="2026-01-15",
        amount="100.00",
        currency="BRL",
        category_id=category_id,
        conversion={"currency": "USD", "rate": "0.2", "source": "manual"},
    )

    rows = await analytics.spend_by_category_group(
        db_session,
        user.id,
        date_from=date(2026, 1, 1),
        date_to=date(2026, 1, 31),
    )

    assert rows == [
        analytics.GroupSpend(UUID(group_id), "USD", Decimal("20.0000")),
    ]


async def test_spend_currency_converts_and_collapses_groups(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "analytics-target-currency@example.com")
    brl_account_id = await _create_account(client)
    usd_account_id = await _create_account(client, name="Dollar account", currency="USD")
    group_id, category_id = await _create_group(client, "Mixed groceries")
    await manual_rates.upsert_manual_rate(
        db_session,
        user.id,
        "USD",
        "BRL",
        date(2026, 1, 31),
        Decimal("5"),
    )

    await _post_transaction(
        client,
        brl_account_id,
        tx_type="expense",
        transaction_date="2026-01-15",
        amount="10.00",
        category_id=category_id,
    )
    await _post_transaction(
        client,
        usd_account_id,
        tx_type="expense",
        transaction_date="2026-01-16",
        amount="2.00",
        currency="USD",
        category_id=category_id,
    )

    rows = await analytics.spend_by_category_group(
        db_session,
        user.id,
        date_from=date(2026, 1, 1),
        date_to=date(2026, 1, 31),
        currency="BRL",
    )

    assert rows == [
        analytics.GroupSpend(UUID(group_id), "BRL", Decimal("20.0000")),
    ]


async def test_spend_isolated_by_user(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "analytics-owner@example.com")
    await _authed(other_client, db_session, "analytics-other@example.com")
    owner_account = await _create_account(client)
    owner_group, owner_category = await _create_group(client, "Owner groceries")
    other_account = await _create_account(other_client)
    _, other_category = await _create_group(other_client, "Other groceries")

    await _post_transaction(
        client,
        owner_account,
        tx_type="expense",
        transaction_date="2026-01-15",
        amount="40.00",
        category_id=owner_category,
    )
    await _post_transaction(
        other_client,
        other_account,
        tx_type="expense",
        transaction_date="2026-01-15",
        amount="900.00",
        category_id=other_category,
    )

    rows = await analytics.spend_by_category_group(
        db_session,
        user.id,
        date_from=date(2026, 1, 1),
        date_to=date(2026, 1, 31),
    )

    assert rows == [
        analytics.GroupSpend(UUID(owner_group), "BRL", Decimal("40.0000")),
    ]


async def test_monthly_totals_pivots_and_sorts_months(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "analytics-monthly@example.com")
    account_id = await _create_account(client)
    _, income_category = await _create_group(client, "Income", kind="income")
    _, expense_category = await _create_group(client, "Expenses")

    for tx_type, transaction_date, amount, category_id in (
        ("income", "2026-01-31", "1000.00", income_category),
        ("expense", "2026-01-31", "200.00", expense_category),
        ("income", "2026-02-01", "1200.00", income_category),
        ("expense", "2026-02-01", "300.00", expense_category),
    ):
        await _post_transaction(
            client,
            account_id,
            tx_type=tx_type,
            transaction_date=transaction_date,
            amount=amount,
            category_id=category_id,
        )

    rows = await analytics.monthly_totals(
        db_session,
        user.id,
        date_from=date(2026, 1, 1),
        date_to=date(2026, 2, 28),
    )

    assert rows == [
        analytics.MonthTotals(
            "2026-01", "BRL", Decimal("1000.0000"), Decimal("200.0000"), Decimal("800.0000")
        ),
        analytics.MonthTotals(
            "2026-02", "BRL", Decimal("1200.0000"), Decimal("300.0000"), Decimal("900.0000")
        ),
    ]


async def test_budget_status_reports_budget_and_spend_states(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "analytics-budgets@example.com")
    account_id = await _create_account(client)
    over_group, over_category = await _create_group(client, "Over budget")
    under_group, under_category = await _create_group(client, "Under budget")
    no_budget_group, no_budget_category = await _create_group(client, "No budget")
    no_spend_group, _ = await _create_group(client, "No spend")

    for category_id, amount in (
        (over_category, "125.00"),
        (under_category, "40.00"),
        (no_budget_category, "20.00"),
    ):
        await _post_transaction(
            client,
            account_id,
            tx_type="expense",
            transaction_date="2026-01-15",
            amount=amount,
            category_id=category_id,
        )

    for group_id, amount, currency in (
        (over_group, "100.00", "BRL"),
        (under_group, "100.00", "BRL"),
        (no_spend_group, "75.00", "USD"),
    ):
        await budgets_service.upsert_budget(
            db_session,
            user.id,
            BudgetUpsert(
                group_id=UUID(group_id),
                month="2026-01",
                amount=Decimal(amount),
                currency=currency,
            ),
        )

    rows = await analytics.budget_status(db_session, user.id, month="2026-01")
    by_key = {(str(row.group_id), row.currency): row for row in rows}

    assert by_key[(over_group, "BRL")] == analytics.BudgetStatus(
        UUID(over_group), "BRL", Decimal("100.0000"), Decimal("125.0000"), Decimal("-25.0000")
    )
    assert by_key[(under_group, "BRL")] == analytics.BudgetStatus(
        UUID(under_group), "BRL", Decimal("100.0000"), Decimal("40.0000"), Decimal("60.0000")
    )
    assert by_key[(no_budget_group, "BRL")] == analytics.BudgetStatus(
        UUID(no_budget_group), "BRL", None, Decimal("20.0000"), None
    )
    assert by_key[(no_spend_group, "USD")] == analytics.BudgetStatus(
        UUID(no_spend_group), "USD", Decimal("75.0000"), Decimal("0"), Decimal("75.0000")
    )


async def test_budget_status_rejects_malformed_month(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "analytics-invalid-month@example.com")

    with pytest.raises(ValidationAppError) as error:
        await analytics.budget_status(db_session, user.id, month="2026-13")

    assert error.value.code == "analytics.invalid_month"
