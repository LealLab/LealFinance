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
    assert all(row["id"] != account_id for row in list_response.json())
