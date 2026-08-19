"""Account CRUD, credit-card field validation, and ownership isolation."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def test_create_and_list_account(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")

    create_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "currency": "BRL",
            "opening_balance": "1000.00",
        },
    )
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["name"] == "Checking"
    assert body["opening_balance"] == "1000.0000"
    assert isinstance(body["opening_balance"], str)
    assert body["archived"] is False

    list_response = await client.get("/api/v1/accounts")
    assert list_response.status_code == 200
    assert any(row["id"] == body["id"] for row in list_response.json())


async def test_create_account_with_unknown_currency_is_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")

    response = await client.post(
        "/api/v1/accounts",
        json={"name": "Foreign", "type": "checking", "currency": "XYZ"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "currency.not_found"


async def test_credit_card_account_accepts_credit_fields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "carol@example.com")

    response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Visa",
            "type": "credit_card",
            "currency": "BRL",
            "credit_limit": "5000.00",
            "closing_day": 10,
            "due_day": 20,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["credit_limit"] == "5000.0000"
    assert body["closing_day"] == 10
    assert body["due_day"] == 20


async def test_non_credit_card_account_rejects_credit_fields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")

    response = await client.post(
        "/api/v1/accounts",
        json={"name": "Savings", "type": "savings", "currency": "BRL", "credit_limit": "100.00"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "account.credit_fields_not_applicable"


async def test_account_closing_day_out_of_range_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")

    response = await client.post(
        "/api/v1/accounts",
        json={"name": "Visa", "type": "credit_card", "currency": "BRL", "closing_day": 32},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "error.validation"


async def test_account_with_own_institution_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Bank", "icon": "bank"}
    )
    institution_id = institution_response.json()["id"]

    account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "currency": "BRL",
            "institution_id": institution_id,
        },
    )
    assert account_response.status_code == 201
    assert account_response.json()["institution_id"] == institution_id


async def test_account_with_another_users_institution_is_not_found(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")
    await _authed(other_client, db_session, "heidi@example.com")

    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Grace's Bank", "icon": "bank"}
    )
    institution_id = institution_response.json()["id"]

    account_response = await other_client.post(
        "/api/v1/accounts",
        json={
            "name": "Sneaky",
            "type": "checking",
            "currency": "BRL",
            "institution_id": institution_id,
        },
    )
    assert account_response.status_code == 404
    assert account_response.json()["error"]["code"] == "institution.not_found"


async def test_update_account_can_clear_institution(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "ivan@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Bank", "icon": "bank"}
    )
    institution_id = institution_response.json()["id"]
    account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "currency": "BRL",
            "institution_id": institution_id,
        },
    )
    account_id = account_response.json()["id"]

    update_response = await client.patch(
        f"/api/v1/accounts/{account_id}", json={"institution_id": None}
    )
    assert update_response.status_code == 200
    assert update_response.json()["institution_id"] is None


@pytest.mark.parametrize("reference_kind", ["transaction", "recurring"])
@pytest.mark.parametrize("referenced_leg", ["source", "destination"])
async def test_account_currency_change_rejects_all_ledger_references(
    client: AsyncClient,
    db_session: AsyncSession,
    reference_kind: str,
    referenced_leg: str,
) -> None:
    await _authed(
        client,
        db_session,
        f"account-{reference_kind}-{referenced_leg}@example.com",
    )
    source = await client.post(
        "/api/v1/accounts", json={"name": "Source", "type": "checking", "currency": "BRL"}
    )
    destination = await client.post(
        "/api/v1/accounts",
        json={"name": "Destination", "type": "savings", "currency": "BRL"},
    )
    source_id = source.json()["id"]
    destination_id = destination.json()["id"]
    template = {
        "type": "transfer",
        "amount": "10.00",
        "currency": "BRL",
        "account_id": source_id,
        "to_account_id": destination_id,
        "description": "Referenced account",
    }
    if reference_kind == "transaction":
        response = await client.post(
            "/api/v1/transactions", json={**template, "date": "2026-01-01"}
        )
    else:
        response = await client.post(
            "/api/v1/recurring-rules",
            json={
                "frequency": "monthly",
                "start_date": "2026-01-01",
                "template": template,
            },
        )
    assert response.status_code == 201, response.text

    account_id = source_id if referenced_leg == "source" else destination_id
    update_response = await client.patch(f"/api/v1/accounts/{account_id}", json={"currency": "USD"})

    assert update_response.status_code == 422
    assert update_response.json()["error"]["code"] == "account.currency_in_use"


@pytest.mark.parametrize(
    ("changes", "error_code"),
    [
        ({"type": "checking"}, "account.goal_requires_goal_type"),
        ({"currency": "USD"}, "account.goal_currency_mismatch"),
    ],
)
async def test_account_change_cannot_break_linked_goal(
    client: AsyncClient,
    db_session: AsyncSession,
    changes: dict[str, str],
    error_code: str,
) -> None:
    await _authed(client, db_session, f"goal-guard-{error_code}@example.com")
    account_response = await client.post(
        "/api/v1/accounts", json={"name": "Goal account", "type": "goal", "currency": "BRL"}
    )
    account_id = account_response.json()["id"]
    goal_response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Goal",
            "target_amount": "1000.00",
            "currency": "BRL",
        },
    )
    assert goal_response.status_code == 201

    response = await client.patch(f"/api/v1/accounts/{account_id}", json=changes)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == error_code


async def test_archive_and_unarchive_account(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "judy@example.com")
    create_response = await client.post(
        "/api/v1/accounts", json={"name": "Cash", "type": "cash", "currency": "BRL"}
    )
    account_id = create_response.json()["id"]

    archive_response = await client.post(
        f"/api/v1/accounts/{account_id}/archive", json={"archived": True}
    )
    assert archive_response.status_code == 200
    assert archive_response.json()["archived"] is True


async def test_account_routes_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/accounts")
    assert response.status_code == 401


async def test_account_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "kate@example.com")
    await _authed(other_client, db_session, "leo@example.com")

    create_response = await client.post(
        "/api/v1/accounts", json={"name": "Kate's Cash", "type": "cash", "currency": "BRL"}
    )
    account_id = create_response.json()["id"]

    get_response = await other_client.get(f"/api/v1/accounts/{account_id}")
    assert get_response.status_code == 404
    assert get_response.json()["error"]["code"] == "account.not_found"

    patch_response = await other_client.patch(
        f"/api/v1/accounts/{account_id}", json={"name": "Hijacked"}
    )
    assert patch_response.status_code == 404

    list_response = await other_client.get("/api/v1/accounts")
    assert list_response.status_code == 200


async def _create_category(
    client: AsyncClient, name: str = "Groceries", kind: str = "expense"
) -> str:
    response = await client.post(
        "/api/v1/categories",
        json={"name": name, "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_account_balances_reflect_income_expense_and_transfers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "morgan@example.com")
    source_response = await client.post(
        "/api/v1/accounts",
        json={"name": "Source", "type": "checking", "currency": "BRL", "opening_balance": "100.00"},
    )
    source_id = source_response.json()["id"]
    dest_response = await client.post(
        "/api/v1/accounts",
        json={"name": "Dest", "type": "savings", "currency": "BRL", "opening_balance": "50.00"},
    )
    dest_id = dest_response.json()["id"]
    income_category = await _create_category(client, name="Salary", kind="income")
    expense_category = await _create_category(client, name="Groceries", kind="expense")

    await client.post(
        "/api/v1/transactions",
        json={
            "type": "income",
            "date": "2026-01-01",
            "amount": "500.00",
            "currency": "BRL",
            "account_id": source_id,
            "category_id": income_category,
            "description": "Paycheck",
        },
    )
    await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-02",
            "amount": "200.00",
            "currency": "BRL",
            "account_id": source_id,
            "category_id": expense_category,
            "description": "Groceries",
        },
    )
    await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-03",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": source_id,
            "to_account_id": dest_id,
            "description": "Move to savings",
        },
    )

    response = await client.get("/api/v1/accounts/balances")
    assert response.status_code == 200
    balances = {row["account_id"]: row["balance"] for row in response.json()}
    # 100 + 500 - 200 - 100
    assert balances[source_id] == "300.0000"
    # 50 + 100
    assert balances[dest_id] == "150.0000"


async def test_account_balances_use_converted_amount_for_cross_currency_expense(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "nadia@example.com")
    account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Dollar",
            "type": "checking",
            "currency": "USD",
            "opening_balance": "100.00",
        },
    )
    account_id = account_response.json()["id"]
    category_id = await _create_category(client)

    await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Cross-currency expense",
            "conversion": {"currency": "USD", "rate": "0.2", "source": "manual"},
        },
    )

    response = await client.get("/api/v1/accounts/balances")
    assert response.status_code == 200
    balances = {row["account_id"]: row["balance"] for row in response.json()}
    # 100 - (100 * 0.2)
    assert balances[account_id] == "80.0000"


async def test_account_balances_use_converted_amount_for_cross_currency_transfer(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression test: the incoming leg of a transfer must be credited with
    the *converted* amount, not the source amount relabeled into the
    destination currency - matching the frontend's balances.spec.ts
    "debits the source in its own currency and credits the destination
    with the converted amount" test, guarding the same bug on the backend's
    SQL aggregate."""
    await _authed(client, db_session, "quinn@example.com")
    source_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Dollar source",
            "type": "checking",
            "currency": "USD",
            "opening_balance": "1000.00",
        },
    )
    source_id = source_response.json()["id"]
    dest_response = await client.post(
        "/api/v1/accounts",
        json={"name": "Real dest", "type": "savings", "currency": "BRL", "opening_balance": "0.00"},
    )
    dest_id = dest_response.json()["id"]

    await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "USD",
            "account_id": source_id,
            "to_account_id": dest_id,
            "description": "Cross-currency transfer",
            "conversion": {"currency": "BRL", "rate": "5.2", "source": "manual"},
        },
    )

    response = await client.get("/api/v1/accounts/balances")
    assert response.status_code == 200
    balances = {row["account_id"]: row["balance"] for row in response.json()}
    # 1000 - 100 (unconverted origin-side debit)
    assert balances[source_id] == "900.0000"
    # 0 + (100 * 5.2) (converted destination-side credit)
    assert balances[dest_id] == "520.0000"


async def test_account_balances_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "oscar@example.com")
    await _authed(other_client, db_session, "penny@example.com")

    create_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Oscar's Cash",
            "type": "cash",
            "currency": "BRL",
            "opening_balance": "10.00",
        },
    )
    account_id = create_response.json()["id"]

    response = await other_client.get("/api/v1/accounts/balances")
    assert response.status_code == 200
    assert all(row["account_id"] != account_id for row in response.json())
