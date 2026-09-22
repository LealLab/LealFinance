"""Live, cached, and degraded asset quotes through the positions API."""

from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.asset_quotes as quotes_service
import app.services.market_data_credentials as credentials_service
from app.core.config import get_settings
from app.models.investment import AssetQuote, InvestmentAsset
from tests.factories import login_as, make_user


async def _authed(
    client: AsyncClient,
    db_session: AsyncSession,
    email: str,
    *,
    base_currency: str = "BRL",
) -> None:
    user, password = await make_user(db_session, email=email)
    user.base_currency = base_currency
    await db_session.commit()
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


async def test_crypto_asset_prices_without_any_api_key(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _authed(client, db_session, "asset-quotes-crypto-keyless@example.com")
    wallet_id, _asset_id = await _wallet_asset(client, provider="coingecko", symbol="BTC")

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, object]]:
            return [{"symbol": "btc", "current_price": 65000.5}]

    class Client:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, url: str, **kwargs: object) -> Response:
            assert "x-cg-demo-api-key" not in kwargs.get("headers", {})
            return Response()

    monkeypatch.setattr(quotes_service.httpx, "AsyncClient", Client)
    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert response.status_code == 200
    position = response.json()[0]
    assert Decimal(position["price"]) == Decimal("65000.5")
    assert position["price_is_stale"] is False


async def test_same_symbol_prices_independently_per_wallet_currency(
    client: AsyncClient,
    other_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """asset_quotes is a global cache, not scoped to a user - a USD row for a
    symbol must not be served to a different user's wallet holding the same
    symbol in BRL. (One user can't hold the same symbol twice - see
    uq_investment_assets_user_id_symbol - so this needs two users.)"""
    await _authed(
        client,
        db_session,
        "asset-quotes-currency-cache-usd@example.com",
        base_currency="USD",
    )
    await _authed(
        other_client,
        db_session,
        "asset-quotes-currency-cache-brl@example.com",
        base_currency="BRL",
    )
    db_session.add_all(
        [
            AssetQuote(
                symbol="BTC",
                currency="USD",
                price=Decimal("65000"),
                as_of=date.today(),
                source="coingecko",
            ),
            AssetQuote(
                symbol="BTC",
                currency="BRL",
                price=Decimal("330000"),
                as_of=date.today(),
                source="coingecko",
            ),
        ]
    )
    await db_session.commit()

    for user_client, currency, expected_price in (
        (client, "USD", Decimal("65000")),
        (other_client, "BRL", Decimal("330000")),
    ):
        wallet = await user_client.post(
            "/api/v1/investments/wallets", json={"name": "Portfolio", "currency": currency}
        )
        asset = await user_client.post(
            "/api/v1/investments/assets",
            json={
                "symbol": "BTC",
                "name": "Bitcoin",
                "asset_class": "crypto",
                "currency": currency,
            },
        )
        transaction = await user_client.post(
            "/api/v1/investments/transactions",
            json={
                "wallet_id": wallet.json()["id"],
                "asset_id": asset.json()["id"],
                "type": "buy",
                "date": "2026-01-01",
                "quantity": "1",
                "price": "1",
                "amount": "1",
                "fee": "0",
                "currency": currency,
            },
        )
        assert transaction.status_code == 201, transaction.text

        positions = await user_client.get(
            f"/api/v1/investments/wallets/{wallet.json()['id']}/positions"
        )
        assert Decimal(positions.json()[0]["price"]) == expected_price


@pytest.mark.parametrize("age", [0, 1])
async def test_cached_quotes_are_isolated_by_provider(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    age: int,
) -> None:
    await _authed(client, db_session, "provider-cache@example.com")
    wallet_id, _ = await _wallet_asset(client, provider="coingecko", symbol="BTC")
    as_of = date.today() - timedelta(days=age)
    db_session.add_all(
        [
            AssetQuote(
                symbol="BTC", currency="BRL", price=Decimal(price), as_of=as_of, source=provider
            )
            for provider, price in (("coingecko", "330000"), ("twelve_data", "150"))
        ]
    )
    await db_session.commit()

    async def unavailable(*_args: object) -> dict[str, Decimal]:
        raise httpx.ReadTimeout("provider unavailable")

    monkeypatch.setattr(quotes_service, "_fetch_coingecko", unavailable)
    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert response.status_code == 200
    position = response.json()[0]
    assert Decimal(position["price"]) == Decimal("330000")
    assert position["price_is_stale"] is bool(age)
    assert position["price_as_of"] == as_of.isoformat()


async def test_foreign_provider_quote_does_not_replace_live_or_stale_prices(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _authed(client, db_session, "provider-live@example.com")
    wallet_id, _ = await _wallet_asset(client, provider="coingecko", symbol="BTC")
    db_session.add(
        AssetQuote(
            symbol="BTC",
            currency="BRL",
            price=Decimal("150"),
            as_of=date.today(),
            source="twelve_data",
        )
    )
    await db_session.commit()

    async def unavailable(*_args: object) -> dict[str, Decimal]:
        raise httpx.ReadTimeout("provider unavailable")

    monkeypatch.setattr(quotes_service, "_fetch_coingecko", unavailable)
    response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
    assert response.status_code == 200
    assert response.json()[0]["price"] is None

    calls = 0

    async def fetch(*_args: object) -> dict[str, Decimal]:
        nonlocal calls
        calls += 1
        return {"BTC": Decimal("330000")}

    monkeypatch.setattr(quotes_service, "_fetch_coingecko", fetch)
    for _ in range(2):
        response = await client.get(f"/api/v1/investments/wallets/{wallet_id}/positions")
        assert response.status_code == 200
        assert Decimal(response.json()[0]["price"]) == Decimal("330000")
        assert response.json()[0]["price_is_stale"] is False
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


async def test_coingecko_failure_degrades_to_stale_quote_without_a_key(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The keyless provider still degrades gracefully - a broken lookup must
    not fail the request even when there is no credential to blame."""
    await _authed(client, db_session, "asset-quotes-crypto-stale@example.com")
    wallet_id, _asset_id = await _wallet_asset(client, provider="coingecko", symbol="BTC")
    old_date = date.today() - timedelta(days=1)
    db_session.add(
        AssetQuote(
            symbol="BTC",
            currency="BRL",
            price=Decimal("300000"),
            as_of=old_date,
            source="coingecko",
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
    assert position["price"] == "300000.0000000000"
    assert position["price_as_of"] == old_date.isoformat()
    assert position["price_is_stale"] is True


async def test_historical_twelve_data_parser_uses_exact_date(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"values": [{"datetime": "2026-01-15", "close": "123.45"}]}

    class Client:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, _url: str, **kwargs: object) -> Response:
            assert kwargs["params"] == {
                "symbol": "ACME",
                "interval": "1day",
                "start_date": "2026-01-15",
                "end_date": "2026-01-15",
                "apikey": "key",
            }
            return Response()

    monkeypatch.setattr(quotes_service.httpx, "AsyncClient", Client)
    price = await quotes_service._fetch_twelve_data_historical("key", "ACME", date(2026, 1, 15))
    assert price == Decimal("123.45")


async def test_historical_brapi_parser_reads_daily_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "results": [
                    {
                        "symbol": "PETR4",
                        "data": {"historicalDataPrice": [{"date": "2026-01-15", "close": 37.5}]},
                    }
                ]
            }

    class Client:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, _url: str, **kwargs: object) -> Response:
            assert kwargs["params"]["startDate"] == "2026-01-15"
            assert kwargs["params"]["endDate"] == "2026-01-15"
            return Response()

    monkeypatch.setattr(quotes_service.httpx, "AsyncClient", Client)
    price = await quotes_service._fetch_brapi_historical("key", "PETR4", date(2026, 1, 15))
    assert price == Decimal("37.5")


async def test_historical_coingecko_parser_resolves_symbol_to_coin_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        def __init__(self, payload: object) -> None:
            self.payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> object:
            return self.payload

    class Client:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "Client":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def get(self, url: str, **kwargs: object) -> Response:
            if url.endswith("/markets"):
                return Response([{"id": "bitcoin", "symbol": "btc"}])
            assert url.endswith("/bitcoin/history")
            assert kwargs["params"] == {"date": "2026-01-15", "localization": "false"}
            return Response({"market_data": {"current_price": {"brl": "330000"}}})

    monkeypatch.setattr(quotes_service.httpx, "AsyncClient", Client)
    price = await quotes_service._fetch_coingecko_historical(None, "BTC", "BRL", date(2026, 1, 15))
    assert price == Decimal("330000")


async def test_exact_date_quote_cache_does_not_use_stale_rows(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user, password = await make_user(db_session, email="asset-quotes-exact-date@example.com")
    user.base_currency = "BRL"
    await db_session.commit()
    await login_as(client, email=user.email, password=password)
    asset_response = await client.post(
        "/api/v1/investments/assets",
        json={
            "symbol": "EXACT",
            "name": "Exact",
            "asset_class": "stock",
            "currency": "BRL",
            "quote_provider": "twelve_data",
        },
    )
    assert asset_response.status_code == 201, asset_response.text
    asset = await db_session.scalar(
        select(InvestmentAsset).where(InvestmentAsset.symbol == "EXACT")
    )
    assert asset is not None
    target = date(2026, 1, 15)
    db_session.add(
        AssetQuote(
            symbol="EXACT",
            currency="BRL",
            price=Decimal("10"),
            as_of=target - timedelta(days=1),
            source="twelve_data",
        )
    )
    await db_session.commit()

    async def fail_fetch(*_args: object) -> Decimal:
        raise AssertionError("historical provider should not be needed")

    monkeypatch.setattr(quotes_service, "_fetch_twelve_data_historical", fail_fetch)
    missing = await quotes_service.get_asset_price(db_session, user.id, asset, target)
    assert missing.price is None

    db_session.add(
        AssetQuote(
            symbol="EXACT",
            currency="BRL",
            price=Decimal("12"),
            as_of=target,
            source="twelve_data",
        )
    )
    await db_session.commit()
    cached = await quotes_service.get_asset_price(db_session, user.id, asset, target)
    assert cached.price == Decimal("12")
    assert cached.is_stale is False
