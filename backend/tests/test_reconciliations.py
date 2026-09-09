from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db: AsyncSession, email: str) -> None:
    user, password = await make_user(db, email=email)
    await login_as(client, email=user.email, password=password)


async def _account(
    client: AsyncClient,
    name: str = "Checking",
    currency: str = "BRL",
    opening_balance: str = "0.0000",
) -> str:
    response = await client.post(
        "/api/v1/accounts",
        json={
            "name": name,
            "type": "checking",
            "currency": currency,
            "opening_balance": opening_balance,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _expense_category(client: AsyncClient) -> str:
    group = await client.post(
        "/api/v1/category-groups",
        json={"name": "Food", "kind": "expense", "color": "#112233", "icon": "tag"},
    )
    assert group.status_code == 201, group.text
    category = await client.post(
        "/api/v1/categories",
        json={
            "name": "Groceries",
            "kind": "expense",
            "group_id": group.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert category.status_code == 201, category.text
    return category.json()["id"]


async def _expense(
    client: AsyncClient, account_id: str, category_id: str, date: str, amount: str
) -> str:
    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": date,
            "amount": amount,
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Groceries",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _start(
    client: AsyncClient, account_id: str, balance: str, date: str = "2026-01-31"
) -> dict:
    response = await client.post(
        "/api/v1/reconciliations",
        json={"account_id": account_id, "statement_date": date, "statement_balance": balance},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_reconciliation_copies_currency_and_enforces_open_account_rule(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "reconciliation-create@example.com")
    account_id = await _account(client, currency="USD")
    created = await _start(client, account_id, "100.0000")
    assert created["status"] == "open"
    assert created["currency"] == "USD"

    duplicate = await client.post(
        "/api/v1/reconciliations",
        json={"account_id": account_id, "statement_date": "2026-02-28", "statement_balance": "100"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "reconciliation.already_open"

    archived = await client.post(f"/api/v1/accounts/{account_id}/archive", json={"archived": True})
    assert archived.status_code == 200
    other_account = await _account(client, name="Archived", currency="USD")
    await client.post(f"/api/v1/accounts/{other_account}/archive", json={"archived": True})
    response = await client.post(
        "/api/v1/reconciliations",
        json={
            "account_id": other_account,
            "statement_date": "2026-01-31",
            "statement_balance": "0",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "reconciliation.account_archived"


async def test_clearing_expense_reaches_zero_and_completes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "reconciliation-clear@example.com")
    account_id = await _account(client, opening_balance="100.0000")
    category_id = await _expense_category(client)
    transaction_id = await _expense(client, account_id, category_id, "2026-01-10", "20.0000")
    reconciliation = await _start(client, account_id, "80.0000")

    detail = await client.get(f"/api/v1/reconciliations/{reconciliation['id']}")
    assert detail.json()["book_balance"] == "80.0000"
    assert detail.json()["cleared_balance"] == "100.0000"
    assert detail.json()["difference"] == "-20.0000"

    marked = await client.post(
        f"/api/v1/reconciliations/{reconciliation['id']}/entries",
        json={"transaction_ids": [transaction_id], "cleared": True},
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["cleared_balance"] == "80.0000"
    assert marked.json()["difference"] == "0.0000"
    completed = await client.post(f"/api/v1/reconciliations/{reconciliation['id']}/complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"


async def test_future_transaction_is_not_a_reconciliation_candidate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "reconciliation-date@example.com")
    account_id = await _account(client, opening_balance="100.0000")
    category_id = await _expense_category(client)
    await _expense(client, account_id, category_id, "2026-02-01", "20.0000")
    reconciliation = await _start(client, account_id, "100.0000", "2026-01-31")
    detail = await client.get(f"/api/v1/reconciliations/{reconciliation['id']}")
    assert detail.json()["book_balance"] == "100.0000"
    assert detail.json()["cleared_balance"] == "100.0000"
    assert detail.json()["entries"] == []


async def test_cross_currency_transfer_has_independent_legs(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "reconciliation-transfer@example.com")
    source_id = await _account(client, "Dollar", "USD", "1000.0000")
    destination_id = await _account(client, "Real", "BRL")
    transfer = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-10",
            "amount": "100.0000",
            "currency": "USD",
            "account_id": source_id,
            "to_account_id": destination_id,
            "description": "Move money",
            "conversion": {"currency": "BRL", "rate": "5.2", "source": "manual"},
        },
    )
    assert transfer.status_code == 201, transfer.text
    transaction_id = transfer.json()["id"]
    source_reconciliation = await _start(client, source_id, "900.0000")
    destination_reconciliation = await _start(client, destination_id, "520.0000")

    source_detail = await client.get(f"/api/v1/reconciliations/{source_reconciliation['id']}")
    destination_detail = await client.get(
        f"/api/v1/reconciliations/{destination_reconciliation['id']}"
    )
    assert [(row["leg"], row["amount"]) for row in source_detail.json()["entries"]] == [
        ("own", "-100.0000")
    ]
    assert [(row["leg"], row["amount"]) for row in destination_detail.json()["entries"]] == [
        ("incoming", "520.0000")
    ]

    marked = await client.post(
        f"/api/v1/reconciliations/{source_reconciliation['id']}/entries",
        json={"transaction_ids": [transaction_id], "cleared": True},
    )
    assert marked.status_code == 200
    destination_detail = await client.get(
        f"/api/v1/reconciliations/{destination_reconciliation['id']}"
    )
    assert destination_detail.json()["entries"][0]["cleared"] is False

    marked = await client.post(
        f"/api/v1/reconciliations/{destination_reconciliation['id']}/entries",
        json={"transaction_ids": [transaction_id], "cleared": True},
    )
    assert marked.status_code == 200
    assert marked.json()["entries"][0]["cleared"] is True


async def test_card_invoice_payment_is_one_candidate_on_paying_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "reconciliation-card@example.com")
    paying_id = await _account(client, "Paying", "BRL", "100.0000")
    card = await client.post(
        "/api/v1/accounts",
        json={"name": "Card", "type": "credit_card", "currency": "BRL"},
    )
    assert card.status_code == 201, card.text
    card_id = card.json()["id"]
    transfer = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-10",
            "amount": "100.0000",
            "currency": "BRL",
            "account_id": paying_id,
            "to_account_id": card_id,
            "description": "Pay card",
            "card_invoice_close_date": "2026-01-01",
        },
    )
    assert transfer.status_code == 201, transfer.text
    reconciliation = await _start(client, paying_id, "0.0000")
    detail = await client.get(f"/api/v1/reconciliations/{reconciliation['id']}")
    assert len(detail.json()["entries"]) == 1
    assert detail.json()["entries"][0]["amount"] == "-100.0000"


async def test_non_zero_difference_and_reconciled_transaction_guards(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "reconciliation-guards@example.com")
    account_id = await _account(client, opening_balance="100.0000")
    category_id = await _expense_category(client)
    transaction_id = await _expense(client, account_id, category_id, "2026-01-10", "20.0000")
    reconciliation = await _start(client, account_id, "80.0000")
    await client.post(
        f"/api/v1/reconciliations/{reconciliation['id']}/entries",
        json={"transaction_ids": [transaction_id], "cleared": True},
    )

    amount = await client.patch(
        f"/api/v1/transactions/{transaction_id}", json={"amount": "25.0000"}
    )
    assert amount.status_code == 409
    assert amount.json()["error"]["code"] == "transaction.reconciled"
    description = await client.patch(
        f"/api/v1/transactions/{transaction_id}", json={"description": "Updated"}
    )
    assert description.status_code == 200
    deleted = await client.delete(f"/api/v1/transactions/{transaction_id}")
    assert deleted.status_code == 409

    other_account = await _account(client, "Other", opening_balance="100.0000")
    other_reconciliation = await _start(client, other_account, "0.0000")
    mismatch = await client.post(f"/api/v1/reconciliations/{other_reconciliation['id']}/complete")
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "reconciliation.difference_not_zero"


async def test_reconciliation_is_owner_scoped(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "reconciliation-owner@example.com")
    account_id = await _account(client)
    reconciliation = await _start(client, account_id, "0.0000")
    await _authed(other_client, db_session, "reconciliation-other@example.com")
    detail = await other_client.get(f"/api/v1/reconciliations/{reconciliation['id']}")
    assert detail.status_code == 404
    assert detail.json()["error"]["code"] == "reconciliation.not_found"
    mutation = await other_client.post(f"/api/v1/reconciliations/{reconciliation['id']}/reopen")
    assert mutation.status_code == 404
