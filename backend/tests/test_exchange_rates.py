"""Tests for the on-demand currency conversion service.

See app/services/exchange_rates.py - no network calls happen in these
tests; `_fetch_usd_rates` is monkeypatched everywhere a live lookup would
otherwise run, and the cache-hit / identity paths implicitly prove it is
*not* called.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.services import exchange_rates as rates_service
from tests.factories import login_as, make_user

# "how many X per 1 USD" - the shape _fetch_usd_rates returns.
_USD_RATES = {
    "USD": Decimal("1"),
    "BRL": Decimal("5.25"),
    "EUR": Decimal("0.92"),
}


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


def _stub_fetch(monkeypatch: pytest.MonkeyPatch, rates: dict[str, Decimal]) -> list[date]:
    """Replace the provider call with a canned table; returns a list that
    records the `as_of` of every call so tests can assert the count."""
    calls: list[date] = []

    async def _fake(app_id: str, as_of: date) -> dict[str, Decimal]:
        calls.append(as_of)
        return dict(rates)

    monkeypatch.setattr(rates_service, "_fetch_usd_rates", _fake)
    return calls


async def test_identity_pair_returns_one_without_touching_settings_or_db(
    db_session: AsyncSession,
) -> None:
    result = await rates_service.get_exchange_rate(db_session, "BRL", "BRL")
    assert result.rate == Decimal("1")
    assert result.is_fallback is False
    assert result.source == rates_service.IDENTITY_SOURCE


async def test_no_api_key_configured_falls_back_to_one_to_one(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Falsy, not "is None": a .env with OPENEXCHANGERATES_APP_ID= (present,
    # empty) is exactly as "not configured" as the key being absent.
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "")

    result = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert result.rate == Decimal("1")
    assert result.is_fallback is True
    assert result.source == rates_service.FALLBACK_SOURCE


async def test_provider_failure_falls_back_rather_than_raising(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")

    async def _boom(app_id: str, as_of: date) -> dict[str, Decimal]:
        raise RuntimeError("simulated network failure")

    monkeypatch.setattr(rates_service, "_fetch_usd_rates", _boom)

    result = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert result.rate == Decimal("1")
    assert result.is_fallback is True
    assert result.source == rates_service.FALLBACK_SOURCE


async def test_one_fetch_serves_every_pair_for_the_day(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point of the USD-anchored cache: a single provider call
    populates every currency, and any further pair is a local division."""
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")
    calls = _stub_fetch(monkeypatch, _USD_RATES)

    first = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert first.rate == Decimal("5.25")
    assert first.is_fallback is False
    assert first.source == rates_service.OXR_SOURCE
    assert len(calls) == 1

    # A different pair, never asked for before - resolves from the same
    # fetch with no new provider call, via the USD bridge (0.92 / 5.25).
    cross = await rates_service.get_exchange_rate(db_session, "BRL", "EUR")
    assert cross.is_fallback is False
    assert cross.rate == (Decimal("0.92") / Decimal("5.25")).quantize(Decimal("0.0000000001"))
    assert len(calls) == 1

    # And the original pair is now a plain cache hit.
    again = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert again.rate == Decimal("5.2500000000")
    assert len(calls) == 1


async def test_usd_as_quote_bridges_correctly(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")
    _stub_fetch(monkeypatch, _USD_RATES)

    result = await rates_service.get_exchange_rate(db_session, "BRL", "USD")
    assert result.is_fallback is False
    # 1 USD per 1 USD divided by 5.25 BRL per USD.
    assert result.rate == (Decimal("1") / Decimal("5.25")).quantize(Decimal("0.0000000001"))


async def test_past_date_uses_historical_endpoint_and_caches_under_that_date(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")
    calls = _stub_fetch(monkeypatch, _USD_RATES)
    past = date.today() - timedelta(days=30)

    result = await rates_service.get_exchange_rate(db_session, "USD", "BRL", as_of=past)
    assert result.rate == Decimal("5.25")
    assert result.as_of == past
    assert calls == [past]

    # Today's cache is untouched - a lookup for today still needs its own fetch.
    await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert calls == [past, date.today()]


async def test_unrecognized_currency_pair_returns_flagged_fallback(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """XYZ isn't in the `currencies` table - exchange_rates has a foreign
    key to it, so no USD-anchored row can be stored and the bridge cannot
    resolve. A flagged 1:1 is the honest answer, never a silent number."""
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")
    _stub_fetch(monkeypatch, {**_USD_RATES, "XYZ": Decimal("2")})

    result = await rates_service.get_exchange_rate(db_session, "XYZ", "BRL")
    assert result.is_fallback is True
    assert result.source == rates_service.FALLBACK_SOURCE


async def test_refresh_rates_upserts_one_row_per_known_currency(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")
    _stub_fetch(monkeypatch, _USD_RATES)

    count = await rates_service.refresh_rates(db_session, date.today())
    # USD itself is not stored (identity); BRL and EUR are.
    assert count == 2

    # Idempotent - a second run updates in place rather than erroring.
    assert await rates_service.refresh_rates(db_session, date.today()) == 2


async def test_exchange_rate_endpoint_requires_authentication(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL"}
    )
    assert response.status_code == 401


async def test_exchange_rate_endpoint_returns_fallback_with_warning_flag(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "")
    await _authed(client, db_session, "exchange-rate-endpoint@example.com")

    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_fallback"] is True
    assert body["rate"] == "1"
    assert isinstance(body["rate"], str)
