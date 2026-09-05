"""HTTP coverage for user-owned Pluggy credential management."""

from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.pluggy_client as pluggy_client
from app.core.crypto import decrypt_secret
from app.models.account import Account
from app.models.categorization_rule import CategorizationRule
from app.models.category import Category
from app.models.category_group import CategoryGroup
from app.models.open_finance import PluggyAccount, PluggyCredential, PluggyItem
from app.models.transaction import Transaction
from app.services import accounts as accounts_service
from app.services.open_finance_sync import (
    map_account_type,
    map_transaction_amount,
    normalize_synced_balance,
    reconcile_opening_balance,
)
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def test_credentials_link_status_unlink_round_trip(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "pluggy-credentials@example.com")

    initial = await client.get("/api/v1/open-finance/credentials")
    assert initial.status_code == 200
    assert initial.json() == {"configured": False, "environment": None}

    linked = await client.put(
        "/api/v1/open-finance/credentials",
        json={
            "client_id": "pluggy-client-id",
            "client_secret": "pluggy-client-secret",
            "environment": "production",
        },
    )
    assert linked.status_code == 200
    assert linked.json() == {"configured": True, "environment": "production"}
    assert "pluggy-client-id" not in linked.text
    assert "pluggy-client-secret" not in linked.text

    row = (await db_session.execute(select(PluggyCredential))).scalar_one()
    assert decrypt_secret(row.client_id_ciphertext) == "pluggy-client-id"
    assert decrypt_secret(row.client_secret_ciphertext) == "pluggy-client-secret"

    deleted = await client.delete("/api/v1/open-finance/credentials")
    assert deleted.status_code == 204

    after = await client.get("/api/v1/open-finance/credentials")
    assert after.status_code == 200
    assert after.json() == {"configured": False, "environment": None}
    assert "pluggy-client-id" not in after.text
    assert "pluggy-client-secret" not in after.text


async def test_credentials_are_isolated_between_users(
    client: AsyncClient,
    other_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    await _authed(client, db_session, "pluggy-owner@example.com")
    await _authed(other_client, db_session, "pluggy-other@example.com")

    linked = await client.put(
        "/api/v1/open-finance/credentials",
        json={
            "client_id": "owner-client-id",
            "client_secret": "owner-client-secret",
            "environment": "sandbox",
        },
    )
    assert linked.status_code == 200

    other_status = await other_client.get("/api/v1/open-finance/credentials")
    assert other_status.status_code == 200
    assert other_status.json() == {"configured": False, "environment": None}
    assert "owner-client-id" not in other_status.text
    assert "owner-client-secret" not in other_status.text

    other_delete = await other_client.delete("/api/v1/open-finance/credentials")
    assert other_delete.status_code == 404
    assert other_delete.json()["error"]["code"] == "pluggy_credential.not_found"

    owner_status = await client.get("/api/v1/open-finance/credentials")
    assert owner_status.json() == {"configured": True, "environment": "sandbox"}


def _stub_pluggy(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    deleted: list[str] = []

    async def authenticate(_client_id: str, _client_secret: str) -> str:
        return "api-key"

    async def get_item(_api_key: str, item_id: str) -> dict[str, object]:
        return {
            "id": item_id,
            "connectorId": 42,
            "status": "UPDATED",
            "executionStatus": "SUCCESS",
            "statusDetail": {"code": "OK"},
            "consentExpiresAt": "2027-09-05T00:00:00Z",
        }

    async def get_connector(_api_key: str, connector_id: int) -> dict[str, object]:
        assert connector_id == 42
        return {"id": connector_id, "name": "Test Bank", "imageUrl": "https://bank.test/icon"}

    async def delete_item(_api_key: str, item_id: str) -> None:
        deleted.append(item_id)

    monkeypatch.setattr(pluggy_client, "authenticate", authenticate)
    monkeypatch.setattr(pluggy_client, "get_item", get_item)
    monkeypatch.setattr(pluggy_client, "get_connector", get_connector)
    monkeypatch.setattr(pluggy_client, "delete_item", delete_item)
    return deleted


async def _link_pluggy_credentials(client: AsyncClient) -> None:
    response = await client.put(
        "/api/v1/open-finance/credentials",
        json={
            "client_id": "client-id",
            "client_secret": "client-secret",
            "environment": "sandbox",
        },
    )
    assert response.status_code == 200


async def test_item_register_list_and_get(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _authed(client, db_session, "pluggy-item@example.com")
    await _link_pluggy_credentials(client)
    _stub_pluggy(monkeypatch)

    registered = await client.post("/api/v1/open-finance/items", json={"external_id": "item-1"})
    assert registered.status_code == 201, registered.text
    body = registered.json()
    assert body["external_id"] == "item-1"
    assert body["connector_name"] == "Test Bank"

    listed = await client.get("/api/v1/open-finance/items")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [body["id"]]

    fetched = await client.get(f"/api/v1/open-finance/items/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]


async def test_item_ownership_returns_resource_specific_404(
    client: AsyncClient,
    other_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _authed(client, db_session, "pluggy-item-owner@example.com")
    await _authed(other_client, db_session, "pluggy-item-other@example.com")
    await _link_pluggy_credentials(client)
    _stub_pluggy(monkeypatch)

    registered = await client.post("/api/v1/open-finance/items", json={"external_id": "item-owner"})
    item_id = registered.json()["id"]

    response = await other_client.get(f"/api/v1/open-finance/items/{item_id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "pluggy_item.not_found"


async def test_disconnect_keep_preserves_ledger_rows_and_delete_removes_them(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, password = await make_user(db_session, email="pluggy-disconnect@example.com")
    await login_as(client, email=user.email, password=password)
    await _link_pluggy_credentials(client)
    deleted = _stub_pluggy(monkeypatch)

    keep_item = (
        await client.post("/api/v1/open-finance/items", json={"external_id": "item-keep"})
    ).json()
    keep_account = Account(
        user_id=user.id,
        name="Keep account",
        type="checking",
        currency="BRL",
        opening_balance=Decimal("0"),
    )
    db_session.add(keep_account)
    await db_session.flush()
    db_session.add_all(
        [
            Transaction(
                user_id=user.id,
                type="expense",
                date=date.today(),
                amount=Decimal("10"),
                currency="BRL",
                account_id=keep_account.id,
                description="Keep transaction",
            ),
            PluggyAccount(
                user_id=user.id,
                pluggy_item_id=UUID(keep_item["id"]),
                account_id=keep_account.id,
                external_id="account-keep",
                type="BANK",
                subtype="CHECKING",
                name="Keep account",
                number="****1234",
                currency="BRL",
                synced_balance=Decimal("10"),
                raw={},
            ),
        ]
    )
    await db_session.commit()

    kept = await client.delete(f"/api/v1/open-finance/items/{keep_item['id']}?mode=keep")
    assert kept.status_code == 204
    assert await db_session.scalar(select(Account.id).where(Account.id == keep_account.id))
    assert await db_session.scalar(
        select(Transaction.id).where(Transaction.account_id == keep_account.id)
    )

    delete_item = (
        await client.post("/api/v1/open-finance/items", json={"external_id": "item-delete"})
    ).json()
    delete_account = Account(
        user_id=user.id,
        name="Delete account",
        type="checking",
        currency="BRL",
        opening_balance=Decimal("0"),
    )
    db_session.add(delete_account)
    await db_session.flush()
    db_session.add_all(
        [
            Transaction(
                user_id=user.id,
                type="expense",
                date=date.today(),
                amount=Decimal("20"),
                currency="BRL",
                account_id=delete_account.id,
                description="Delete transaction",
            ),
            PluggyAccount(
                user_id=user.id,
                pluggy_item_id=UUID(delete_item["id"]),
                account_id=delete_account.id,
                external_id="account-delete",
                type="BANK",
                subtype="CHECKING",
                name="Delete account",
                number="****5678",
                currency="BRL",
                synced_balance=Decimal("20"),
                raw={},
            ),
        ]
    )
    await db_session.commit()

    removed = await client.delete(f"/api/v1/open-finance/items/{delete_item['id']}?mode=delete")
    assert removed.status_code == 204
    assert (
        await db_session.scalar(select(Account.id).where(Account.id == delete_account.id)) is None
    )
    assert (
        await db_session.scalar(
            select(Transaction.id).where(Transaction.account_id == delete_account.id)
        )
        is None
    )
    assert deleted == ["item-keep", "item-delete"]
    assert (
        await db_session.scalar(select(PluggyItem).where(PluggyItem.external_id == "item-keep"))
        is None
    )
    assert (
        await db_session.scalar(
            select(PluggyAccount).where(PluggyAccount.external_id == "account-keep")
        )
        is None
    )


@pytest.mark.parametrize(
    ("pluggy_type", "subtype", "expected"),
    [
        ("BANK", "CHECKING", "checking"),
        ("BANK", "SAVINGS", "savings"),
        ("CREDIT", "CREDIT_CARD", "credit_card"),
        ("INVESTMENT", "BROKERAGE", "investment"),
        ("LOAN", "PERSONAL", "checking"),
    ],
)
def test_pluggy_account_type_mapping(pluggy_type: str, subtype: str, expected: str) -> None:
    assert map_account_type(pluggy_type, subtype) == expected


@pytest.mark.parametrize(
    ("raw_amount", "pluggy_type", "account_type", "expected"),
    [
        (Decimal("-12.50"), "DEBIT", "checking", (Decimal("12.50"), "expense", Decimal("-12.50"))),
        (Decimal("20.00"), "CREDIT", "checking", (Decimal("20.00"), "income", Decimal("20.00"))),
        (
            Decimal("12.50"),
            "DEBIT",
            "credit_card",
            (Decimal("12.50"), "expense", Decimal("-12.50")),
        ),
        (Decimal("-5.00"), "CREDIT", "credit_card", (Decimal("5.00"), "income", Decimal("5.00"))),
    ],
)
def test_pluggy_transaction_sign_and_type_mapping(
    raw_amount: Decimal,
    pluggy_type: str,
    account_type: str,
    expected: tuple[Decimal, str, Decimal],
) -> None:
    assert map_transaction_amount(raw_amount, pluggy_type, account_type) == expected
    if account_type == "credit_card":
        assert normalize_synced_balance(Decimal("100"), account_type) == Decimal("-100")


def test_opening_balance_reconciliation_arithmetic() -> None:
    assert reconcile_opening_balance(
        Decimal("100.00"), [Decimal("150.00"), Decimal("-50.00")]
    ) == Decimal("0.00")


async def _seed_sync_categories(db: AsyncSession, user_id: UUID) -> None:
    income_group = CategoryGroup(
        user_id=user_id, name="Income", kind="income", color="#22AA66", icon="coins"
    )
    expense_group = CategoryGroup(
        user_id=user_id, name="Expenses", kind="expense", color="#AA2266", icon="tag"
    )
    db.add_all([income_group, expense_group])
    await db.flush()
    salary = Category(
        user_id=user_id,
        name="Salary",
        kind="income",
        group_id=income_group.id,
        color=income_group.color,
        icon="coins",
    )
    coffee = Category(
        user_id=user_id,
        name="Coffee",
        kind="expense",
        group_id=expense_group.id,
        color=expense_group.color,
        icon="coffee",
    )
    db.add_all([salary, coffee])
    await db.flush()
    db.add_all(
        [
            CategorizationRule(
                user_id=user_id,
                name="Salary rule",
                priority=1,
                is_active=True,
                match_op="and",
                conditions=[{"field": "description", "op": "contains", "value": "salary"}],
                category_id=salary.id,
            ),
            CategorizationRule(
                user_id=user_id,
                name="Coffee rule",
                priority=1,
                is_active=True,
                match_op="and",
                conditions=[{"field": "description", "op": "contains", "value": "coffee"}],
                category_id=coffee.id,
            ),
        ]
    )
    await db.commit()


def _stub_sync_transactions(monkeypatch: pytest.MonkeyPatch) -> None:
    async def list_accounts(_api_key: str, _item_id: str) -> list[dict[str, object]]:
        return [
            {
                "id": "account-sync",
                "type": "BANK",
                "subtype": "CHECKING",
                "name": "Main account",
                "number": "****1234",
                "currency": "BRL",
                "balance": "100.00",
            }
        ]

    async def get_transactions(
        _api_key: str, _account_id: str, _from_date: date, _to_date: date, _page: int
    ) -> dict[str, object]:
        return {
            "results": [
                {
                    "id": "transaction-salary",
                    "date": "2026-09-01",
                    "description": "Salary",
                    "amount": "150.00",
                    "type": "CREDIT",
                },
                {
                    "id": "transaction-coffee",
                    "date": "2026-09-02",
                    "description": "Coffee",
                    "amount": "-50.00",
                    "type": "DEBIT",
                },
            ]
        }

    monkeypatch.setattr(pluggy_client, "list_accounts", list_accounts)
    monkeypatch.setattr(pluggy_client, "get_transactions", get_transactions)


async def test_sync_is_idempotent_for_the_same_pluggy_transactions(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, password = await make_user(db_session, email="pluggy-sync-idempotent@example.com")
    await login_as(client, email=user.email, password=password)
    await _link_pluggy_credentials(client)
    _stub_pluggy(monkeypatch)
    await _seed_sync_categories(db_session, user.id)
    registered = await client.post("/api/v1/open-finance/items", json={"external_id": "item-sync"})
    assert registered.status_code == 201, registered.text
    _stub_sync_transactions(monkeypatch)

    first = await client.post(f"/api/v1/open-finance/items/{registered.json()['id']}/sync")
    assert first.status_code == 200, first.text
    assert first.json() == {"transactions_imported": 2, "accounts_synced": 1, "error": None}
    first_count = await db_session.scalar(
        select(func.count()).select_from(Transaction).where(Transaction.user_id == user.id)
    )

    second = await client.post(f"/api/v1/open-finance/items/{registered.json()['id']}/sync")
    assert second.status_code == 200, second.text
    assert second.json() == {"transactions_imported": 0, "accounts_synced": 1, "error": None}
    second_count = await db_session.scalar(
        select(func.count()).select_from(Transaction).where(Transaction.user_id == user.id)
    )
    assert second_count == first_count == 2


async def test_first_sync_reconciles_the_derived_account_balance(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, password = await make_user(db_session, email="pluggy-sync-balance@example.com")
    await login_as(client, email=user.email, password=password)
    await _link_pluggy_credentials(client)
    _stub_pluggy(monkeypatch)
    await _seed_sync_categories(db_session, user.id)
    registered = await client.post(
        "/api/v1/open-finance/items", json={"external_id": "item-balance"}
    )
    assert registered.status_code == 201, registered.text
    _stub_sync_transactions(monkeypatch)

    response = await client.post(f"/api/v1/open-finance/items/{registered.json()['id']}/sync")
    assert response.status_code == 200, response.text

    pluggy_account = await db_session.scalar(
        select(PluggyAccount).where(PluggyAccount.external_id == "account-sync")
    )
    assert pluggy_account is not None
    assert pluggy_account.account_id is not None
    account = await db_session.get(Account, pluggy_account.account_id)
    assert account is not None
    balance = next(
        row
        for row in await accounts_service.account_balances(db_session, user.id)
        if row.account_id == account.id
    )
    assert account.opening_balance == Decimal("0.00")
    assert balance.balance == pluggy_account.synced_balance == Decimal("100.00")
