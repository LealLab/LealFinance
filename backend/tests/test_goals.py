"""Goal CRUD, the goal-account/currency-matching invariants, archive
semantics (no delete), and ownership isolation."""

from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.services import goals as goals_service
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_account(
    client: AsyncClient, account_type: str = "goal", currency: str = "BRL"
) -> str:
    response = await client.post(
        "/api/v1/accounts", json={"name": "Trip Fund", "type": account_type, "currency": currency}
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_create_goal_on_goal_account(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")
    account_id = await _create_account(client)

    response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Trip to Japan",
            "target_amount": "10000.00",
            "currency": "BRL",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["target_amount"] == "10000.0000"
    assert body["archived"] is False


async def test_create_goal_on_non_goal_account_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")
    account_id = await _create_account(client, account_type="checking")

    response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Bad Goal",
            "target_amount": "1000.00",
            "currency": "BRL",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "goal.account_not_goal_type"


async def test_create_goal_currency_mismatch_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "carol@example.com")
    account_id = await _create_account(client, currency="BRL")

    response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Mismatched",
            "target_amount": "1000.00",
            "currency": "USD",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "goal.currency_mismatch"


async def test_create_goal_on_account_that_already_has_one_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    account_id = await _create_account(client)
    first = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "First Goal",
            "target_amount": "1000.00",
            "currency": "BRL",
        },
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Second Goal",
            "target_amount": "500.00",
            "currency": "BRL",
        },
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "goal.account_already_has_goal"


async def test_interval_without_frequency_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")
    account_id = await _create_account(client)

    response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Bad Interval",
            "target_amount": "1000.00",
            "currency": "BRL",
            "interval": 2,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "goal.interval_requires_frequency"


async def test_update_goal(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "frank@example.com")
    account_id = await _create_account(client)
    create_response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Original",
            "target_amount": "1000.00",
            "currency": "BRL",
        },
    )
    goal_id = create_response.json()["id"]

    response = await client.patch(
        f"/api/v1/goals/{goal_id}", json={"name": "Renamed", "target_amount": "2000.00"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"
    assert response.json()["target_amount"] == "2000.0000"


async def test_create_goal_with_account_is_atomic_aggregate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "aggregate-create@example.com")

    response = await client.post(
        "/api/v1/goals/with-account",
        json={
            "name": "Trip to Japan",
            "target_amount": "10000.00",
            "currency": "BRL",
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["goal"]["account_id"] == body["account"]["id"]
    assert body["goal"]["name"] == body["account"]["name"] == "Trip to Japan"
    assert body["goal"]["currency"] == body["account"]["currency"] == "BRL"
    assert body["account"]["type"] == "goal"
    assert body["account"]["opening_balance"] == "0.0000"
    assert body["account"]["institution_id"] is None


async def test_update_goal_with_account_updates_both_records(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "aggregate-update@example.com")
    created = await client.post(
        "/api/v1/goals/with-account",
        json={"name": "Original", "target_amount": "1000.00", "currency": "BRL"},
    )
    goal_id = created.json()["goal"]["id"]

    response = await client.patch(
        f"/api/v1/goals/{goal_id}/with-account",
        json={"name": "Renamed", "target_amount": "2000.00", "currency": "USD"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["goal"]["name"] == body["account"]["name"] == "Renamed"
    assert body["goal"]["currency"] == body["account"]["currency"] == "USD"
    assert body["goal"]["target_amount"] == "2000.0000"


async def test_update_goal_with_account_rejects_referenced_currency_change(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "aggregate-currency-guard@example.com")
    created = await client.post(
        "/api/v1/goals/with-account",
        json={"name": "Referenced goal", "target_amount": "1000.00", "currency": "BRL"},
    )
    goal = created.json()["goal"]
    account = created.json()["account"]
    source = await client.post(
        "/api/v1/accounts",
        json={"name": "Funding source", "type": "checking", "currency": "BRL"},
    )
    transfer = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": source.json()["id"],
            "to_account_id": account["id"],
            "description": "Fund goal",
        },
    )
    assert transfer.status_code == 201

    response = await client.patch(
        f"/api/v1/goals/{goal['id']}/with-account", json={"currency": "USD"}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "account.currency_in_use"
    accounts = (await client.get("/api/v1/accounts")).json()
    goals = (await client.get("/api/v1/goals")).json()
    assert next(item for item in accounts if item["id"] == account["id"])["currency"] == "BRL"
    assert next(item for item in goals if item["id"] == goal["id"])["currency"] == "BRL"


async def test_create_goal_with_account_rolls_back_when_goal_insert_fails(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _authed(client, db_session, "aggregate-rollback@example.com")
    real_goal = goals_service.Goal

    def invalid_goal(**values: object) -> object:
        values["target_amount"] = Decimal("0")
        return real_goal(**values)

    monkeypatch.setattr(goals_service, "Goal", invalid_goal)

    with pytest.raises(IntegrityError):
        await client.post(
            "/api/v1/goals/with-account",
            json={"name": "Must roll back", "target_amount": "1000.00", "currency": "BRL"},
        )

    result = await db_session.execute(select(Account).where(Account.name == "Must roll back"))
    assert result.scalar_one_or_none() is None


async def test_archive_and_unarchive_goal(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "grace@example.com")
    account_id = await _create_account(client)
    create_response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Archivable",
            "target_amount": "1000.00",
            "currency": "BRL",
        },
    )
    goal_id = create_response.json()["id"]

    archive_response = await client.post(
        f"/api/v1/goals/{goal_id}/archive", json={"archived": True}
    )
    assert archive_response.status_code == 200
    assert archive_response.json()["goal"]["archived"] is True
    assert archive_response.json()["account"]["archived"] is True

    unarchive_response = await client.post(
        f"/api/v1/goals/{goal_id}/archive", json={"archived": False}
    )
    assert unarchive_response.json()["goal"]["archived"] is False
    assert unarchive_response.json()["account"]["archived"] is False


async def test_goal_routes_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/goals")
    assert response.status_code == 401


async def test_goal_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "heidi@example.com")
    await _authed(other_client, db_session, "ivan@example.com")
    account_id = await _create_account(client)
    create_response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": account_id,
            "name": "Heidi's Goal",
            "target_amount": "1000.00",
            "currency": "BRL",
        },
    )
    goal_id = create_response.json()["id"]

    patch_response = await other_client.patch(f"/api/v1/goals/{goal_id}", json={"name": "Hijacked"})
    assert patch_response.status_code == 404
    assert patch_response.json()["error"]["code"] == "goal.not_found"

    list_response = await other_client.get("/api/v1/goals")
    assert all(row["id"] != goal_id for row in list_response.json())
