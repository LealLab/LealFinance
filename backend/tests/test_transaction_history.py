from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.transaction_history import TransactionHistory
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db: AsyncSession, email: str) -> None:
    user, password = await make_user(db, email=email)
    await login_as(client, email=user.email, password=password)


async def _account(client: AsyncClient) -> str:
    response = await client.post(
        "/api/v1/accounts", json={"name": "Checking", "type": "checking", "currency": "BRL"}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _category(client: AsyncClient) -> str:
    group = await client.post(
        "/api/v1/category-groups",
        json={"name": "Food", "kind": "expense", "color": "#112233", "icon": "tag"},
    )
    assert group.status_code == 201, group.text
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": "Groceries",
            "kind": "expense",
            "group_id": group.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _item(account_id: str, category_id: str, index: int = 0) -> dict[str, str]:
    return {
        "type": "expense",
        "date": f"2026-01-{index % 28 + 1:02d}",
        "amount": f"{index + 1}.0000",
        "currency": "BRL",
        "account_id": account_id,
        "category_id": category_id,
        "description": f"Imported {index}",
    }


async def test_create_update_delete_history_survives_delete(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "history-crud@example.com")
    account_id = await _account(client)
    category_id = await _category(client)
    created = await client.post("/api/v1/transactions", json=_item(account_id, category_id, 49))
    assert created.status_code == 201, created.text
    transaction_id = created.json()["id"]

    history = await client.get(f"/api/v1/transactions/{transaction_id}/history")
    assert history.status_code == 200
    assert len(history.json()) == 1
    assert history.json()[0]["operation"] == "create"
    assert history.json()[0]["source"] == "manual"
    assert history.json()[0]["before"] is None
    assert history.json()[0]["after"]["amount"] == "50.0000"

    updated = await client.patch(
        f"/api/v1/transactions/{transaction_id}", json={"amount": "60.0000"}
    )
    assert updated.status_code == 200, updated.text
    history = await client.get(f"/api/v1/transactions/{transaction_id}/history")
    update = history.json()[-1]
    assert update["operation"] == "update"
    assert update["before"]["amount"] == "50.0000"
    assert update["after"]["amount"] == "60.0000"
    assert update["before"] != update["after"]

    deleted = await client.delete(f"/api/v1/transactions/{transaction_id}")
    assert deleted.status_code == 204
    rows = (
        (
            await db_session.execute(
                select(TransactionHistory).where(
                    TransactionHistory.transaction_id == transaction_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows[-1].operation == "delete"
    assert rows[-1].before is not None
    assert rows[-1].before["amount"] == "60.0000"
    assert rows[-1].after is None

    # The audit trail stays reachable through the API after the delete.
    history = await client.get(f"/api/v1/transactions/{transaction_id}/history")
    assert history.status_code == 200
    assert [row["operation"] for row in history.json()] == ["create", "update", "delete"]
    assert history.json()[-1]["before"]["amount"] == "60.0000"


async def test_import_history_is_idempotent_and_batch_counts_remaining(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "history-import@example.com")
    account_id = await _account(client)
    category_id = await _category(client)
    items = [_item(account_id, category_id, index) for index in range(3)]
    payload = {"idempotency_key": "history-batch-1", "items": items}

    imported = await client.post("/api/v1/transactions/import", json=payload)
    assert imported.status_code == 201, imported.text
    replay = await client.post("/api/v1/transactions/import", json=payload)
    assert replay.status_code == 201, replay.text

    batches = await client.get("/api/v1/transactions/import/batches")
    assert batches.status_code == 200
    batch = batches.json()[0]
    assert batch["created_count"] == 3
    assert batch["remaining_count"] == 3
    batch_id = batch["id"]
    history_count = await db_session.scalar(
        select(func.count(TransactionHistory.id)).where(
            TransactionHistory.batch_id == batch_id,
            TransactionHistory.operation == "create",
        )
    )
    assert history_count == 3

    transactions = (await client.get(f"/api/v1/transactions/import/batches/{batch_id}")).json()
    assert len(transactions) == 3
    history_rows = (
        (
            await db_session.execute(
                select(TransactionHistory).where(TransactionHistory.batch_id == batch_id)
            )
        )
        .scalars()
        .all()
    )
    assert len([row for row in history_rows if row.operation == "create"]) == 3

    deleted = await client.delete(f"/api/v1/transactions/{transactions[0]['id']}")
    assert deleted.status_code == 204
    assert (await client.get("/api/v1/transactions/import/batches")).json()[0][
        "remaining_count"
    ] == 2

    undone = await client.delete(f"/api/v1/transactions/import/batches/{batch_id}")
    assert undone.status_code == 204
    assert (await client.get(f"/api/v1/transactions/import/batches/{batch_id}")).json() == []
    assert (
        await client.delete(f"/api/v1/transactions/import/batches/{batch_id}")
    ).status_code == 204


async def test_undo_import_batch_rejects_updated_row(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "history-undo-conflict@example.com")
    account_id = await _account(client)
    category_id = await _category(client)
    item = _item(account_id, category_id)
    imported = await client.post(
        "/api/v1/transactions/import",
        json={"idempotency_key": "history-batch-2", "items": [item]},
    )
    assert imported.status_code == 201, imported.text
    batch_id = (await client.get("/api/v1/transactions/import/batches")).json()[0]["id"]
    transaction_id = (await client.get(f"/api/v1/transactions/import/batches/{batch_id}")).json()[
        0
    ]["id"]
    updated = await client.patch(
        f"/api/v1/transactions/{transaction_id}", json={"amount": "9.0000"}
    )
    assert updated.status_code == 200, updated.text

    response = await client.delete(f"/api/v1/transactions/import/batches/{batch_id}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "import.batch_modified"


async def test_transaction_history_is_owner_scoped(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "history-owner@example.com")
    account_id = await _account(client)
    category_id = await _category(client)
    created = await client.post("/api/v1/transactions", json=_item(account_id, category_id))
    transaction_id = created.json()["id"]

    await _authed(other_client, db_session, "history-other@example.com")
    response = await other_client.get(f"/api/v1/transactions/{transaction_id}/history")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "transaction.not_found"
