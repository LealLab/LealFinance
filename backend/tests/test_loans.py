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
    assert body["contracted_installment_amount"] is None
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


async def test_contracted_installment_overrides_estimate_and_can_be_cleared(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-contracted@example.com")
    category_id = await _expense_category(client)

    created = await client.post(
        "/api/v1/loans",
        json=_loan_body(category_id, contracted_installment_amount="1200.00"),
    )
    assert created.status_code == 201, created.text
    loan = created.json()
    assert loan["contracted_installment_amount"] == "1200.0000"
    assert loan["installment_amount"] == "1200.0000"

    cleared = await client.patch(
        f"/api/v1/loans/{loan['id']}", json={"contracted_installment_amount": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["contracted_installment_amount"] is None
    assert cleared.json()["installment_amount"] == "1101.1021"


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


async def test_delete_loan_detaches_payments_by_default(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-delete-detach@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (await client.post("/api/v1/loans", json=_loan_body(category_id))).json()["id"]
    payment = (
        await client.post(f"/api/v1/loans/{loan_id}/payments", json={"account_id": account_id})
    ).json()

    response = await client.delete(f"/api/v1/loans/{loan_id}")
    assert response.status_code == 204

    assert (await client.get("/api/v1/loans")).json() == []
    kept = (await client.get("/api/v1/transactions")).json()
    assert [row["id"] for row in kept] == [payment["id"]]
    assert kept[0]["loan_id"] is None


async def test_delete_loan_cascade_removes_its_payments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-delete-cascade@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (await client.post("/api/v1/loans", json=_loan_body(category_id))).json()["id"]
    await client.post(f"/api/v1/loans/{loan_id}/payments", json={"account_id": account_id})

    response = await client.delete(f"/api/v1/loans/{loan_id}?mode=cascade")
    assert response.status_code == 204

    assert (await client.get("/api/v1/loans")).json() == []
    assert (await client.get("/api/v1/transactions")).json() == []


async def test_delete_loan_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-delete-owner@example.com")
    await _authed(other_client, db_session, "loan-delete-intruder@example.com")
    category_id = await _expense_category(client)
    loan_id = (await client.post("/api/v1/loans", json=_loan_body(category_id))).json()["id"]

    response = await other_client.delete(f"/api/v1/loans/{loan_id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "loan.not_found"
    assert len((await client.get("/api/v1/loans")).json()) == 1


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
    assert tx["installment_group_id"] is None
    assert tx["installment_number"] == 1
    assert tx["installment_count"] == 48

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


async def test_payment_default_is_discounted_by_payment_date_but_override_wins(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-payment-discount@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post(
            "/api/v1/loans",
            json=_loan_body(
                category_id,
                installment_count=3,
                contracted_installment_amount="15000.00",
                first_payment_date="2027-01-10",
            ),
        )
    ).json()["id"]

    discounted = await client.post(
        f"/api/v1/loans/{loan_id}/payments",
        json={"account_id": account_id, "date": "2026-12-10"},
    )
    assert discounted.status_code == 201, discounted.text
    assert Decimal(discounted.json()["amount"]) < Decimal("15000")

    overridden = await client.post(
        f"/api/v1/loans/{loan_id}/payments",
        json={"account_id": account_id, "date": "2026-12-10", "amount": "12345.67"},
    )
    assert overridden.status_code == 201, overridden.text
    assert overridden.json()["amount"] == "12345.6700"


async def test_advance_last_keeps_the_next_unpaid_installment_and_discounts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-advance-last@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post(
            "/api/v1/loans",
            json=_loan_body(
                category_id,
                installment_count=6,
                contracted_installment_amount="8000.00",
                first_payment_date="2027-01-10",
            ),
        )
    ).json()["id"]

    advanced = await client.post(
        f"/api/v1/loans/{loan_id}/advance-payments",
        json={"mode": "last", "count": 2, "account_id": account_id, "date": "2026-10-10"},
    )
    assert advanced.status_code == 201, advanced.text
    assert [row["installment_number"] for row in advanced.json()] == [5, 6]
    assert all(Decimal(row["amount"]) < Decimal("8000") for row in advanced.json())

    next_payment = await client.post(
        f"/api/v1/loans/{loan_id}/payments",
        json={"account_id": account_id, "date": "2027-01-10"},
    )
    assert next_payment.status_code == 201, next_payment.text
    assert next_payment.json()["installment_number"] == 1


async def test_advance_all_allocates_an_explicit_total_exactly(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-advance-all@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post(
            "/api/v1/loans",
            json=_loan_body(category_id, installment_count=3),
        )
    ).json()["id"]

    response = await client.post(
        f"/api/v1/loans/{loan_id}/advance-payments",
        json={"mode": "all", "account_id": account_id, "amount": "2500.01"},
    )
    assert response.status_code == 201, response.text
    rows = response.json()
    assert [row["installment_number"] for row in rows] == [1, 2, 3]
    assert sum(Decimal(row["amount"]) for row in rows) == Decimal("2500.0100")

    loan = (await client.get("/api/v1/loans")).json()[0]
    assert loan["installments_paid"] == 3


async def test_advance_validation_rejects_invalid_count_without_writes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-advance-invalid@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post("/api/v1/loans", json=_loan_body(category_id, installment_count=2))
    ).json()["id"]

    response = await client.post(
        f"/api/v1/loans/{loan_id}/advance-payments",
        json={"mode": "last", "count": 3, "account_id": account_id},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "loan.advance_count_exceeds_remaining"
    assert (await client.get("/api/v1/transactions")).json() == []


async def test_advance_amount_too_small_rejects_a_non_positive_installment(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-advance-too-small@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post("/api/v1/loans", json=_loan_body(category_id, installment_count=3))
    ).json()["id"]

    # Split a near-zero total three ways: rounding leaves the last share at 0.
    response = await client.post(
        f"/api/v1/loans/{loan_id}/advance-payments",
        json={"mode": "all", "account_id": account_id, "amount": "0.0002"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "loan.advance_amount_too_small"
    assert (await client.get("/api/v1/transactions")).json() == []


async def test_deleting_payment_reopens_its_installment(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-reopen-installment@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post("/api/v1/loans", json=_loan_body(category_id, installment_count=3))
    ).json()["id"]
    first = (
        await client.post(f"/api/v1/loans/{loan_id}/payments", json={"account_id": account_id})
    ).json()
    await client.post(f"/api/v1/loans/{loan_id}/payments", json={"account_id": account_id})

    assert (await client.delete(f"/api/v1/transactions/{first['id']}")).status_code == 204
    reopened = await client.post(
        f"/api/v1/loans/{loan_id}/payments", json={"account_id": account_id}
    )
    assert reopened.status_code == 201, reopened.text
    assert reopened.json()["installment_number"] == 1


async def test_cannot_shrink_term_below_a_paid_installment(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-shrink-term@example.com")
    category_id = await _expense_category(client)
    account_id = await _account(client)
    loan_id = (
        await client.post("/api/v1/loans", json=_loan_body(category_id, installment_count=6))
    ).json()["id"]
    await client.post(
        f"/api/v1/loans/{loan_id}/advance-payments",
        json={"mode": "last", "count": 1, "account_id": account_id},
    )

    response = await client.patch(f"/api/v1/loans/{loan_id}", json={"installment_count": 5})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "loan.installment_count_below_paid"


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


async def test_auto_post_fills_early_gaps_after_last_installments_were_advanced(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "loan-autopost-gaps@example.com")
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
    advanced = await client.post(
        f"/api/v1/loans/{loan_id}/advance-payments",
        json={"mode": "last", "count": 2, "date": "2025-12-01"},
    )
    assert [row["installment_number"] for row in advanced.json()] == [5, 6]

    assert await post_all_due_installments(db_session, today=date(2026, 3, 15)) == 3
    rows = (await client.get("/api/v1/transactions")).json()
    loan_rows = [row for row in rows if row["loan_id"] == loan_id]
    assert {row["installment_number"] for row in loan_rows} == {1, 2, 3, 5, 6}
    assert await post_all_due_installments(db_session, today=date(2026, 3, 15)) == 0


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

    advance = await other_client.post(
        f"/api/v1/loans/{loan_id}/advance-payments", json={"mode": "all"}
    )
    assert advance.status_code == 404
    assert advance.json()["error"]["code"] == "loan.not_found"

    listing = await other_client.get("/api/v1/loans")
    assert all(row["id"] != loan_id for row in listing.json())
