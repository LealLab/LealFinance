"""Live, cached, and degraded asset quotes through the positions API."""

from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.asset_quotes as quotes_service
import app.services.market_data_credentials as credentials_service
from app.core.config import get_settings
from app.models.investment import AssetQuote
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _wallet_asset(
    client: AsyncClient, *, provider: str = "twelve_data", symbol: str = "ACME"
) -> tuple[str, str]:
    wallet = await client.post(
        "/api/v1/investments/wallets", json={"name": "Portfolio", "currency": "BRL"}
    )
    assert wallet.status_code == 201, wallet.text
    asset = await client.post(
        "/api/v1/investments/assets",
        json={
            "symbol": symbol,
            "name": "Acme",
            "asset_class": "stock",
            "currency": "BRL",
            "quote_provider": provider,
        },
    )
    assert asset.status_code == 201, asset.text
    transaction = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet.json()["id"],
            "asset_id": asset.json()["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "2",
            "price": "10",
            "amount": "20",
            "fee": "0",
            "currency": "BRL",
        },
    )
    assert transaction.status_code == 201, transaction.text
    return wallet.json()["id"], asset.json()["id"]


async def test_manual_price_is_used_without_stale_flag(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "asset-quotes-manual@example.com")
    wallet = await client.post(
        "/api/v1/investments/wallets", json={"name": "Portfolio", "currency": "BRL"}
    )
    asset = await client.post(
        "/api/v1/investments/assets",
        json={
            "symbol": "MANUAL",
            "name": "Manual",
            "asset_class": "stock",
            "currency": "BRL",
            "quote_provider": "manual",
            "manual_price": "15.25",
        },
    )
    assert wallet.status_code == 201 and asset.status_code == 201
    transaction = await client.post(
        "/api/v1/investments/transactions",
        json={
            "wallet_id": wallet.json()["id"],
            "asset_id": asset.json()["id"],
            "type": "buy",
            "date": "2026-01-01",
            "quantity": "1",
            "price": "10",
            "amount": "10",
            "fee": "0",
            "currency": "BRL",
        },
    )
    assert transaction.status_code == 201, transaction.text

    response = await client.get(f"/api/v1/investments/wallets/{wallet.json()['id']}/positions")
    position = response.json()[0]
    assert position["price"] == "15.2500000000"
    assert position["price_is_stale"] is False


async def test_live_asset_without_credential_degrades_to_none(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings().model_copy(update={"twelve_data_api_key": None})
    monkeypatch.setattr(credentials_service, "get_settings", lambda: settings)
    await _authed(client, db_session, "asset-quotes-none@example.com")
    wallet_id, _asset_id = await _wallet_asset(client)

    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert response.status_code == 200
    position = response.json()[0]
    assert position["price"] is None
    assert position["price_is_stale"] is True


async def test_today_cache_is_used_without_http(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _authed(client, db_session, "asset-quotes-cache@example.com")
    wallet_id, _asset_id = await _wallet_asset(client)
    db_session.add(
        AssetQuote(
            symbol="ACME",
            currency="BRL",
            price=Decimal("22.5"),
            as_of=date.today(),
            source="twelve_data",
        )
    )
    await db_session.commit()

    async def fail_fetch(*_args: object, **_kwargs: object) -> dict[str, Decimal]:
        raise AssertionError("today's cached quote should avoid HTTP")

    monkeypatch.setattr(quotes_service, "_fetch_twelve_data", fail_fetch)
    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    position = response.json()[0]
    assert position["price"] == "22.5000000000"
    assert position["price_as_of"] == date.today().isoformat()
    assert position["price_is_stale"] is False


async def test_live_fetch_is_cached_and_reused(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _authed(client, db_session, "asset-quotes-live@example.com")
    wallet_id, _asset_id = await _wallet_asset(client)
    linked = await client.put(
        "/api/v1/market-data/credentials/twelve_data",
        json={"api_key": "test-key"},
    )
    assert linked.status_code == 200

    calls = 0

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {"symbol": "ACME", "close": "23.75"}

    class Client:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, *_args: object, **_kwargs: object) -> Response:
            nonlocal calls
            calls += 1
            return Response()

    monkeypatch.setattr(quotes_service.httpx, "AsyncClient", Client)
    first = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert Decimal(first.json()[0]["price"]) == Decimal("23.75")
    assert calls == 1

    second = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert Decimal(second.json()[0]["price"]) == Decimal("23.75")
    assert calls == 1


async def test_provider_failure_degrades_to_stale_quote(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _authed(client, db_session, "asset-quotes-stale@example.com")
    wallet_id, _asset_id = await _wallet_asset(client)
    linked = await client.put(
        "/api/v1/market-data/credentials/twelve_data",
        json={"api_key": "test-key"},
    )
    assert linked.status_code == 200
    old_date = date.today() - timedelta(days=1)
    db_session.add(
        AssetQuote(
            symbol="ACME",
            currency="BRL",
            price=Decimal("19.25"),
            as_of=old_date,
            source="twelve_data",
        )
    )
    await db_session.commit()

    class Client:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, *_args: object, **_kwargs: object) -> object:
            raise httpx.ReadTimeout("provider unavailable")

    monkeypatch.setattr(quotes_service.httpx, "AsyncClient", Client)
    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert response.status_code == 200
    position = response.json()[0]
    assert position["price"] == "19.2500000000"
    assert position["price_as_of"] == old_date.isoformat()
    assert position["price_is_stale"] is True
