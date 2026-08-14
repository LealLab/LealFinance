"""Budget upsert semantics and ownership isolation."""

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


async def test_upsert_budget_creates(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")
    category_id = await _create_category(client)

    response = await client.put(
        "/api/v1/budgets",
        json={
            "category_id": category_id,
            "month": "2026-01",
            "amount": "500.00",
            "currency": "BRL",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["amount"] == "500.0000"
    assert body["month"] == "2026-01"


async def test_upsert_budget_updates_existing_instead_of_duplicating(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")
    category_id = await _create_category(client)
    payload = {
        "category_id": category_id,
        "month": "2026-02",
        "amount": "100.00",
        "currency": "BRL",
    }

    first = await client.put("/api/v1/budgets", json=payload)
    updated_payload = {**payload, "amount": "200.00"}
    second = await client.put("/api/v1/budgets", json=updated_payload)

    assert first.json()["id"] == second.json()["id"]
    assert second.json()["amount"] == "200.0000"

    list_response = await client.get("/api/v1/budgets")
    matching = [
        row
        for row in list_response.json()
        if row["category_id"] == category_id and row["month"] == "2026-02"
    ]
    assert len(matching) == 1


async def test_upsert_budget_unknown_category_is_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "carol@example.com")

    response = await client.put(
        "/api/v1/budgets",
        json={
            "category_id": "00000000-0000-0000-0000-000000000000",
            "month": "2026-01",
            "amount": "100.00",
            "currency": "BRL",
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "category.not_found"


async def test_upsert_budget_unknown_currency_is_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    category_id = await _create_category(client)

    response = await client.put(
        "/api/v1/budgets",
        json={
            "category_id": category_id,
            "month": "2026-01",
            "amount": "100.00",
            "currency": "XYZ",
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "currency.not_found"


async def test_upsert_budget_rejects_malformed_month(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")
    category_id = await _create_category(client)

    response = await client.put(
        "/api/v1/budgets",
        json={
            "category_id": category_id,
            "month": "2026-13",
            "amount": "100.00",
            "currency": "BRL",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "error.validation"


async def test_delete_budget(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "frank@example.com")
    category_id = await _create_category(client)
    create_response = await client.put(
        "/api/v1/budgets",
        json={
            "category_id": category_id,
            "month": "2026-01",
            "amount": "100.00",
            "currency": "BRL",
        },
    )
    budget_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/budgets/{budget_id}")
    assert delete_response.status_code == 204

    list_response = await client.get("/api/v1/budgets")
    assert all(row["id"] != budget_id for row in list_response.json())


async def test_budget_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")
    await _authed(other_client, db_session, "heidi@example.com")
    category_id = await _create_category(client)
    create_response = await client.put(
        "/api/v1/budgets",
        json={
            "category_id": category_id,
            "month": "2026-01",
            "amount": "100.00",
            "currency": "BRL",
        },
    )
    budget_id = create_response.json()["id"]

    delete_response = await other_client.delete(f"/api/v1/budgets/{budget_id}")
    assert delete_response.status_code == 404
    assert delete_response.json()["error"]["code"] == "budget.not_found"

    list_response = await other_client.get("/api/v1/budgets")
    assert all(row["id"] != budget_id for row in list_response.json())
