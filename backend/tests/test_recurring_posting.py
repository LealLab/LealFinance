"""app/services/recurring_posting.py: turning due RecurringRule occurrences
into real Transactions - idempotency, catch-up, end_date, cross-currency
rate freshness, and per-rule failure isolation."""

from datetime import date

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.recurring import RecurringRule
from app.models.transaction import Transaction
from app.services.recurring_posting import post_all_due_occurrences
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
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_category(client: AsyncClient, name: str = "Rent", kind: str = "expense") -> str:
    response = await client.post(
        "/api/v1/categories",
        json={"name": name, "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_rule(
    client: AsyncClient,
    *,
    account_id: str,
    category_id: str,
    start_date: str,
    end_date: str | None = None,
    interval: int = 1,
    amount: str = "100.00",
    currency: str = "BRL",
) -> str:
    payload = {
        "frequency": "monthly",
        "interval": interval,
        "start_date": start_date,
        "template": {
            "type": "expense",
            "amount": amount,
            "currency": currency,
            "account_id": account_id,
            "category_id": category_id,
            "description": "Rent",
        },
    }
    if end_date is not None:
        payload["end_date"] = end_date
    response = await client.post("/api/v1/recurring-rules", json=payload)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _rule_row(db_session: AsyncSession, rule_id: str) -> RecurringRule:
    result = await db_session.execute(select(RecurringRule).where(RecurringRule.id == rule_id))
    return result.scalar_one()


async def _posted_transactions(db_session: AsyncSession, rule_id: str) -> list[Transaction]:
    result = await db_session.execute(
        select(Transaction)
        .where(Transaction.recurring_rule_id == rule_id)
        .order_by(Transaction.date)
    )
    return list(result.scalars().all())


async def test_running_twice_posts_only_once(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    rule_id = await _create_rule(
        client, account_id=account_id, category_id=category_id, start_date="2026-01-15"
    )

    today = date(2026, 1, 15)
    posted_first = await post_all_due_occurrences(db_session, today=today)
    posted_second = await post_all_due_occurrences(db_session, today=today)

    assert posted_first == 1
    assert posted_second == 0
    transactions = await _posted_transactions(db_session, rule_id)
    assert len(transactions) == 1
    assert transactions[0].date == date(2026, 1, 15)
    assert transactions[0].recurring_rule_id is not None


async def test_catches_up_missed_occurrences_and_advances_cursor(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    rule_id = await _create_rule(
        client, account_id=account_id, category_id=category_id, start_date="2026-01-15"
    )

    posted = await post_all_due_occurrences(db_session, today=date(2026, 3, 15))

    assert posted == 3
    transactions = await _posted_transactions(db_session, rule_id)
    assert [t.date for t in transactions] == [
        date(2026, 1, 15),
        date(2026, 2, 15),
        date(2026, 3, 15),
    ]
    rule = await _rule_row(db_session, rule_id)
    assert rule.last_posted_date == date(2026, 3, 15)


async def test_never_posts_a_future_dated_occurrence(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "carol@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    rule_id = await _create_rule(
        client, account_id=account_id, category_id=category_id, start_date="2026-01-15"
    )

    posted = await post_all_due_occurrences(db_session, today=date(2026, 1, 1))

    assert posted == 0
    assert await _posted_transactions(db_session, rule_id) == []


async def test_respects_end_date(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "dave@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    rule_id = await _create_rule(
        client,
        account_id=account_id,
        category_id=category_id,
        start_date="2026-01-15",
        end_date="2026-02-01",
    )

    posted = await post_all_due_occurrences(db_session, today=date(2026, 4, 1))

    assert posted == 1
    transactions = await _posted_transactions(db_session, rule_id)
    assert [t.date for t in transactions] == [date(2026, 1, 15)]


async def test_cross_currency_uses_the_rate_resolved_for_the_occurrence_date(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The template freezes a conversion rate at creation time
    (template_conversion_rate). Posting must re-resolve a live rate as-of
    the occurrence date instead of replaying that frozen value - here via
    a manual rate set *after* the rule was created, at a different value
    than the template's own frozen rate."""
    await _authed(client, db_session, "erin@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    rule_response = await client.post(
        "/api/v1/recurring-rules",
        json={
            "frequency": "monthly",
            "interval": 1,
            "start_date": "2026-01-15",
            "template": {
                "type": "expense",
                "amount": "100.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": "Cross-currency rent",
                "conversion": {"currency": "USD", "rate": "0.20", "source": "manual"},
            },
        },
    )
    assert rule_response.status_code == 201, rule_response.text
    rule_id = rule_response.json()["id"]
    assert rule_response.json()["template"]["conversion"]["rate"] == "0.2000000000"

    manual_rate_response = await client.put(
        "/api/v1/manual-rates/BRL_USD/2026-01-01", json={"rate": "0.25"}
    )
    assert manual_rate_response.status_code == 200, manual_rate_response.text

    posted = await post_all_due_occurrences(db_session, today=date(2026, 1, 15))

    assert posted == 1
    [transaction] = await _posted_transactions(db_session, rule_id)
    assert transaction.conversion is not None
    # (100 - 0) * 0.25 = 25.00 - the manual rate in effect on the
    # occurrence date, not the template's frozen 0.20.
    assert str(transaction.conversion.rate) == "0.2500000000"
    assert str(transaction.conversion.amount) == "25.0000"
    assert transaction.conversion.source == "manual"


async def test_one_failing_rule_does_not_abort_the_run(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)

    broken_rule_id = await _create_rule(
        client, account_id=account_id, category_id=category_id, start_date="2026-01-15"
    )
    healthy_rule_id = await _create_rule(
        client,
        account_id=account_id,
        category_id=category_id,
        start_date="2026-01-15",
        amount="50.00",
    )

    # Point the first rule's template at a real account that belongs to a
    # *different* user (simulating data drift - the FK stays valid, but
    # ownership.get_owned in _post_one must still reject it), bypassing
    # rule-creation validation entirely so posting is the thing that has
    # to cope with it.
    other_user, _ = await make_user(db_session, email="ghost@example.com")
    other_account = Account(user_id=other_user.id, name="Other", type="checking", currency="BRL")
    db_session.add(other_account)
    await db_session.commit()

    broken_rule = await _rule_row(db_session, broken_rule_id)
    broken_rule.template_account_id = other_account.id
    await db_session.commit()

    posted = await post_all_due_occurrences(db_session, today=date(2026, 1, 15))

    assert posted == 1
    broken_rule = await _rule_row(db_session, broken_rule_id)
    healthy_rule = await _rule_row(db_session, healthy_rule_id)
    assert broken_rule.last_posted_date is None
    assert healthy_rule.last_posted_date == date(2026, 1, 15)
    assert await _posted_transactions(db_session, broken_rule_id) == []
    [healthy_tx] = await _posted_transactions(db_session, healthy_rule_id)
    assert healthy_tx.date == date(2026, 1, 15)
