from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_category(client: AsyncClient, name: str, kind: str = "expense") -> str:
    group_response = await client.post(
        "/api/v1/category-groups",
        json={"name": f"{name} Group", "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert group_response.status_code == 201, group_response.text
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": name,
            "kind": kind,
            "group_id": group_response.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_account(client: AsyncClient) -> str:
    response = await client.post(
        "/api/v1/accounts",
        json={"name": "Checking", "type": "checking", "currency": "BRL"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _condition(value: str = "rent") -> dict[str, str]:
    return {"field": "description", "op": "contains", "value": value}


async def test_rule_crud_duplicate_and_ownership(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "rules@example.com")
    await _authed(other_client, db_session, "other-rules@example.com")
    category_id = await _create_category(client, "Rent")

    response = await client.post(
        "/api/v1/categorization-rules",
        json={
            "name": "Rent",
            "match_op": "and",
            "conditions": [_condition()],
            "category_id": category_id,
        },
    )
    assert response.status_code == 201, response.text
    rule_id = response.json()["id"]
    assert response.json()["priority"] == 10

    duplicate = await client.post(
        "/api/v1/categorization-rules",
        json={
            "name": "Rent",
            "match_op": "and",
            "conditions": [_condition()],
            "category_id": category_id,
        },
    )
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["error"]["code"] == "categorization_rule.duplicate_name"

    foreign_patch = await other_client.patch(
        f"/api/v1/categorization-rules/{rule_id}", json={"priority": 1}
    )
    assert foreign_patch.status_code == 404
    assert foreign_patch.json()["error"]["code"] == "categorization_rule.not_found"

    updated = await client.patch(
        f"/api/v1/categorization-rules/{rule_id}", json={"priority": 1, "is_active": False}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["priority"] == 1
    assert updated.json()["is_active"] is False

    deleted = await client.delete(f"/api/v1/categorization-rules/{rule_id}")
    assert deleted.status_code == 204, deleted.text


async def test_rule_validation_codes(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "validation-rules@example.com")
    category_id = await _create_category(client, "Food")
    cases = [
        (
            {"field": "amount", "op": "contains", "value": "1"},
            "categorization_rule.invalid_operator",
        ),
        ({"field": "amount", "op": "equals", "value": "abc"}, "categorization_rule.invalid_amount"),
        (
            {"field": "type", "op": "equals", "value": "transfer"},
            "categorization_rule.invalid_type_value",
        ),
        (
            {"field": "description", "op": "regex", "value": ".*"},
            "categorization_rule.invalid_regex",
        ),
        (
            {"field": "description", "op": "contains", "value": "  "},
            "categorization_rule.blank_value",
        ),
    ]
    for condition, code in cases:
        response = await client.post(
            "/api/v1/categorization-rules",
            json={
                "name": code,
                "match_op": "and",
                "conditions": [condition],
                "category_id": category_id,
            },
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == code

    top_level_empty = await client.post(
        "/api/v1/categorization-rules",
        json={
            "name": "categorization_rule.no_conditions.top",
            "match_op": "and",
            "conditions": [],
            "category_id": category_id,
        },
    )
    assert top_level_empty.status_code == 422, top_level_empty.text
    assert top_level_empty.json()["error"]["code"] == "categorization_rule.no_conditions"

    group_empty = await client.post(
        "/api/v1/categorization-rules",
        json={
            "name": "categorization_rule.no_conditions.group",
            "match_op": "and",
            "conditions": [{"op": "or", "conditions": []}],
            "category_id": category_id,
        },
    )
    assert group_empty.status_code == 422, group_empty.text
    assert group_empty.json()["error"]["code"] == "categorization_rule.no_conditions"


async def test_import_resolves_categories_and_skips_collisions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "import-rules@example.com")
    await _create_category(client, "Food")
    payload = {
        "rules": [
            {
                "name": "Groceries",
                "match_op": "and",
                "conditions": [_condition("market")],
                "category": "food",
            },
            {
                "name": "Unknown",
                "match_op": "and",
                "conditions": [_condition("x")],
                "category": "Missing",
            },
        ]
    }
    imported = await client.post("/api/v1/categorization-rules/import", json=payload)
    assert imported.status_code == 200, imported.text
    assert imported.json() == {"imported": 1, "skipped": 1}

    collision = await client.post("/api/v1/categorization-rules/import", json=payload)
    assert collision.status_code == 200, collision.text
    assert collision.json() == {"imported": 0, "skipped": 2}

    replaced = await client.post(
        "/api/v1/categorization-rules/import",
        json={"replace": True, "rules": [payload["rules"][0]]},
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json() == {"imported": 1, "skipped": 0}


async def test_rule_packs_list_and_install(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "rule-packs@example.com")
    category_id = await _create_category(client, "Public Transport")

    listed = await client.get("/api/v1/categorization-rules/packs")
    assert listed.status_code == 200, listed.text
    assert listed.json() == [
        {"code": "BR", "rule_count": 14, "installed": False},
        {"code": "US", "rule_count": 15, "installed": False},
    ]

    installed = await client.post("/api/v1/categorization-rules/packs/br/install")
    assert installed.status_code == 200, installed.text
    assert installed.json() == {"installed": 1, "skipped": 13}

    rules = await client.get("/api/v1/categorization-rules")
    assert rules.status_code == 200, rules.text
    assert rules.json() == [
        {
            "id": rules.json()[0]["id"],
            "name": "Uber / 99",
            "priority": 10,
            "is_active": True,
            "match_op": "or",
            "conditions": [
                {"field": "description", "op": "starts_with", "value": "UBER"},
                {"field": "description", "op": "starts_with", "value": "99 "},
                {"field": "description", "op": "contains", "value": "99APP"},
            ],
            "category_id": category_id,
        }
    ]

    missing = await client.post("/api/v1/categorization-rules/packs/CA/install")
    assert missing.status_code == 404, missing.text
    assert missing.json()["error"]["code"] == "rule_pack.not_found"


async def test_reapply_respects_overwrite_and_rule_priority(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "reapply-rules@example.com")
    old_category_id = await _create_category(client, "Old")
    new_category_id = await _create_category(client, "New")
    account_id = await _create_account(client)
    transaction = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-08-28",
            "amount": "25.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": old_category_id,
            "description": "Coffee shop",
        },
    )
    assert transaction.status_code == 201, transaction.text
    rule = await client.post(
        "/api/v1/categorization-rules",
        json={
            "name": "Coffee",
            "match_op": "and",
            "conditions": [_condition("coffee")],
            "category_id": new_category_id,
        },
    )
    assert rule.status_code == 201, rule.text

    unchanged = await client.post("/api/v1/categorization-rules/reapply", json={})
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json() == {"updated": 0}

    overwritten = await client.post(
        "/api/v1/categorization-rules/reapply", json={"overwrite": True}
    )
    assert overwritten.status_code == 200, overwritten.text
    assert overwritten.json() == {"updated": 1}
    fetched = await client.get(f"/api/v1/transactions/{transaction.json()['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["category_id"] == new_category_id
