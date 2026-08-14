"""Goal CRUD, the goal-account/currency-matching invariants, archive
semantics (no delete), and ownership isolation."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
    assert archive_response.json()["archived"] is True

    unarchive_response = await client.post(
        f"/api/v1/goals/{goal_id}/archive", json={"archived": False}
    )
    assert unarchive_response.json()["archived"] is False


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
