"""app/services/card_invoices.py: billing-cycle math and the derived
invoice (total / paid / remaining / status), plus the pay-invoice flow.

Cycle math is tested against the service directly with a fixed `today`;
the HTTP layer gets a couple of smoke tests at the end.
"""

from datetime import date
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import card_invoices as svc
from app.services.card_invoices import cycle_close_for, due_date_for
from tests.factories import login_as, make_user


def __D(value: str) -> Decimal:
    return Decimal(value)


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> str:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)
    return str(user.id)


async def _account(client: AsyncClient, **overrides: object) -> str:
    body = {"name": "Checking", "type": "checking", "currency": "BRL"}
    body.update(overrides)
    response = await client.post("/api/v1/accounts", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _card(
    client: AsyncClient,
    *,
    closing_day: int = 10,
    due_day: int = 20,
    opening_balance: str = "0",
    payment_account_id: str | None = None,
) -> str:
    return await _account(
        client,
        name="Visa",
        type="credit_card",
        closing_day=closing_day,
        due_day=due_day,
        credit_limit="10000.00",
        opening_balance=opening_balance,
        payment_account_id=payment_account_id,
    )


async def _category(client: AsyncClient, kind: str = "expense") -> str:
    group = await client.post(
        "/api/v1/category-groups",
        json={"name": "G", "kind": kind, "color": "#112233", "icon": "tag"},
    )
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": "Shopping",
            "kind": kind,
            "group_id": group.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _expense(
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


# --- pure cycle math --------------------------------------------------------


def test_cycle_close_clamps_to_short_month() -> None:
    # closing_day 31, a charge in February -> the cycle closes on Feb 28.
    assert cycle_close_for(date(2026, 2, 15), 31) == date(2026, 2, 28)
    # a charge on the (clamped) close day itself is in that same cycle.
    assert cycle_close_for(date(2026, 2, 28), 31) == date(2026, 2, 28)
    # the day after rolls to the next cycle.
    assert cycle_close_for(date(2026, 3, 1), 31) == date(2026, 3, 31)


def test_due_date_same_month_when_due_after_closing() -> None:
    assert due_date_for(date(2026, 3, 10), 20) == date(2026, 3, 20)


def test_due_date_next_month_when_due_before_closing() -> None:
    assert due_date_for(date(2026, 3, 20), 10) == date(2026, 4, 10)


# --- derived invoice ------------------------------------------------------------


async def test_charges_bucket_into_their_cycle(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "cyc@example.com")
    card_id = await _card(client, closing_day=10, due_day=20)
    category_id = await _category(client)

    await _expense(client, card_id, category_id, "2026-03-05", "100.00")  # cycle Mar 10
    await _expense(client, card_id, category_id, "2026-03-10", "40.00")  # on close day -> Mar 10
    await _expense(client, card_id, category_id, "2026-03-11", "7.00")  # cycle Apr 10

    invoices = await svc.list_invoices(
        db_session, user_id, card_id, today=date(2026, 3, 15), months_back=2, months_ahead=2
    )
    by_close = {inv.close_date: inv for inv in invoices}
    assert by_close[date(2026, 3, 10)].total == __D("140.0000")
    assert by_close[date(2026, 4, 10)].total == __D("7.0000")


async def test_opening_balance_debt_lands_in_first_cycle(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "open@example.com")
    card_id = await _card(client, opening_balance="-300.00")
    category_id = await _category(client)
    await _expense(client, card_id, category_id, "2026-03-05", "100.00")

    invoices = await svc.list_invoices(
        db_session, user_id, card_id, today=date(2026, 3, 15), months_back=2, months_ahead=1
    )
    # 300 pre-existing debt is attached only to the card's genuine first
    # cycle (the one holding the earliest charge), not smeared over the
    # empty earlier cycles the window also returns.
    march = next(inv for inv in invoices if inv.close_date == date(2026, 3, 10))
    february = next(inv for inv in invoices if inv.close_date == date(2026, 2, 10))
    assert march.total == __D("400.0000")
    assert february.total == __D("0")


async def test_total_ignores_payments_and_partial_payment_leaves_remaining(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "pay@example.com")
    checking_id = await _account(client)
    card_id = await _card(client, closing_day=10, due_day=20)
    category_id = await _category(client)
    await _expense(client, card_id, category_id, "2026-03-05", "200.00")

    # a partial payment of the closed Mar invoice
    pay = await client.post(
        f"/api/v1/accounts/{card_id}/invoices/2026-03-10/pay",
        json={"account_id": checking_id, "amount": "50.00", "date": "2026-03-18"},
    )
    assert pay.status_code == 201, pay.text

    invoices = await svc.list_invoices(
        db_session, user_id, card_id, today=date(2026, 3, 19), months_back=2, months_ahead=1
    )
    march = next(inv for inv in invoices if inv.close_date == date(2026, 3, 10))
    assert march.total == __D("200.0000")
    assert march.paid == __D("50.0000")
    assert march.remaining == __D("150.0000")
    assert march.status == "closed"


@pytest.mark.parametrize(
    ("today", "expected"),
    (
        (date(2026, 3, 8), "open"),
        (date(2026, 3, 15), "closed"),
        (date(2026, 3, 25), "overdue"),
    ),
)
async def test_status_transitions(
    client: AsyncClient, db_session: AsyncSession, today: date, expected: str
) -> None:
    user_id = await _authed(client, db_session, f"st-{expected}@example.com")
    card_id = await _card(client, closing_day=10, due_day=20)
    category_id = await _category(client)
    await _expense(client, card_id, category_id, "2026-03-05", "100.00")

    invoices = await svc.list_invoices(
        db_session, user_id, card_id, today=today, months_back=1, months_ahead=1
    )
    march = next(inv for inv in invoices if inv.close_date == date(2026, 3, 10))
    assert march.status == expected


async def test_future_invoice_sums_future_charges_and_recurring(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "fut@example.com")
    card_id = await _card(client, closing_day=10, due_day=20)
    category_id = await _category(client)

    # an installment already booked in a future cycle
    await _expense(client, card_id, category_id, "2026-05-05", "90.00")
    # a monthly recurring expense that posts to the card
    rule = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-03-08",
            "template": {
                "type": "expense",
                "amount": "30.00",
                "currency": "BRL",
                "account_id": card_id,
                "category_id": category_id,
                "description": "sub",
            },
        },
    )
    assert rule.status_code == 201, rule.text

    invoices = await svc.list_invoices(
        db_session, user_id, card_id, today=date(2026, 3, 15), months_back=0, months_ahead=3
    )
    may = next(inv for inv in invoices if inv.close_date == date(2026, 5, 10))
    # 90 booked + one projected 30 occurrence on Apr 8 lands in... May? no:
    # Apr 8 -> cycle Apr 10. May 8 -> cycle May 10. So May invoice = 90 + 30.
    assert may.total == __D("120.0000")
    assert may.status == "projected"


async def test_no_cycle_configured_returns_empty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "nocfg@example.com")
    card_id = await _account(client, name="Visa", type="credit_card", credit_limit="1000.00")
    assert (await svc.list_invoices(db_session, user_id, card_id, today=date(2026, 3, 1))) == []


async def test_non_credit_card_account_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user_id = await _authed(client, db_session, "notcard@example.com")
    checking_id = await _account(client)
    with pytest.raises(Exception) as exc:
        await svc.list_invoices(db_session, user_id, checking_id, today=date(2026, 3, 1))
    assert "account_not_credit_card" in str(exc.value)


async def test_other_users_card_is_not_found(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "owner@example.com")
    card_id = await _card(client)
    other_id = await _authed(other_client, db_session, "intruder@example.com")

    with pytest.raises(Exception) as exc:
        await svc.list_invoices(db_session, other_id, card_id, today=date(2026, 3, 1))
    assert "account.not_found" in str(exc.value)


# --- HTTP layer -----------------------------------------------------------------


async def test_get_invoices_endpoint(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "http@example.com")
    card_id = await _card(client)
    response = await client.get(f"/api/v1/accounts/{card_id}/invoices")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert all(isinstance(inv["total"], str) for inv in body)


async def test_pay_invoice_endpoint_marks_paid(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "httppay@example.com")
    checking_id = await _account(client)
    card_id = await _card(client, closing_day=10, due_day=20, payment_account_id=checking_id)
    category_id = await _category(client)
    await _expense(client, card_id, category_id, "2026-01-05", "80.00")

    pay = await client.post(
        f"/api/v1/accounts/{card_id}/invoices/2026-01-10/pay",
        json={"date": "2026-01-18"},
    )
    assert pay.status_code == 201, pay.text
    tx = pay.json()
    assert tx["type"] == "transfer"
    assert tx["to_account_id"] == card_id
    assert tx["account_id"] == checking_id
    assert tx["card_invoice_close_date"] == "2026-01-10"

    # paying again is rejected
    again = await client.post(
        f"/api/v1/accounts/{card_id}/invoices/2026-01-10/pay", json={"date": "2026-01-19"}
    )
    assert again.status_code == 422
    assert again.json()["error"]["code"] == "card_invoice.already_paid"
