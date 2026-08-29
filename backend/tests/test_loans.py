"""Loan CRUD, installment amortization, payment recording, auto-post
catch-up, and ownership isolation."""

from datetime import date
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import loans as loans_service
from app.services.loan_posting import post_all_due_installments
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _category(client: AsyncClient, name: str = "Comfort", kind: str = "expense") -> str:
    group = await client.post(
        "/api/v1/category-groups",
        json={"name": f"{name} Group", "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert group.status_code == 201, group.text
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": name,
            "kind": kind,
            "group_id": group.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _expense_category(client: AsyncClient, name: str = "Comfort") -> str:
    return await _category(client, name=name, kind="expense")


async def _income_category(client: AsyncClient) -> str:
    return await _category(client, name="Salary", kind="income")


async def _account(client: AsyncClient, name: str = "Checking", currency: str = "BRL") -> str:
    response = await client.post(
        "/api/v1/accounts", json={"name": name, "type": "checking", "currency": currency}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _loan_body(category_id: str, **overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "name": "Car loan",
        "category_id": category_id,
        "currency": "BRL",
        "amount_borrowed": "40000.00",
        "fees": "0.00",
        "interest_rate": "1.2",
        "rate_period": "monthly",
        "installment_count": 48,
        "first_payment_date": "2026-01-10",
    }
    body.update(overrides)
    return body


# --- amortization -----------------------------------------------------------


def test_compute_installment_matches_amortization_formula() -> None:
    # 40000 over 48 months at 1.2%/month. Standard annuity payment.
    amount = loans_service.compute_installment_amount(
        amount_borrowed=Decimal("40000"),
        fees=Decimal("0"),
        interest_rate=Decimal("1.2"),
        rate_period="monthly",
        installment_count=48,
    )
    assert amount == Decimal("1101.1021")


def test_compute_installment_zero_interest_is_straight_line() -> None:
    amount = loans_service.compute_installment_amount(
        amount_borrowed=Decimal("1200"),
        fees=Decimal("300"),
        interest_rate=Decimal("0"),
        rate_period="annual",
        installment_count=12,
    )
    assert amount == Decimal("125.0000")


def test_compute_installment_annual_rate_is_divided_by_twelve() -> None:
    monthly = loans_service.compute_installment_amount(
        amount_borrowed=Decimal("10000"),
        fees=Decimal("0"),
        interest_rate=Decimal("1"),
        rate_period="monthly",
        installment_count=24,
    )
    annual = loans_service.compute_installment_amount(
        amount_borrowed=Decimal("10000"),
        fees=Decimal("0"),
        interest_rate=Decimal("12"),
        rate_period="annual",
        installment_count=24,
    )
    assert monthly == annual


# --- CRUD -----------------------------------------------------------------


async def test_create_loan_computes_installment_amount(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-create@example.com")
    category_id = await _expense_category(client)

    response = await client.post("/api/v1/loans", json=_loan_body(category_id))
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["installment_amount"] == "1101.1021"
    assert body["installments_paid"] == 0
    assert body["archived"] is False


async def test_create_loan_ignores_client_supplied_installment_amount(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-installment-ignored@example.com")
    category_id = await _expense_category(client)

    response = await client.post(
        "/api/v1/loans", json=_loan_body(category_id, installment_amount="1.00")
    )
    assert response.status_code == 201, response.text
    assert response.json()["installment_amount"] == "1101.1021"


async def test_create_loan_rejects_income_category(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-income-cat@example.com")
    category_id = await _income_category(client)

    response = await client.post("/api/v1/loans", json=_loan_body(category_id))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "loan.category_not_expense"


async def test_create_loan_auto_post_requires_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-autopost-noacct@example.com")
    category_id = await _expense_category(client)

    response = await client.post("/api/v1/loans", json=_loan_body(category_id, auto_post=True))
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "loan.auto_post_requires_account"


async def test_create_loan_rejects_payment_account_currency_mismatch(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-acct-currency@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client, currency="USD")

    response = await client.post(
        "/api/v1/loans",
        json=_loan_body(category_id, auto_post=True, payment_account_id=account_id),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "loan.account_currency_mismatch"


async def test_update_loan_recomputes_installment_amount(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-update@example.com")
    category_id = await _expense_category(client)
    loan_id = (await client.post("/api/v1/loans", json=_loan_body(category_id))).json()["id"]

    response = await client.patch(f"/api/v1/loans/{loan_id}", json={"installment_count": 24})
    assert response.status_code == 200, response.text
    # Same principal/rate over half the term -> a larger installment.
    assert Decimal(response.json()["installment_amount"]) > Decimal("1101.1021")


async def test_archive_and_unarchive_loan(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "loan-archive@example.com")
    category_id = await _expense_category(client)
    loan_id = (await client.post("/api/v1/loans", json=_loan_body(category_id))).json()["id"]

    archived = await client.post(f"/api/v1/loans/{loan_id}/archive", json={"archived": True})
    assert archived.status_code == 200
    assert archived.json()["archived"] is True

    unarchived = await client.post(f"/api/v1/loans/{loan_id}/archive", json={"archived": False})
    assert unarchived.json()["archived"] is False


# --- payments -----------------------------------------------------------


async def test_record_payment_creates_expense_carrying_category_and_loan_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-pay@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (await client.post("/api/v1/loans", json=_loan_body(category_id))).json()["id"]

    response = await client.post(
        f"/api/v1/loans/{loan_id}/payments", json={"account_id": account_id}
    )
    assert response.status_code == 201, response.text
    tx = response.json()
    assert tx["type"] == "expense"
    assert tx["category_id"] == category_id
    assert tx["loan_id"] == loan_id
    assert tx["amount"] == "1101.1021"

    loan = (await client.get("/api/v1/loans")).json()[0]
    assert loan["installments_paid"] == 1


async def test_record_payment_uses_loan_payment_account_by_default(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-pay-default-acct@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post(
            "/api/v1/loans",
            json=_loan_body(category_id, auto_post=True, payment_account_id=account_id),
        )
    ).json()["id"]

    response = await client.post(f"/api/v1/loans/{loan_id}/payments", json={})
    assert response.status_code == 201, response.text
    assert response.json()["account_id"] == account_id


async def test_record_payment_rejected_once_fully_paid(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-fully-paid@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post("/api/v1/loans", json=_loan_body(category_id, installment_count=2))
    ).json()["id"]

    for _ in range(2):
        assert (
            await client.post(f"/api/v1/loans/{loan_id}/payments", json={"account_id": account_id})
        ).status_code == 201

    response = await client.post(
        f"/api/v1/loans/{loan_id}/payments", json={"account_id": account_id}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "loan.fully_paid"


# --- auto-posting ------------------------------------------------------------


async def test_auto_post_catches_up_backdated_loan_then_is_idempotent(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-autopost@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    await client.post(
        "/api/v1/loans",
        json=_loan_body(
            category_id,
            auto_post=True,
            payment_account_id=account_id,
            first_payment_date="2026-01-10",
            installment_count=6,
        ),
    )

    # Three monthly installments are due by this date (Jan/Feb/Mar 10).
    posted = await post_all_due_installments(db_session, today=date(2026, 3, 15))
    assert posted == 3

    # A second pass on the same day posts nothing more.
    assert await post_all_due_installments(db_session, today=date(2026, 3, 15)) == 0

    loan = (await client.get("/api/v1/loans")).json()[0]
    assert loan["installments_paid"] == 3


async def test_auto_post_stops_at_installment_count(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-autopost-cap@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    await client.post(
        "/api/v1/loans",
        json=_loan_body(
            category_id,
            auto_post=True,
            payment_account_id=account_id,
            first_payment_date="2026-01-10",
            installment_count=2,
        ),
    )

    posted = await post_all_due_installments(db_session, today=date(2030, 1, 1))
    assert posted == 2


async def test_auto_post_skips_archived_loans(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-autopost-archived@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post(
            "/api/v1/loans",
            json=_loan_body(
                category_id,
                auto_post=True,
                payment_account_id=account_id,
                first_payment_date="2026-01-10",
                installment_count=6,
            ),
        )
    ).json()["id"]
    await client.post(f"/api/v1/loans/{loan_id}/archive", json={"archived": True})

    assert await post_all_due_installments(db_session, today=date(2026, 6, 15)) == 0


# --- auth & ownership ------------------------------------------------------


async def test_loan_routes_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/loans")).status_code == 401


async def test_loan_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-owner@example.com")
    await _authed(other_client, db_session, "loan-intruder@example.com")
    category_id = await _expense_category(client)
    loan_id = (await client.post("/api/v1/loans", json=_loan_body(category_id))).json()["id"]

    patch = await other_client.patch(f"/api/v1/loans/{loan_id}", json={"name": "Hijacked"})
    assert patch.status_code == 404
    assert patch.json()["error"]["code"] == "loan.not_found"

    listing = await other_client.get("/api/v1/loans")
    assert all(row["id"] != loan_id for row in listing.json())
