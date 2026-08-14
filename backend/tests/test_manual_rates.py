"""Manual exchange-rate CRUD and their precedence in
app/services/exchange_rates.py::get_exchange_rate."""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def test_create_manual_rate(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")

    response = await client.put("/api/v1/manual-rates/USD_BRL/2026-01-15", json={"rate": "5.20"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["base_code"] == "USD"
    assert body["quote_code"] == "BRL"
    assert body["rate"] == "5.2000000000"
    assert body["as_of"] == "2026-01-15"


async def test_upsert_manual_rate_updates_existing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bob@example.com")

    first = await client.put("/api/v1/manual-rates/USD_BRL/2026-01-15", json={"rate": "5.00"})
    second = await client.put("/api/v1/manual-rates/USD_BRL/2026-01-15", json={"rate": "5.30"})

    assert first.json()["id"] == second.json()["id"]
    assert second.json()["rate"] == "5.3000000000"

    list_response = await client.get("/api/v1/manual-rates")
    matching = [
        row
        for row in list_response.json()
        if row["base_code"] == "USD" and row["quote_code"] == "BRL" and row["as_of"] == "2026-01-15"
    ]
    assert len(matching) == 1


async def test_manual_rate_same_currency_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "carol@example.com")

    response = await client.put("/api/v1/manual-rates/BRL_BRL/2026-01-15", json={"rate": "1.00"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "manual_rate.same_currency"


async def test_manual_rate_invalid_pair_format_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "dave@example.com")

    response = await client.put("/api/v1/manual-rates/notapair/2026-01-15", json={"rate": "1.00"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "manual_rate.invalid_pair"


async def test_manual_rate_unknown_currency_is_not_found(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "erin@example.com")

    response = await client.put("/api/v1/manual-rates/XYZ_BRL/2026-01-15", json={"rate": "1.00"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "currency.not_found"


async def test_delete_manual_rate(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "frank@example.com")
    create_response = await client.put(
        "/api/v1/manual-rates/USD_BRL/2026-01-15", json={"rate": "5.20"}
    )
    rate_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/manual-rates/{rate_id}")
    assert delete_response.status_code == 204

    list_response = await client.get("/api/v1/manual-rates")
    assert all(row["id"] != rate_id for row in list_response.json())


async def test_manual_rate_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")
    await _authed(other_client, db_session, "heidi@example.com")
    create_response = await client.put(
        "/api/v1/manual-rates/USD_BRL/2026-01-15", json={"rate": "5.20"}
    )
    rate_id = create_response.json()["id"]

    delete_response = await other_client.delete(f"/api/v1/manual-rates/{rate_id}")
    assert delete_response.status_code == 404
    assert delete_response.json()["error"]["code"] == "manual_rate.not_found"

    list_response = await other_client.get("/api/v1/manual-rates")
    assert all(row["id"] != rate_id for row in list_response.json())


async def test_manual_rate_outranks_fallback_in_resolution(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "ivan@example.com")
    await client.put("/api/v1/manual-rates/USD_BRL/2026-01-01", json={"rate": "5.20"})

    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL", "as_of": "2026-01-15"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "manual"
    assert body["is_fallback"] is False
    assert body["rate"] == "5.2000000000"


async def test_inverse_manual_rate_is_used_when_direct_pair_not_set(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "judy@example.com")
    # Only BRL->USD is set; querying USD->BRL should use the inverse.
    await client.put("/api/v1/manual-rates/BRL_USD/2026-01-01", json={"rate": "0.2"})

    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL", "as_of": "2026-01-15"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "manual"
    assert body["rate"] == "5.0000000000"


async def test_manual_rate_not_effective_before_its_as_of_date_falls_back(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "kate@example.com")
    await client.put("/api/v1/manual-rates/USD_BRL/2026-06-01", json={"rate": "5.50"})

    # Requesting a rate effective before the manual rate's as_of date - the
    # manual rate must not apply, so this falls all the way to the 1:1
    # fallback (no provider key configured in tests).
    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL", "as_of": "2026-01-01"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fallback_1to1"
    assert body["is_fallback"] is True


async def test_newest_manual_rate_on_or_before_date_wins(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "leo@example.com")
    await client.put("/api/v1/manual-rates/USD_BRL/2026-01-01", json={"rate": "5.00"})
    await client.put("/api/v1/manual-rates/USD_BRL/2026-02-01", json={"rate": "5.50"})

    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL", "as_of": "2026-03-01"}
    )
    assert response.status_code == 200
    assert response.json()["rate"] == "5.5000000000"
