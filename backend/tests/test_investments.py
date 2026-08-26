"""Investment CRUD, ownership, settlement, and wire-format coverage."""

from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.transaction import Transaction
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_account(
    client: AsyncClient, *, name: str = "Cash", currency: str = "BRL", opening_balance: str = "0"
) -> dict[str, object]:
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
    return response.json()


async def _create_wallet(
    client: AsyncClient, *, currency: str = "BRL", cash_account_id: str | None = None
) -> dict[str, object]:
    payload: dict[str, object] = {"name": "Brokerage", "currency": currency}
    if cash_account_id is not None:
        payload["cash_account_id"] = cash_account_id
    response = await client.post("/api/v1/investments/wallets", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


async def _create_asset(client: AsyncClient, symbol: str = "AAPL") -> dict[str, object]:
    response = await client.post(
        "/api/v1/investments/assets",
        json={
            "symbol": symbol,
            "name": "Apple",
            "asset_class": "stock",
            "currency": "BRL",
            "manual_price": "10.25",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_wallet_creates_and_updates_linked_investment_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-wallet@example.com")

    wallet = await _create_wallet(client)
    account = await db_session.get(Account, wallet["account_id"])
    assert account is not None
    assert account.type == "investment"
    assert account.currency == "BRL"

    response = await client.patch(
        f"/api/v1/investments/wallets/{wallet['id']}", json={"currency": "USD"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["currency"] == "USD"
    await db_session.refresh(account)
    assert account.currency == "USD"


async def test_investment_resources_are_ownership_scoped(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-owner@example.com")
    await _authed(other_client, db_session, "investment-other@example.com")
    wallet = await _create_wallet(client)
    asset = await _create_asset(client)
    created = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "1",
            "price": "10",
            "amount": "10",
            "currency": "BRL",
        },
    )
    assert created.status_code == 201, created.text
    investment_transaction_id = created.json()["id"]

    for method, path in (
        ("get", f"/api/v1/investments/wallets/{wallet['id']}"),
        ("patch", f"/api/v1/investments/wallets/{wallet['id']}"),
        ("get", f"/api/v1/investments/assets/{asset['id']}"),
        ("patch", f"/api/v1/investments/assets/{asset['id']}"),
        ("get", f"/api/v1/investments/transactions/{investment_transaction_id}"),
        ("patch", f"/api/v1/investments/transactions/{investment_transaction_id}"),
    ):
        if method == "patch":
            response = await other_client.patch(path, json={})
        else:
            response = await other_client.get(path)
        assert response.status_code == 404, response.text


async def test_investments_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/investments/wallets")
    assert response.status_code == 401


async def test_asset_provider_heuristic_and_duplicate_conflict(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-assets@example.com")
    b3 = await _create_asset(client, "PETR4")
    other = await _create_asset(client, "AAPL")
    assert b3["quote_provider"] == "brapi"
    assert other["quote_provider"] == "manual"

    duplicate = await client.post(
        "/api/v1/investments/assets",
        json={"symbol": "AAPL", "name": "Duplicate", "asset_class": "stock", "currency": "BRL"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "investment_asset.symbol_already_exists"


async def test_buy_and_sell_settle_same_currency_cash_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-settlement@example.com")
    cash = await _create_account(client, opening_balance="1000")
    wallet = await _create_wallet(client, cash_account_id=cash["id"])
    asset = await _create_asset(client)

    buy = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "10",
            "price": "10",
            "amount": "100",
            "fee": "5",
            "currency": "BRL",
        },
    )
    assert buy.status_code == 201, buy.text
    buy_row = await db_session.get(Transaction, buy.json()["transaction_id"])
    assert buy_row is not None
    assert buy_row.amount == Decimal("105.0000")
    assert buy_row.currency == "BRL"
    assert buy_row.type == "transfer"
    assert str(buy_row.account_id) == cash["id"]
    assert str(buy_row.to_account_id) == wallet["account_id"]

    sell = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "sell",
            "date": "2026-01-02",
            "quantity": "2",
            "price": "20",
            "amount": "40",
            "fee": "2",
            "currency": "BRL",
        },
    )
    assert sell.status_code == 201, sell.text
    sell_row = await db_session.get(Transaction, sell.json()["transaction_id"])
    assert sell_row is not None
    assert sell_row.amount == Decimal("38.0000")
    assert str(sell_row.account_id) == wallet["account_id"]
    assert str(sell_row.to_account_id) == cash["id"]

    balances = {
        row["account_id"]: row["balance"]
        for row in (await client.get("/api/v1/accounts/balances")).json()
    }
    assert balances[cash["id"]] == "933.0000"


async def test_cross_currency_buy_records_conversion(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-cross-currency@example.com")
    cash = await _create_account(client, currency="USD", opening_balance="1000")
    wallet = await _create_wallet(client, currency="BRL", cash_account_id=cash["id"])
    asset = await _create_asset(client)

    response = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "1",
            "price": "100",
            "amount": "100",
            "currency": "BRL",
        },
    )
    assert response.status_code == 201, response.text
    ledger = await db_session.get(Transaction, response.json()["transaction_id"])
    assert ledger is not None
    assert ledger.currency == "USD"
    assert ledger.conversion_amount is not None
    assert ledger.conversion_currency == "BRL"
    assert ledger.conversion_rate is not None
    assert ledger.conversion_source is not None


async def test_oversell_is_rejected(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "investment-oversell@example.com")
    wallet = await _create_wallet(client)
    asset = await _create_asset(client)
    buy = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "1",
            "price": "10",
            "amount": "10",
            "currency": "BRL",
        },
    )
    assert buy.status_code == 201
    sell = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "sell",
            "date": "2026-01-02",
            "quantity": "2",
            "price": "10",
            "amount": "20",
            "currency": "BRL",
        },
    )
    assert sell.status_code == 422
    assert sell.json()["error"]["code"] == "investment_transaction.insufficient_quantity"


async def test_delete_investment_transaction_deletes_cash_ledger_row(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-delete@example.com")
    cash = await _create_account(client)
    wallet = await _create_wallet(client, cash_account_id=cash["id"])
    asset = await _create_asset(client)
    created = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "1",
            "price": "10",
            "amount": "10",
            "currency": "BRL",
        },
    )
    ledger_id = created.json()["transaction_id"]
    response = await client.delete(f"/api/v1/investments/transactions/{created.json()['id']}")
    assert response.status_code == 204
    assert await db_session.get(Transaction, ledger_id) is None


async def test_deleting_a_buy_a_later_sell_depends_on_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A sell already depends on this buy's quantity - deleting it would
    leave the ledger unfoldable (a sell with nothing bought), so it must be
    rejected rather than silently corrupting the position."""
    await _authed(client, db_session, "investment-delete-guard@example.com")
    wallet = await _create_wallet(client)
    asset = await _create_asset(client)
    buy = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "10",
            "price": "10",
            "amount": "100",
            "currency": "BRL",
        },
    )
    assert buy.status_code == 201
    sell = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "sell",
            "date": "2026-01-02",
            "quantity": "3",
            "price": "12",
            "amount": "36",
            "currency": "BRL",
        },
    )
    assert sell.status_code == 201

    response = await client.delete(f"/api/v1/investments/transactions/{buy.json()['id']}")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "investment_transaction.ledger_invalid"

    # Rejected - the buy must still be there, and positions must still compute.
    positions = await client.get(f"/api/v1/investments/wallets/{wallet['id']}/positions")
    assert positions.status_code == 200
    assert positions.json()[0]["quantity"] == "7.0000000000"


async def test_fee_without_asset_is_allowed_but_dividend_requires_asset(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-income-shape@example.com")
    wallet = await _create_wallet(client)
    fee = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "type": "fee",
            "date": "2026-01-01",
            "amount": "2",
            "currency": "BRL",
        },
    )
    assert fee.status_code == 201, fee.text
    dividend = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "type": "dividend",
            "date": "2026-01-01",
            "amount": "2",
            "currency": "BRL",
        },
    )
    assert dividend.status_code == 422
    assert dividend.json()["error"]["code"] == "investment_transaction.asset_required"


async def test_wallet_without_cash_account_skips_settlement_and_reads_decimal_strings(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-no-cash@example.com")
    wallet = await _create_wallet(client)
    asset = await _create_asset(client)
    buy = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "2",
            "price": "10.25",
            "amount": "20.50",
            "fee": "0.50",
            "currency": "BRL",
        },
    )
    assert buy.status_code == 201, buy.text
    body = buy.json()
    assert body["transaction_id"] is None
    assert all(isinstance(body[field], str) for field in ("quantity", "price", "amount", "fee"))

    positions = await client.get(f"/api/v1/investments/wallets/{wallet['id']}/positions")
    assert positions.status_code == 200
    position = positions.json()[0]
    assert isinstance(position["quantity"], str)
    assert isinstance(position["book_value"], str)
    assert isinstance(position["price"], str)

    summary = await client.get("/api/v1/investments/summary")
    assert summary.status_code == 200
    assert isinstance(summary.json()["total_book_value"], str)


async def test_buy_amount_is_derived_from_quantity_times_price(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A client-supplied `amount` inconsistent with quantity * price must
    never be trusted - it would let the cash leg settle for a different
    total than the position fold's cost basis, silently corrupting the
    wallet's accounting."""
    await _authed(client, db_session, "investment-amount-derived@example.com")
    cash = await _create_account(client)
    wallet = await _create_wallet(client, cash_account_id=cash["id"])
    asset = await _create_asset(client)

    response = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "2",
            "price": "10",
            "amount": "999",
            "fee": "1",
            "currency": "BRL",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["amount"] == "20.0000"

    ledger = await db_session.get(Transaction, body["transaction_id"])
    assert ledger is not None
    assert ledger.amount == Decimal("21.0000")


async def test_transaction_currency_must_match_wallet_currency(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-currency-mismatch@example.com")
    wallet = await _create_wallet(client, currency="BRL")
    asset = await _create_asset(client)

    response = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "1",
            "price": "10",
            "amount": "10",
            "currency": "USD",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "investment_transaction.currency_must_match_wallet"


async def test_updating_settled_transaction_rebuilds_cash_ledger(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-update-settlement@example.com")
    cash = await _create_account(client)
    wallet = await _create_wallet(client, cash_account_id=cash["id"])
    asset = await _create_asset(client)
    created = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "1",
            "price": "10",
            "amount": "10",
            "currency": "BRL",
        },
    )
    assert created.status_code == 201, created.text
    old_ledger_id = created.json()["transaction_id"]

    # `amount` for a buy/sell is derived server-side from quantity * price
    # (see investments.py::_with_derived_amount) - it can never disagree with
    # the position fold's cost basis, so a settlement rebuild is driven by
    # quantity/price/fee, not by patching `amount` directly.
    updated = await client.patch(
        f"/api/v1/investments/transactions/{created.json()['id']}",
        json={"quantity": "2", "fee": "1"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["amount"] == "20.0000"
    assert updated.json()["transaction_id"] != old_ledger_id
    assert await db_session.get(Transaction, old_ledger_id) is None
    new_ledger = await db_session.get(Transaction, updated.json()["transaction_id"])
    assert new_ledger is not None
    assert new_ledger.amount == Decimal("21.0000")


async def test_wallet_currency_change_is_rejected_after_settlement(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-wallet-currency-guard@example.com")
    cash = await _create_account(client)
    wallet = await _create_wallet(client, cash_account_id=cash["id"])
    asset = await _create_asset(client)
    created = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet["id"],
            "asset_id": asset["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "1",
            "price": "10",
            "amount": "10",
            "currency": "BRL",
        },
    )
    assert created.status_code == 201

    response = await client.patch(
        f"/api/v1/investments/wallets/{wallet['id']}", json={"currency": "USD"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "investment_wallet.currency_in_use"


async def test_list_wallet_transactions_supports_pagination(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-pagination@example.com")
    wallet = await _create_wallet(client)
    asset = await _create_asset(client)
    for day in ("2026-01-01", "2026-01-02"):
        response = await client.post(
            "/api/v1/investments/transactions",
            json={
                "wallet_id": wallet["id"],
                "asset_id": asset["id"],
                "type": "buy",
                "date": day,
                "quantity": "1",
                "price": "10",
                "amount": "10",
                "currency": "BRL",
            },
        )
        assert response.status_code == 201
    response = await client.get(
        f"/api/v1/investments/wallets/{wallet['id']}/transactions?limit=1&offset=1"
    )
    assert response.status_code == 200
    assert len(response.json()) == 1


async def test_asset_manual_price_is_a_json_string(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "investment-price-string@example.com")
    asset = await _create_asset(client)
    assert isinstance(asset["manual_price"], str)
