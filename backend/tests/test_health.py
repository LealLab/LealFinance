from httpx import AsyncClient


async def test_liveness_ok(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_readiness_ok_when_dependencies_reachable(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] is True


async def test_currencies_returns_supported_locale_currencies(client: AsyncClient) -> None:
    response = await client.get("/api/v1/meta/currencies")
    assert response.status_code == 200
    currencies = response.json()
    by_code = {currency["code"]: currency for currency in currencies}
    assert {
        "BRL",
        "USD",
        "EUR",
        "GBP",
        "PLN",
        "RUB",
        "UAH",
        "TRY",
        "AED",
        "ILS",
        "INR",
        "CNY",
        "TWD",
        "JPY",
        "KRW",
        "IDR",
        "VND",
        "THB",
        "SEK",
        "DKK",
        "NOK",
        "CZK",
        "RON",
    } <= by_code.keys()
    assert by_code["JPY"]["decimal_digits"] == 0


async def test_public_settings_has_typed_agents_flag(client: AsyncClient) -> None:
    response = await client.get("/api/v1/meta/settings")

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["default_currency"], str)
    assert isinstance(body["default_locale"], str)
    assert isinstance(body["agents_enabled"], bool)
