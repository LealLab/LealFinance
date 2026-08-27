"""Category group CRUD, ordering, use guards, and ownership isolation."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_category_group(
    client: AsyncClient, *, name: str = "Expenses", kind: str = "expense"
) -> dict:
    response = await client.post(
        "/api/v1/category-groups",
        json={"name": name, "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _create_category(client: AsyncClient, group_id: str) -> dict:
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": "Groceries",
            "kind": "expense",
            "group_id": group_id,
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_groups_get_kind_positions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "alice@example.com")
    first = await _create_category_group(client, name="First")
    second = await _create_category_group(client, name="Second")

    assert first["position"] == 0
    assert second["position"] == 1


async def test_update_group_name_color_and_icon(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")
    group = await _create_category_group(client)

    response = await client.patch(
        f"/api/v1/category-groups/{group['id']}",
        json={"name": "Updated", "color": "#AABBCC", "icon": "wallet"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Updated"
    assert body["color"] == "#AABBCC"
    assert body["icon"] == "wallet"


async def test_group_kind_change_is_blocked_by_a_category(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "carol@example.com")
    group = await _create_category_group(client)
    await _create_category(client, group["id"])

    response = await client.patch(f"/api/v1/category-groups/{group['id']}", json={"kind": "income"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category_group.kind_immutable"


async def test_group_kind_change_is_blocked_by_a_budget(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    group = await _create_category_group(client)
    budget_response = await client.put(
        "/api/v1/budgets",
        json={
            "group_id": group["id"],
            "month": "2026-01",
            "amount": "500.00",
            "currency": "BRL",
        },
    )
    assert budget_response.status_code == 200

    response = await client.patch(f"/api/v1/category-groups/{group['id']}", json={"kind": "income"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category_group.kind_immutable"


async def test_group_kind_change_is_blocked_by_an_allocation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")
    group = await _create_category_group(client)
    allocation_response = await client.put(
        "/api/v1/budget-allocations",
        json={"group_id": group["id"], "percentage": "25.00"},
    )
    assert allocation_response.status_code == 200

    response = await client.patch(f"/api/v1/category-groups/{group['id']}", json={"kind": "income"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category_group.kind_immutable"


async def test_empty_group_can_change_kind(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "frank@example.com")
    group = await _create_category_group(client)

    response = await client.patch(f"/api/v1/category-groups/{group['id']}", json={"kind": "income"})
    assert response.status_code == 200
    assert response.json()["kind"] == "income"


async def test_delete_empty_group_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "grace@example.com")
    group = await _create_category_group(client)

    response = await client.delete(f"/api/v1/category-groups/{group['id']}")
    assert response.status_code == 204


async def test_delete_group_with_category_is_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "heidi@example.com")
    group = await _create_category_group(client)
    await _create_category(client, group["id"])

    response = await client.delete(f"/api/v1/category-groups/{group['id']}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category_group.in_use"


async def test_delete_group_referenced_by_budget_is_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "ivan@example.com")
    group = await _create_category_group(client)
    budget_response = await client.put(
        "/api/v1/budgets",
        json={
            "group_id": group["id"],
            "month": "2026-01",
            "amount": "500.00",
            "currency": "BRL",
        },
    )
    assert budget_response.status_code == 200

    response = await client.delete(f"/api/v1/category-groups/{group['id']}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category_group.in_use"


async def test_delete_group_referenced_by_allocation_is_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "judy@example.com")
    group = await _create_category_group(client)
    allocation_response = await client.put(
        "/api/v1/budget-allocations",
        json={"group_id": group["id"], "percentage": "25.00"},
    )
    assert allocation_response.status_code == 200

    response = await client.delete(f"/api/v1/category-groups/{group['id']}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category_group.in_use"


async def test_reorder_groups(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "kate@example.com")
    first = await _create_category_group(client, name="First")
    second = await _create_category_group(client, name="Second")
    third = await _create_category_group(client, name="Third")

    response = await client.post(
        "/api/v1/category-groups/reorder",
        json={
            "kind": "expense",
            "ordered_ids": [third["id"], first["id"], second["id"]],
        },
    )
    assert response.status_code == 204

    list_response = await client.get("/api/v1/category-groups")
    by_id = {row["id"]: row for row in list_response.json()}
    assert by_id[third["id"]]["position"] == 0
    assert by_id[first["id"]]["position"] == 1
    assert by_id[second["id"]]["position"] == 2


async def test_reorder_groups_ignores_ids_outside_the_kind(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "leo@example.com")
    expense = await _create_category_group(client, name="Expense", kind="expense")
    income = await _create_category_group(client, name="Income", kind="income")

    response = await client.post(
        "/api/v1/category-groups/reorder",
        json={"kind": "expense", "ordered_ids": [income["id"], expense["id"]]},
    )
    assert response.status_code == 204

    list_response = await client.get("/api/v1/category-groups")
    by_id = {row["id"]: row for row in list_response.json()}
    assert by_id[income["id"]]["position"] == 0
    assert by_id[expense["id"]]["position"] == 0


async def test_category_group_routes_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/category-groups")
    assert response.status_code == 401


async def test_category_group_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "mallory@example.com")
    await _authed(other_client, db_session, "niaj@example.com")
    group = await _create_category_group(client, name="Mallory's Group")

    patch_response = await other_client.patch(
        f"/api/v1/category-groups/{group['id']}", json={"name": "Hijacked"}
    )
    assert patch_response.status_code == 404
    assert patch_response.json()["error"]["code"] == "category_group.not_found"

    delete_response = await other_client.delete(f"/api/v1/category-groups/{group['id']}")
    assert delete_response.status_code == 404
    assert delete_response.json()["error"]["code"] == "category_group.not_found"

    list_response = await other_client.get("/api/v1/category-groups")
    assert all(row["id"] != group["id"] for row in list_response.json())
