"""app/services/card_invoice_posting.py: nightly auto-payment of due
credit-card invoices - derived idempotency, the catch-up window, the
auto_pay gate, and per-card failure isolation."""

from datetime import date

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.transaction import Transaction
from app.services.card_invoice_posting import post_all_due_invoice_payments
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _account(client: AsyncClient, **overrides: object) -> str:
    body = {"name": "Checking", "type": "checking", "currency": "BRL"}
    body.update(overrides)
    response = await client.post("/api/v1/accounts", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _card(client: AsyncClient, checking_id: str, *, auto_pay: bool) -> str:
    return await _account(
        client,
        name="Visa",
        type="credit_card",
        closing_day=10,
        due_day=20,
        credit_limit="10000.00",
        payment_account_id=checking_id,
        auto_pay=auto_pay,
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


async def _card_payments(db_session: AsyncSession, card_id: str) -> list[Transaction]:
    result = await db_session.execute(
        select(Transaction)
        .where(Transaction.to_account_id == card_id, Transaction.type == "transfer")
        .order_by(Transaction.date)
    )
    return list(result.scalars().all())


async def test_pays_a_due_invoice_once(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "auto1@example.com")
    checking_id = await _account(client)
    card_id = await _card(client, checking_id, auto_pay=True)
    category_id = await _category(client)
    await _charge(client, card_id, category_id, "2026-03-05", "150.00")  # cycle Mar 10, due Mar 20

    first = await post_all_due_invoice_payments(db_session, today=date(2026, 3, 21))
    second = await post_all_due_invoice_payments(db_session, today=date(2026, 3, 22))

    assert first == 1
    assert second == 0
    payments = await _card_payments(db_session, card_id)
    assert len(payments) == 1
    assert payments[0].amount == 150
    assert payments[0].card_invoice_close_date == date(2026, 3, 10)


async def test_auto_pay_disabled_is_skipped(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "auto2@example.com")
    checking_id = await _account(client)
    card_id = await _card(client, checking_id, auto_pay=False)
    category_id = await _category(client)
    await _charge(client, card_id, category_id, "2026-03-05", "80.00")

    posted = await post_all_due_invoice_payments(db_session, today=date(2026, 3, 21))

    assert posted == 0
    assert await _card_payments(db_session, card_id) == []


async def test_invoice_overdue_beyond_window_is_left_alone(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "auto3@example.com")
    checking_id = await _account(client)
    card_id = await _card(client, checking_id, auto_pay=True)
    category_id = await _category(client)
    await _charge(client, card_id, category_id, "2026-03-05", "60.00")  # due Mar 20

    # A month later - well past the 7-day catch-up window.
    posted = await post_all_due_invoice_payments(db_session, today=date(2026, 4, 25))

    assert posted == 0
    assert await _card_payments(db_session, card_id) == []


async def test_one_card_failure_does_not_abort_the_run(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "auto4@example.com")
    good_checking = await _account(client, name="Good")
    broken_checking = await _account(client, name="Broken")
    good_card = await _card(client, good_checking, auto_pay=True)
    broken_card = await _card(client, broken_checking, auto_pay=True)
    category_id = await _category(client)
    await _charge(client, good_card, category_id, "2026-03-05", "90.00")
    await _charge(client, broken_card, category_id, "2026-03-05", "40.00")

    # Archive the broken card's payment account - pay_invoice then rejects it.
    broken_source = (
        await db_session.execute(select(Account).where(Account.id == broken_checking))
    ).scalar_one()
    broken_source.archived = True
    await db_session.flush()

    posted = await post_all_due_invoice_payments(db_session, today=date(2026, 3, 21))

    assert posted == 1
    assert len(await _card_payments(db_session, good_card)) == 1
    assert await _card_payments(db_session, broken_card) == []
