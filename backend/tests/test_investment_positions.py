"""Average-cost position math through the investment HTTP API."""

from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _wallet_and_asset(client: AsyncClient) -> tuple[str, str]:
    wallet = await client.post(
        "/api/v1/investments/wallets", json={"name": "Portfolio", "currency": "BRL"}
    )
    assert wallet.status_code == 201, wallet.text
    asset = await client.post(
        "/api/v1/investments/assets",
        json={
            "symbol": "ACME",
            "name": "Acme",
            "asset_class": "stock",
            "currency": "BRL",
            "manual_price": "15",
        },
    )
    assert asset.status_code == 201, asset.text
    return wallet.json()["id"], asset.json()["id"]


async def _post(
    client: AsyncClient,
    wallet_id: str,
    asset_id: str | None,
    type_: str,
    date: str,
    *,
    quantity: str | None = None,
    price: str | None = None,
    amount: str = "0",
    fee: str = "0",
) -> None:
    payload: dict[str, str] = {
        "wallet_id": wallet_id,
        "type": type_,
        "date": date,
        "amount": amount,
        "fee": fee,
        "currency": "BRL",
    }
    if asset_id is not None:
        payload["asset_id"] = asset_id
    if quantity is not None:
        payload["quantity"] = quantity
    if price is not None:
        payload["price"] = price
    response = await client.post("/api/v1/investments/transactions", json=payload)
    assert response.status_code == 201, response.text


async def test_average_cost_fold_matches_hand_calculation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "positions-average@example.com")
    wallet_id, asset_id = await _wallet_and_asset(client)
    await _post(
        client,
        wallet_id,
        asset_id,
        "buy",
        "2026-01-01",
        quantity="2",
        price="10",
        amount="20",
        fee="1",
    )
    await _post(
        client,
        wallet_id,
        asset_id,
        "buy",
        "2026-01-02",
        quantity="3",
        price="14",
        amount="42",
    )
    await _post(
        client,
        wallet_id,
        asset_id,
        "sell",
        "2026-01-03",
        quantity="2",
        price="16",
        amount="32",
        fee="2",
    )
    await _post(
        client,
        wallet_id,
        asset_id,
        "buy",
        "2026-01-04",
        quantity="1",
        price="13",
        amount="13",
        fee="1",
    )

    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert response.status_code == 200
    position = response.json()[0]
    assert Decimal(position["quantity"]) == Decimal("4")
    assert Decimal(position["average_cost"]) == Decimal("12.95")
    assert Decimal(position["book_value"]) == Decimal("51.8")
    assert Decimal(position["realized_gain"]) == Decimal("4.8")


async def test_dividend_and_fee_do_not_change_quantity_or_book_value(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "positions-income@example.com")
    wallet_id, asset_id = await _wallet_and_asset(client)
    await _post(
        client,
        wallet_id,
        asset_id,
        "buy",
        "2026-01-01",
        quantity="2",
        price="10",
        amount="20",
    )
    await _post(
        client,
        wallet_id,
        asset_id,
        "dividend",
        "2026-01-02",
        amount="3.50",
    )
    await _post(client, wallet_id, asset_id, "fee", "2026-01-03", amount="1.25")

    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert response.status_code == 200
    position = response.json()[0]
    assert Decimal(position["quantity"]) == Decimal("2")
    assert Decimal(position["book_value"]) == Decimal("20")
    assert Decimal(position["dividend_income"]) == Decimal("3.5000")
    assert Decimal(position["fees_paid"]) == Decimal("1.2500")


async def test_selling_full_quantity_zeroes_book_value(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "positions-full-sell@example.com")
    wallet_id, asset_id = await _wallet_and_asset(client)
    await _post(
        client,
        wallet_id,
        asset_id,
        "buy",
        "2026-01-01",
        quantity="3",
        price="12.50",
        amount="37.50",
    )
    await _post(
        client,
        wallet_id,
        asset_id,
        "sell",
        "2026-01-02",
        quantity="3",
        price="15",
        amount="45",
    )

    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert response.status_code == 200
    position = response.json()[0]
    assert Decimal(position["quantity"]) == Decimal("0")
    assert Decimal(position["book_value"]) == Decimal("0")
    assert Decimal(position["average_cost"]) == Decimal("0")
