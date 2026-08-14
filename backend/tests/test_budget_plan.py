"""Budget allocation and expected income upsert semantics + isolation."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_category(client: AsyncClient, name: str = "Groceries") -> str:
    response = await client.post(
        "/api/v1/categories",
        json={"name": name, "kind": "expense", "color": "#112233", "icon": "tag"},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_upsert_allocation_creates_and_updates(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "alice@example.com")
    category_id = await _create_category(client)

    first = await client.put(
        "/api/v1/budget-allocations", json={"category_id": category_id, "percentage": "25.00"}
    )
    assert first.status_code == 200
    assert first.json()["percentage"] == "25.0000"

    second = await client.put(
        "/api/v1/budget-allocations", json={"category_id": category_id, "percentage": "40.00"}
    )
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["percentage"] == "40.0000"

    list_response = await client.get("/api/v1/budget-allocations")
    matching = [row for row in list_response.json() if row["category_id"] == category_id]
    assert len(matching) == 1


async def test_upsert_allocation_percentage_out_of_range_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")
    category_id = await _create_category(client)

    response = await client.put(
        "/api/v1/budget-allocations", json={"category_id": category_id, "percentage": "150.00"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "error.validation"


async def test_delete_allocation(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "carol@example.com")
    category_id = await _create_category(client)
    create_response = await client.put(
        "/api/v1/budget-allocations", json={"category_id": category_id, "percentage": "10.00"}
    )
    allocation_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/budget-allocations/{allocation_id}")
    assert delete_response.status_code == 204


async def test_allocation_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    await _authed(other_client, db_session, "erin@example.com")
    category_id = await _create_category(client)
    create_response = await client.put(
        "/api/v1/budget-allocations", json={"category_id": category_id, "percentage": "10.00"}
    )
    allocation_id = create_response.json()["id"]

    delete_response = await other_client.delete(f"/api/v1/budget-allocations/{allocation_id}")
    assert delete_response.status_code == 404
    assert delete_response.json()["error"]["code"] == "budget_allocation.not_found"


async def test_upsert_expected_income_creates_and_updates(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")

    first = await client.put(
        "/api/v1/expected-income",
        json={"month": "2026-01", "amount": "5000.00", "currency": "BRL"},
    )
    assert first.status_code == 200
    assert first.json()["amount"] == "5000.0000"

    second = await client.put(
        "/api/v1/expected-income",
        json={"month": "2026-01", "amount": "6000.00", "currency": "BRL"},
    )
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["amount"] == "6000.0000"

    list_response = await client.get("/api/v1/expected-income")
    matching = [row for row in list_response.json() if row["month"] == "2026-01"]
    assert len(matching) == 1


async def test_expected_income_rejects_malformed_month(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")

    response = await client.put(
        "/api/v1/expected-income",
        json={"month": "not-a-month", "amount": "100.00", "currency": "BRL"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "error.validation"


async def test_expected_income_unknown_currency_is_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "heidi@example.com")

    response = await client.put(
        "/api/v1/expected-income",
        json={"month": "2026-01", "amount": "100.00", "currency": "XYZ"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "currency.not_found"


async def test_expected_income_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "ivan@example.com")
    await _authed(other_client, db_session, "judy@example.com")

    await client.put(
        "/api/v1/expected-income",
        json={"month": "2026-03", "amount": "1000.00", "currency": "BRL"},
    )

    list_response = await other_client.get("/api/v1/expected-income")
    assert all(row["month"] != "2026-03" for row in list_response.json())
