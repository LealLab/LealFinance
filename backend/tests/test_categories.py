"""Category CRUD, group validation, sibling ordering, and ownership isolation."""

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


async def _create_category(
    client: AsyncClient,
    *,
    name: str,
    kind: str = "expense",
    group_id: str | None = None,
) -> dict:
    if group_id is None:
        group_id = (await _create_category_group(client, kind=kind))["id"]
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": name,
            "kind": kind,
            "group_id": group_id,
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_category_in_group_gets_position_zero(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "alice@example.com")
    group = await _create_category_group(client)
    category = await _create_category(client, name="Groceries", group_id=group["id"])
    assert category["position"] == 0
    assert category["group_id"] == group["id"]


async def test_category_positions_are_sequential_within_a_group(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")
    first_group = await _create_category_group(client, name="First Group")
    second_group = await _create_category_group(client, name="Second Group")
    first = await _create_category(client, name="Groceries", group_id=first_group["id"])
    second = await _create_category(client, name="Transport", group_id=first_group["id"])
    other = await _create_category(client, name="Other", group_id=second_group["id"])
    assert first["position"] == 0
    assert second["position"] == 1
    assert other["position"] == 0


async def test_create_category_with_mismatched_group_kind_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "carol@example.com")
    group = await _create_category_group(client, name="Income", kind="income")

    response = await client.post(
        "/api/v1/categories",
        json={
            "name": "Uber",
            "kind": "expense",
            "group_id": group["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "category.group_kind_mismatch"


async def test_category_can_move_to_another_group_of_the_same_kind(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    source = await _create_category_group(client, name="Source")
    target = await _create_category_group(client, name="Target")
    category = await _create_category(client, name="Groceries", group_id=source["id"])

    response = await client.patch(
        f"/api/v1/categories/{category['id']}", json={"group_id": target["id"]}
    )
    assert response.status_code == 200
    assert response.json()["group_id"] == target["id"]


async def test_category_cannot_move_to_a_group_of_a_different_kind(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")
    category = await _create_category(client, name="Groceries")
    income_group = await _create_category_group(client, name="Income", kind="income")

    response = await client.patch(
        f"/api/v1/categories/{category['id']}", json={"group_id": income_group["id"]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "category.group_kind_mismatch"


async def test_category_can_change_kind_with_a_matching_new_group(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")
    category = await _create_category(client, name="Unused")
    income_group = await _create_category_group(client, name="Income", kind="income")

    response = await client.patch(
        f"/api/v1/categories/{category['id']}",
        json={"kind": "income", "group_id": income_group["id"]},
    )
    assert response.status_code == 200
    assert response.json()["kind"] == "income"
    assert response.json()["group_id"] == income_group["id"]


async def test_category_in_foreign_group_is_not_found(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")
    await _authed(other_client, db_session, "heidi@example.com")
    group = await _create_category_group(client, name="Frank's Group")

    response = await other_client.post(
        "/api/v1/categories",
        json={
            "name": "Sneaky",
            "kind": "expense",
            "group_id": group["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "category_group.not_found"


async def test_update_category_name(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "ivan@example.com")
    category = await _create_category(client, name="Old Name")

    response = await client.patch(f"/api/v1/categories/{category['id']}", json={"name": "New Name"})
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


async def test_changing_category_kind_is_blocked_by_a_transaction(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "judy@example.com")
    category = await _create_category(client, name="Groceries")
    income_group = await _create_category_group(client, name="Income", kind="income")
    account_response = await client.post(
        "/api/v1/accounts", json={"name": "Checking", "type": "checking", "currency": "BRL"}
    )
    transaction_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "50.00",
            "currency": "BRL",
            "account_id": account_response.json()["id"],
            "category_id": category["id"],
            "description": "Groceries run",
        },
    )
    assert transaction_response.status_code == 201

    response = await client.patch(
        f"/api/v1/categories/{category['id']}",
        json={"kind": "income", "group_id": income_group["id"]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category.kind_immutable"


async def test_delete_category_without_references_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "kate@example.com")
    category = await _create_category(client, name="Deletable")

    response = await client.delete(f"/api/v1/categories/{category['id']}")
    assert response.status_code == 204


async def test_delete_category_with_group_budget_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "leo@example.com")
    group = await _create_category_group(client)
    category = await _create_category(client, name="Groceries", group_id=group["id"])
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

    response = await client.delete(f"/api/v1/categories/{category['id']}")
    assert response.status_code == 204


async def test_delete_category_referenced_by_transaction_is_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Transactions are one of the two remaining category references."""
    await _authed(client, db_session, "mallory@example.com")
    category = await _create_category(client, name="Groceries")
    account_response = await client.post(
        "/api/v1/accounts", json={"name": "Checking", "type": "checking", "currency": "BRL"}
    )
    transaction_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "50.00",
            "currency": "BRL",
            "account_id": account_response.json()["id"],
            "category_id": category["id"],
            "description": "Groceries run",
        },
    )
    assert transaction_response.status_code == 201

    response = await client.delete(f"/api/v1/categories/{category['id']}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category.in_use"


async def test_recurring_template_category_blocks_kind_change_and_delete(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "niaj@example.com")
    category = await _create_category(client, name="Rent")
    income_group = await _create_category_group(client, name="Income", kind="income")
    account_response = await client.post(
        "/api/v1/accounts", json={"name": "Checking", "type": "checking", "currency": "BRL"}
    )
    recurring_response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "100.00",
                "currency": "BRL",
                "account_id": account_response.json()["id"],
                "category_id": category["id"],
                "description": "Rent",
            },
        },
    )
    assert recurring_response.status_code == 201, recurring_response.text

    kind_response = await client.patch(
        f"/api/v1/categories/{category['id']}",
        json={"kind": "income", "group_id": income_group["id"]},
    )
    assert kind_response.status_code == 409
    assert kind_response.json()["error"]["code"] == "category.kind_immutable"

    delete_response = await client.delete(f"/api/v1/categories/{category['id']}")
    assert delete_response.status_code == 409
    assert delete_response.json()["error"]["code"] == "category.in_use"


async def test_reorder_categories(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "olivia@example.com")
    group = await _create_category_group(client)
    first = await _create_category(client, name="First", group_id=group["id"])
    second = await _create_category(client, name="Second", group_id=group["id"])
    third = await _create_category(client, name="Third", group_id=group["id"])

    response = await client.post(
        "/api/v1/categories/reorder",
        json={
            "kind": "expense",
            "group_id": group["id"],
            "ordered_ids": [third["id"], first["id"], second["id"]],
        },
    )
    assert response.status_code == 204

    list_response = await client.get("/api/v1/categories")
    by_id = {row["id"]: row for row in list_response.json()}
    assert by_id[third["id"]]["position"] == 0
    assert by_id[first["id"]]["position"] == 1
    assert by_id[second["id"]]["position"] == 2


async def test_reorder_ignores_ids_outside_the_sibling_group(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "peggy@example.com")
    first_group = await _create_category_group(client, name="First Group")
    second_group = await _create_category_group(client, name="Second Group")
    first = await _create_category(client, name="First", group_id=first_group["id"])
    second = await _create_category(client, name="Second", group_id=first_group["id"])
    outside = await _create_category(client, name="Outside", group_id=second_group["id"])

    response = await client.post(
        "/api/v1/categories/reorder",
        json={
            "kind": "expense",
            "group_id": first_group["id"],
            "ordered_ids": [outside["id"], second["id"], first["id"]],
        },
    )
    assert response.status_code == 204

    list_response = await client.get("/api/v1/categories")
    by_id = {row["id"]: row for row in list_response.json()}
    assert by_id[outside["id"]]["position"] == 0
    assert by_id[second["id"]]["position"] == 0
    assert by_id[first["id"]]["position"] == 1


async def test_category_routes_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/categories")
    assert response.status_code == 401


async def test_category_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "quinn@example.com")
    await _authed(other_client, db_session, "romeo@example.com")
    category = await _create_category(client, name="Quinn's Category")

    patch_response = await other_client.patch(
        f"/api/v1/categories/{category['id']}", json={"name": "Hijacked"}
    )
    assert patch_response.status_code == 404
    assert patch_response.json()["error"]["code"] == "category.not_found"

    delete_response = await other_client.delete(f"/api/v1/categories/{category['id']}")
    assert delete_response.status_code == 404
    assert delete_response.json()["error"]["code"] == "category.not_found"

    list_response = await other_client.get("/api/v1/categories")
    assert all(row["id"] != category["id"] for row in list_response.json())
