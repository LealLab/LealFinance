"""Cash-position (saldo real) contributions and their invoice timing."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import accounts as accounts_service
from app.services.card_invoice_posting import post_all_due_invoice_payments
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> UUID:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)
    return user.id


async def _account(client: AsyncClient, **overrides: object) -> str:
    body = {"name": "Checking", "type": "checking", "currency": "BRL"}
    body.update(overrides)
    response = await client.post("/api/v1/accounts", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _card(
    client: AsyncClient,
    *,
    payment_account_id: str | None = None,
    auto_pay: bool = False,
    opening_balance: str = "0",
) -> str:
    return await _account(
        client,
        name="Visa",
        type="credit_card",
        currency="BRL",
        credit_limit="10000.00",
        closing_day=10,
        due_day=20,
        payment_account_id=payment_account_id,
        auto_pay=auto_pay,
        opening_balance=opening_balance,
    )


async def _category(client: AsyncClient) -> str:
    group = await client.post(
        "/api/v1/category-groups",
        json={"name": "G", "kind": "expense", "color": "#112233", "icon": "tag"},
    )
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": "Shopping",
            "kind": "expense",
            "group_id": group.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _charge(
    client: AsyncClient, card_id: str, category_id: str, day: str, amount: str
) -> None:
    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": day,
            "amount": amount,
            "currency": "BRL",
            "account_id": card_id,
            "category_id": category_id,
            "description": "buy",
        },
    )
    assert response.status_code == 201, response.text


def _by_account(rows: list[accounts_service.AccountBalance]) -> dict[UUID, Decimal]:
    return {row.account_id: row.balance for row in rows}


async def test_real_balance_defers_current_cycle_and_counts_overdue(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "cash-position@example.com")
    checking_id = UUID(await _account(client, opening_balance="1000.00"))
    card_id = UUID(await _card(client))
    category_id = await _category(client)
    await _charge(client, str(card_id), category_id, "2026-03-05", "100.00")

    open_cycle = _by_account(
        await accounts_service.real_balance_contributions(
            db_session, user_id, today=date(2026, 3, 8)
        )
    )
    assert open_cycle[checking_id] == Decimal("1000.0000")
    assert open_cycle[card_id] == Decimal("0.0000")

    overdue = _by_account(
        await accounts_service.real_balance_contributions(
            db_session, user_id, today=date(2026, 3, 25)
        )
    )
    assert overdue[checking_id] == Decimal("1000.0000")
    assert overdue[card_id] == Decimal("-100.0000")

    response = await client.get("/api/v1/accounts/real-balances")
    assert response.status_code == 200
    assert all(isinstance(row["balance"], str) for row in response.json())


async def test_real_balance_payment_keeps_cash_position_consistent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "cash-payment@example.com")
    checking_id = await _account(client, opening_balance="1000.00")
    card_id = await _card(client, payment_account_id=checking_id)
    category_id = await _category(client)
    await _charge(client, card_id, category_id, "2026-03-05", "200.00")

    payment = await client.post(
        f"/api/v1/accounts/{card_id}/invoices/2026-03-10/pay",
        json={"date": "2026-03-18"},
    )
    assert payment.status_code == 201, payment.text

    rows = _by_account(
        await accounts_service.real_balance_contributions(
            db_session, user_id, today=date(2026, 3, 19)
        )
    )
    assert rows[UUID(checking_id)] == Decimal("800.0000")
    assert rows[UUID(card_id)] == Decimal("0.0000")


async def test_real_balance_auto_payment_keeps_cash_position_consistent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "cash-auto@example.com")
    checking_id = await _account(client, opening_balance="1000.00")
    card_id = await _card(client, payment_account_id=checking_id, auto_pay=True)
    category_id = await _category(client)
    await _charge(client, card_id, category_id, "2026-03-05", "150.00")

    assert await post_all_due_invoice_payments(db_session, today=date(2026, 3, 21)) == 1

    rows = _by_account(
        await accounts_service.real_balance_contributions(
            db_session, user_id, today=date(2026, 3, 21)
        )
    )
    assert rows[UUID(checking_id)] == Decimal("850.0000")
    assert rows[UUID(card_id)] == Decimal("0.0000")


async def test_real_balance_uses_raw_balance_for_unconfigured_cards_and_excludes_archived(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "cash-edge@example.com")
    card_id = UUID(
        await _account(client, name="Unconfigured", type="credit_card", opening_balance="-50")
    )
    archived_id = await _account(client, name="Archived", opening_balance="900")
    archive = await client.post(f"/api/v1/accounts/{archived_id}/archive", json={"archived": True})
    assert archive.status_code == 200

    rows = await accounts_service.real_balance_contributions(
        db_session, user_id, today=date(2026, 3, 21)
    )
    by_account = _by_account(rows)
    assert by_account[card_id] == Decimal("-50.0000")
    assert UUID(archived_id) not in by_account


async def test_real_balance_keeps_currency_contributions_separate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "cash-currencies@example.com")
    brl_id = UUID(await _account(client, opening_balance="1000"))
    usd_id = UUID(await _account(client, name="USD", currency="USD", opening_balance="100"))

    rows = await accounts_service.real_balance_contributions(
        db_session, user_id, today=date(2026, 3, 21)
    )
    assert {(row.account_id, row.currency, row.balance) for row in rows} == {
        (brl_id, "BRL", Decimal("1000.0000")),
        (usd_id, "USD", Decimal("100.0000")),
    }
