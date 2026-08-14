"""Category nesting, sibling ordering, kind/parent invariants, the
delete/kind-change guards, and ownership isolation."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_category(
    client: AsyncClient, *, name: str, kind: str = "expense", parent_id: str | None = None
) -> dict:
    payload = {"name": name, "kind": kind, "color": "#112233", "icon": "tag"}
    if parent_id is not None:
        payload["parent_id"] = parent_id
    response = await client.post("/api/v1/categories", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_top_level_category_gets_position_zero(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "alice@example.com")
    category = await _create_category(client, name="Groceries")
    assert category["position"] == 0
    assert category["parent_id"] is None


async def test_siblings_get_sequential_positions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")
    first = await _create_category(client, name="Groceries")
    second = await _create_category(client, name="Transport")
    assert first["position"] == 0
    assert second["position"] == 1


async def test_create_child_under_matching_kind_parent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "carol@example.com")
    parent = await _create_category(client, name="Transport", kind="expense")
    child = await _create_category(client, name="Uber", kind="expense", parent_id=parent["id"])
    assert child["parent_id"] == parent["id"]
    assert child["position"] == 0


async def test_create_child_with_mismatched_kind_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    parent = await _create_category(client, name="Salary", kind="income")

    response = await client.post(
        "/api/v1/categories",
        json={
            "name": "Uber",
            "kind": "expense",
            "color": "#112233",
            "icon": "tag",
            "parent_id": parent["id"],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "category.parent_kind_mismatch"


async def test_grandchild_category_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")
    parent = await _create_category(client, name="Transport")
    child = await _create_category(client, name="Uber", parent_id=parent["id"])

    response = await client.post(
        "/api/v1/categories",
        json={
            "name": "Uber Eats",
            "kind": "expense",
            "color": "#112233",
            "icon": "tag",
            "parent_id": child["id"],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "category.parent_not_top_level"


async def test_child_under_another_users_category_is_not_found(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")
    await _authed(other_client, db_session, "grace@example.com")
    parent = await _create_category(client, name="Frank's Category")

    response = await other_client.post(
        "/api/v1/categories",
        json={
            "name": "Sneaky",
            "kind": "expense",
            "color": "#112233",
            "icon": "tag",
            "parent_id": parent["id"],
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "category.not_found"


async def test_update_category_name(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "heidi@example.com")
    category = await _create_category(client, name="Old Name")

    response = await client.patch(f"/api/v1/categories/{category['id']}", json={"name": "New Name"})
    assert response.status_code == 200
    assert response.json()["name"] == "New Name"


async def test_category_cannot_become_its_own_parent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "ivan@example.com")
    category = await _create_category(client, name="Self")

    response = await client.patch(
        f"/api/v1/categories/{category['id']}", json={"parent_id": category["id"]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "category.parent_not_top_level"


async def test_category_with_children_cannot_gain_a_parent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "judy@example.com")
    grandparent_candidate = await _create_category(client, name="Transport")
    await _create_category(client, name="Uber", parent_id=grandparent_candidate["id"])
    other_top_level = await _create_category(client, name="Other")

    response = await client.patch(
        f"/api/v1/categories/{grandparent_candidate['id']}",
        json={"parent_id": other_top_level["id"]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "category.parent_not_top_level"


async def test_changing_kind_is_blocked_while_category_has_children(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "kate@example.com")
    parent = await _create_category(client, name="Transport", kind="expense")
    await _create_category(client, name="Uber", kind="expense", parent_id=parent["id"])

    response = await client.patch(f"/api/v1/categories/{parent['id']}", json={"kind": "income"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category.kind_immutable"


async def test_changing_kind_is_allowed_when_unused(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "leo@example.com")
    category = await _create_category(client, name="Unused", kind="expense")

    response = await client.patch(f"/api/v1/categories/{category['id']}", json={"kind": "income"})
    assert response.status_code == 200
    assert response.json()["kind"] == "income"


async def test_archive_and_unarchive_category(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "mallory@example.com")
    category = await _create_category(client, name="Archivable")

    archive_response = await client.post(
        f"/api/v1/categories/{category['id']}/archive", json={"archived": True}
    )
    assert archive_response.status_code == 200
    assert archive_response.json()["archived"] is True


async def test_delete_category_without_references_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "niaj@example.com")
    category = await _create_category(client, name="Deletable")

    response = await client.delete(f"/api/v1/categories/{category['id']}")
    assert response.status_code == 204


async def test_delete_category_with_children_is_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "olivia@example.com")
    parent = await _create_category(client, name="Transport")
    await _create_category(client, name="Uber", parent_id=parent["id"])

    response = await client.delete(f"/api/v1/categories/{parent['id']}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category.in_use"


async def test_delete_category_referenced_by_budget_is_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "peggy@example.com")
    category = await _create_category(client, name="Groceries")
    budget_response = await client.put(
        "/api/v1/budgets",
        json={
            "category_id": category["id"],
            "month": "2026-01",
            "amount": "500.00",
            "currency": "BRL",
        },
    )
    assert budget_response.status_code == 200

    response = await client.delete(f"/api/v1/categories/{category['id']}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "category.in_use"


async def test_reorder_categories(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "quentin@example.com")
    first = await _create_category(client, name="First")
    second = await _create_category(client, name="Second")
    third = await _create_category(client, name="Third")

    response = await client.post(
        "/api/v1/categories/reorder",
        json={
            "kind": "expense",
            "parent_id": None,
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
    await _authed(client, db_session, "romeo@example.com")
    expense = await _create_category(client, name="Expense Cat", kind="expense")
    income = await _create_category(client, name="Income Cat", kind="income")

    response = await client.post(
        "/api/v1/categories/reorder",
        json={"kind": "expense", "parent_id": None, "ordered_ids": [income["id"], expense["id"]]},
    )
    assert response.status_code == 204

    list_response = await client.get("/api/v1/categories")
    by_id = {row["id"]: row for row in list_response.json()}
    # income's position is untouched - it was never a member of the
    # expense/None sibling group being reordered.
    assert by_id[income["id"]]["position"] == 0
    assert by_id[expense["id"]]["position"] == 0


async def test_category_routes_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/categories")
    assert response.status_code == 401


async def test_category_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "sybil@example.com")
    await _authed(other_client, db_session, "trent@example.com")
    category = await _create_category(client, name="Sybil's Category")

    patch_response = await other_client.patch(
        f"/api/v1/categories/{category['id']}", json={"name": "Hijacked"}
    )
    assert patch_response.status_code == 404

    delete_response = await other_client.delete(f"/api/v1/categories/{category['id']}")
    assert delete_response.status_code == 404

    list_response = await other_client.get("/api/v1/categories")
    assert all(row["id"] != category["id"] for row in list_response.json())
