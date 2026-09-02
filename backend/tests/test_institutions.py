"""Institution CRUD, archive/unarchive, delete guard, and ownership isolation."""

from uuid import UUID

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.goal import Goal
from app.models.institution import Institution
from app.models.investment import InvestmentAsset, InvestmentTransaction, InvestmentWallet
from app.models.loan import Loan
from app.models.recurring import RecurringRule
from app.models.transaction import Transaction
from app.models.user import User
from tests.factories import login_as, make_investment_wallet, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> User:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)
    return user


async def test_create_and_list_institution(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")

    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Big Bank", "icon": "bank", "color": "#112233"}
    )
    assert create_response.status_code == 201
    body = create_response.json()
    assert body["name"] == "Big Bank"
    assert body["archived"] is False
    assert body["position"] == 0

    list_response = await client.get("/api/v1/institutions")
    assert list_response.status_code == 200
    assert any(row["id"] == body["id"] for row in list_response.json())


async def test_get_unknown_institution_is_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")

    response = await client.get("/api/v1/institutions/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "institution.not_found"


async def test_update_institution(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "carol@example.com")
    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Old Name", "icon": "bank"}
    )
    institution_id = create_response.json()["id"]

    update_response = await client.patch(
        f"/api/v1/institutions/{institution_id}", json={"name": "New Name", "position": 3}
    )
    assert update_response.status_code == 200
    body = update_response.json()
    assert body["name"] == "New Name"
    assert body["position"] == 3


async def test_archive_and_unarchive_institution(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")
    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Archivable", "icon": "bank"}
    )
    institution_id = create_response.json()["id"]

    archive_response = await client.post(
        f"/api/v1/institutions/{institution_id}/archive", json={"archived": True}
    )
    assert archive_response.status_code == 200
    assert archive_response.json()["archived"] is True

    unarchive_response = await client.post(
        f"/api/v1/institutions/{institution_id}/archive", json={"archived": False}
    )
    assert unarchive_response.status_code == 200
    assert unarchive_response.json()["archived"] is False


async def test_delete_institution_without_accounts_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")
    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Deletable", "icon": "bank"}
    )
    institution_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/institutions/{institution_id}")
    assert delete_response.status_code == 204

    get_response = await client.get(f"/api/v1/institutions/{institution_id}")
    assert get_response.status_code == 404


async def test_delete_institution_with_accounts_is_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Has Accounts", "icon": "bank"}
    )
    institution_id = institution_response.json()["id"]

    account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "currency": "BRL",
            "opening_balance": "100.0000",
            "institution_id": institution_id,
        },
    )
    assert account_response.status_code == 201

    delete_response = await client.delete(f"/api/v1/institutions/{institution_id}")
    assert delete_response.status_code == 409
    assert delete_response.json()["error"]["code"] == "institution.has_accounts"
    assert delete_response.json()["error"]["params"] == {"accounts": 1, "wallets": 0}


async def test_delete_institution_with_accounts_detaches_them(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank-detach@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Detach Accounts", "icon": "bank"}
    )
    institution_id = institution_response.json()["id"]

    account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Checking",
            "type": "checking",
            "currency": "BRL",
            "opening_balance": "100.0000",
            "institution_id": institution_id,
        },
    )
    account_id = account_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/institutions/{institution_id}?mode=detach")
    assert delete_response.status_code == 204

    account_after_delete = await client.get(f"/api/v1/accounts/{account_id}")
    assert account_after_delete.status_code == 200
    assert account_after_delete.json()["institution_id"] is None


async def test_delete_institution_with_wallet_is_guarded_and_detaches_wallet(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authed(client, db_session, "frank-wallet@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Wallet Institution", "icon": "bank"}
    )
    institution_id = UUID(institution_response.json()["id"])

    account_response = await client.post(
        "/api/v1/accounts",
        json={"name": "Investment Account", "type": "investment", "currency": "BRL"},
    )
    wallet = await make_investment_wallet(
        db_session,
        user_id=user.id,
        account_id=UUID(account_response.json()["id"]),
        institution_id=institution_id,
    )

    blocked_response = await client.delete(f"/api/v1/institutions/{institution_id}")
    assert blocked_response.status_code == 409
    assert blocked_response.json()["error"]["code"] == "institution.has_accounts"
    assert blocked_response.json()["error"]["params"] == {"accounts": 0, "wallets": 1}

    delete_response = await client.delete(f"/api/v1/institutions/{institution_id}?mode=detach")
    assert delete_response.status_code == 204

    wallet_after_delete = await client.get(f"/api/v1/investments/wallets/{wallet.id}")
    assert wallet_after_delete.status_code == 200
    assert wallet_after_delete.json()["institution_id"] is None


async def test_institution_routes_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/institutions")
    assert response.status_code == 401


async def test_delete_institution_unknown_mode_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "institution-mode@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Mode", "icon": "bank"}
    )

    response = await client.delete(
        f"/api/v1/institutions/{institution_response.json()['id']}?mode=unknown"
    )

    assert response.status_code == 422


async def test_delete_institution_cascade_removes_accounts_and_dependents(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "institution-cascade@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Cascade Bank", "icon": "bank"}
    )
    institution_id = institution_response.json()["id"]

    account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Cascade checking",
            "type": "checking",
            "currency": "BRL",
            "institution_id": institution_id,
        },
    )
    account_id = account_response.json()["id"]
    goal_account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Cascade goal",
            "type": "goal",
            "currency": "BRL",
            "institution_id": institution_id,
        },
    )
    goal_account_id = goal_account_response.json()["id"]
    survivor_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Survivor card",
            "type": "credit_card",
            "currency": "BRL",
            "payment_account_id": account_id,
        },
    )
    survivor_id = survivor_response.json()["id"]

    category_group_response = await client.post(
        "/api/v1/category-groups",
        json={"name": "Cascade group", "kind": "expense", "color": "#112233", "icon": "tag"},
    )
    category_response = await client.post(
        "/api/v1/categories",
        json={
            "name": "Cascade category",
            "kind": "expense",
            "group_id": category_group_response.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    category_id = category_response.json()["id"]
    ledger_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "10.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Cascade transaction",
        },
    )
    ledger_id = ledger_response.json()["id"]

    goal_response = await client.post(
        "/api/v1/goals",
        json={
            "account_id": goal_account_id,
            "name": "Cascade goal",
            "target_amount": "1000.00",
            "currency": "BRL",
        },
    )
    goal_id = goal_response.json()["id"]
    loan_response = await client.post(
        "/api/v1/loans",
        json={
            "name": "Cascade loan",
            "category_id": category_id,
            "currency": "BRL",
            "amount_borrowed": "1000.00",
            "fees": "0.00",
            "interest_rate": "0.00",
            "rate_period": "monthly",
            "installment_count": 10,
            "first_payment_date": "2026-01-10",
            "payment_account_id": account_id,
        },
    )
    loan_id = loan_response.json()["id"]
    recurring_response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-01",
            "template": {
                "type": "expense",
                "amount": "25.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Cascade recurring",
            },
        },
    )
    recurring_id = recurring_response.json()["id"]

    wallet_response = await client.post(
        "/api/v1/investments/wallets",
        json={
            "name": "Cascade wallet",
            "currency": "BRL",
            "cash_account_id": account_id,
            "institution_id": institution_id,
        },
    )
    wallet_id = wallet_response.json()["id"]
    wallet_account_id = wallet_response.json()["account_id"]
    asset_response = await client.post(
        "/api/v1/investments/assets",
        json={
            "symbol": "CASC",
            "name": "Cascade asset",
            "asset_class": "stock",
            "currency": "BRL",
            "manual_price": "10.00",
        },
    )
    asset_id = asset_response.json()["id"]
    investment_response = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet_id,
            "asset_id": asset_id,
            "type": "buy",
            "date": "2026-01-02",
            "quantity": "1",
            "price": "10",
            "amount": "10",
            "currency": "BRL",
        },
    )
    investment_id = investment_response.json()["id"]
    investment_ledger_id = investment_response.json()["transaction_id"]

    delete_response = await client.delete(f"/api/v1/institutions/{institution_id}?mode=cascade")

    assert delete_response.status_code == 204, delete_response.text
    assert await db_session.get(Institution, UUID(institution_id)) is None
    for model, entity_id in (
        (Account, account_id),
        (Account, goal_account_id),
        (Account, wallet_account_id),
        (Transaction, ledger_id),
        (Transaction, investment_ledger_id),
        (InvestmentWallet, wallet_id),
        (InvestmentTransaction, investment_id),
        (Goal, goal_id),
        (Loan, loan_id),
        (RecurringRule, recurring_id),
    ):
        assert await db_session.get(model, UUID(entity_id)) is None
    assert await db_session.get(InvestmentAsset, UUID(asset_id)) is not None

    survivor = await client.get(f"/api/v1/accounts/{survivor_id}")
    assert survivor.status_code == 200
    assert survivor.json()["payment_account_id"] is None


async def test_cascade_delete_isolated_from_other_users(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "institution-cascade-owner@example.com")
    await _authed(other_client, db_session, "institution-cascade-other@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Private Bank", "icon": "bank"}
    )
    institution_id = institution_response.json()["id"]
    account_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Private checking",
            "type": "checking",
            "currency": "BRL",
            "institution_id": institution_id,
        },
    )
    account_id = account_response.json()["id"]

    response = await other_client.delete(f"/api/v1/institutions/{institution_id}?mode=cascade")

    assert response.status_code == 404
    assert (await client.get(f"/api/v1/institutions/{institution_id}")).status_code == 200
    assert (await client.get(f"/api/v1/accounts/{account_id}")).status_code == 200


async def test_institution_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")
    await _authed(other_client, db_session, "heidi@example.com")

    create_response = await client.post(
        "/api/v1/institutions", json={"name": "Grace's Bank", "icon": "bank"}
    )
    institution_id = create_response.json()["id"]

    get_response = await other_client.get(f"/api/v1/institutions/{institution_id}")
    assert get_response.status_code == 404
    assert get_response.json()["error"]["code"] == "institution.not_found"

    patch_response = await other_client.patch(
        f"/api/v1/institutions/{institution_id}", json={"name": "Hijacked"}
    )
    assert patch_response.status_code == 404

    delete_response = await other_client.delete(f"/api/v1/institutions/{institution_id}")
    assert delete_response.status_code == 404

    list_response = await other_client.get("/api/v1/institutions")
    assert list_response.status_code == 200
    assert all(row["id"] != institution_id for row in list_response.json())
