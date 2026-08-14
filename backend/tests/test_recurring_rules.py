"""Recurring rule CRUD, template validation (reusing transaction shape
rules), and ownership isolation."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_account(
    client: AsyncClient, name: str = "Checking", currency: str = "BRL"
) -> str:
    response = await client.post(
        "/api/v1/accounts", json={"name": name, "type": "checking", "currency": currency}
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_category(client: AsyncClient, name: str = "Rent", kind: str = "expense") -> str:
    response = await client.post(
        "/api/v1/categories",
        json={"name": name, "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_create_recurring_rule(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "1500.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Rent",
            },
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["frequency"] == "monthly"
    assert body["template"]["amount"] == "1500.0000"
    assert body["template"]["description"] == "Rent"


async def test_end_date_before_start_date_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-06-01",
            "end_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "100.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Bad dates",
            },
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "recurring_rule.end_before_start"


async def test_template_reuses_transaction_shape_validation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A transfer template with a category is invalid for the same reason
    a real transaction would be - the two share validation logic."""
    await _authed(client, db_session, "carol@example.com")
    source_id = await _create_account(client, name="Checking")
    dest_id = await _create_account(client, name="Savings")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "transfer",
                "amount": "200.00",
                "currency": "BRL",
                "account_id": source_id,
                "to_account_id": dest_id,
                "category_id": category_id,
                "description": "Bad transfer template",
            },
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.transfer_has_category"


async def test_transfer_template_currency_must_match_source_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "template-currency@example.com")
    source_id = await _create_account(client, name="Dollar source", currency="USD")
    dest_id = await _create_account(client, name="Real destination", currency="BRL")

    response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "transfer",
                "amount": "200.00",
                "currency": "BRL",
                "account_id": source_id,
                "to_account_id": dest_id,
                "description": "Wrong source currency",
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.currency_must_match_source_account"


async def test_template_with_foreign_account_is_not_found(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    await _authed(other_client, db_session, "erin@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)

    response = await other_client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "100.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Sneaky",
            },
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "account.not_found"


async def test_update_recurring_rule_frequency(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    create_response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "100.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Original",
            },
        },
    )
    rule_id = create_response.json()["id"]

    response = await client.patch(
        f"/api/v1/recurring-rules/{rule_id}", json={"frequency": "yearly"}
    )
    assert response.status_code == 200
    assert response.json()["frequency"] == "yearly"
    # template untouched by a frequency-only PATCH
    assert response.json()["template"]["description"] == "Original"


async def test_update_recurring_rule_replaces_template_in_full(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    create_response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "100.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Original",
            },
        },
    )
    rule_id = create_response.json()["id"]

    response = await client.patch(
        f"/api/v1/recurring-rules/{rule_id}",
        json={
            "template": {
                "type": "expense",
                "amount": "250.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Replaced",
            }
        },
    )
    assert response.status_code == 200
    assert response.json()["template"]["amount"] == "250.0000"
    assert response.json()["template"]["description"] == "Replaced"


async def test_delete_recurring_rule(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "heidi@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    create_response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "weekly",
            "interval": 2,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "50.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Deletable",
            },
        },
    )
    rule_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/recurring-rules/{rule_id}")
    assert delete_response.status_code == 204

    list_response = await client.get("/api/v1/recurring-rules")
    assert all(row["id"] != rule_id for row in list_response.json())


async def test_transaction_can_reference_a_recurring_rule(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "ivan@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    rule_response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "1500.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Rent",
            },
        },
    )
    rule_id = rule_response.json()["id"]

    transaction_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "1500.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Rent",
            "recurring_rule_id": rule_id,
        },
    )
    assert transaction_response.status_code == 201
    assert transaction_response.json()["recurring_rule_id"] == rule_id


async def test_recurring_rule_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "judy@example.com")
    await _authed(other_client, db_session, "kate@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    create_response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "100.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Judy's rule",
            },
        },
    )
    rule_id = create_response.json()["id"]

    patch_response = await other_client.patch(
        f"/api/v1/recurring-rules/{rule_id}", json={"frequency": "yearly"}
    )
    assert patch_response.status_code == 404
    assert patch_response.json()["error"]["code"] == "recurring_rule.not_found"

    delete_response = await other_client.delete(f"/api/v1/recurring-rules/{rule_id}")
    assert delete_response.status_code == 404
