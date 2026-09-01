"""Tests for the on-demand currency conversion service.

See app/services/exchange_rates.py. `get_exchange_rate` is a pure read; the
cache is filled by `refresh_rates`, which these tests drive directly with a
monkeypatched `_fetch_usd_rates` (no network). The autouse
`_no_exchange_rate_provider` fixture in conftest.py blanks the key, so a
test that needs the provider sets it back explicitly.
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
_QUANTUM = Decimal("0.0000000001")


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


def _stub_fetch(monkeypatch: pytest.MonkeyPatch, rates: dict[str, Decimal]) -> list[date]:
    """Replace the provider call with a canned table; the returned list
    records the `as_of` of every call so a test can assert the count."""
    calls: list[date] = []

    async def _fake(app_id: str, as_of: date) -> dict[str, Decimal]:
        calls.append(as_of)
        return dict(rates)

    monkeypatch.setattr(rates_service, "_fetch_usd_rates", _fake)
    return calls


def _with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")


async def test_identity_pair_returns_one_without_touching_settings_or_db(
    db_session: AsyncSession,
) -> None:
    result = await rates_service.get_exchange_rate(db_session, "BRL", "BRL")
    assert result.rate == Decimal("1")
    assert result.is_fallback is False
    assert result.source == rates_service.IDENTITY_SOURCE


async def test_cold_cache_falls_back_to_one_to_one(db_session: AsyncSession) -> None:
    """A lookup never fetches - an unpopulated cache means the flagged
    fallback, whether or not a key is configured."""
    result = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert result.rate == Decimal("1")
    assert result.is_fallback is True
    assert result.source == rates_service.FALLBACK_SOURCE


async def test_one_refresh_serves_every_pair_for_the_day(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The USD-anchored cache: one provider call populates every currency,
    and every pair after that is a local division with no further call."""
    _with_key(monkeypatch)
    calls = _stub_fetch(monkeypatch, _USD_RATES)

    upserted = await rates_service.refresh_rates(db_session, date.today())
    assert upserted == 2  # BRL and EUR; USD is the anchor, not stored
    assert len(calls) == 1

    direct = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert direct.rate == Decimal("5.25")
    assert direct.is_fallback is False
    assert direct.source == rates_service.OXR_SOURCE

    # A pair never asked for, resolved from the same data (0.92 / 5.25).
    cross = await rates_service.get_exchange_rate(db_session, "BRL", "EUR")
    assert cross.is_fallback is False
    assert cross.rate == (Decimal("0.92") / Decimal("5.25")).quantize(_QUANTUM)

    # USD as the quote side bridges too (1 / 5.25).
    inverse = await rates_service.get_exchange_rate(db_session, "BRL", "USD")
    assert inverse.rate == (Decimal("1") / Decimal("5.25")).quantize(_QUANTUM)

    assert len(calls) == 1  # nothing above hit the provider again


async def test_refresh_is_idempotent(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _with_key(monkeypatch)
    _stub_fetch(monkeypatch, _USD_RATES)

    assert await rates_service.refresh_rates(db_session, date.today()) == 2
    # Second run updates the same rows in place rather than erroring.
    assert await rates_service.refresh_rates(db_session, date.today()) == 2


async def test_refresh_without_key_is_a_noop(db_session: AsyncSession) -> None:
    assert await rates_service.refresh_rates(db_session, date.today()) == 0


async def test_past_date_uses_the_historical_endpoint_and_its_own_cache_key(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _with_key(monkeypatch)
    calls = _stub_fetch(monkeypatch, _USD_RATES)
    past = date.today() - timedelta(days=30)

    await rates_service.refresh_rates(db_session, past)
    result = await rates_service.get_exchange_rate(db_session, "USD", "BRL", as_of=past)
    assert result.rate == Decimal("5.25")
    assert result.as_of == past
    assert calls == [past]

    # A later date with no exact row of its own carries the newest rate on or
    # before it forward, reported at that row's date - never the 1:1 fallback.
    today = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert today.is_fallback is False
    assert today.rate == Decimal("5.25")
    assert today.as_of == past


async def test_unknown_currency_is_left_uncached(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """XYZ isn't in the `currencies` table - exchange_rates has a foreign
    key to it, so no USD-anchored row can be stored and the bridge cannot
    resolve. A flagged 1:1 is the honest answer, never a silent number."""
    _with_key(monkeypatch)
    _stub_fetch(monkeypatch, {**_USD_RATES, "XYZ": Decimal("2")})

    await rates_service.refresh_rates(db_session, date.today())
    result = await rates_service.get_exchange_rate(db_session, "XYZ", "BRL")
    assert result.is_fallback is True
    assert result.source == rates_service.FALLBACK_SOURCE


async def test_warm_cache_for_populates_a_currency_then_stays_quiet(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _with_key(monkeypatch)
    calls = _stub_fetch(monkeypatch, _USD_RATES)

    await rates_service.warm_cache_for(db_session, "BRL")
    assert len(calls) == 1
    resolved = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert resolved.is_fallback is False

    # Already covered for today - no second call.
    await rates_service.warm_cache_for(db_session, "BRL")
    assert len(calls) == 1


async def test_warm_cache_for_never_raises_on_provider_failure(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _with_key(monkeypatch)

    async def _boom(app_id: str, as_of: date) -> dict[str, Decimal]:
        raise RuntimeError("simulated network failure")

    monkeypatch.setattr(rates_service, "_fetch_usd_rates", _boom)

    await rates_service.warm_cache_for(db_session, "BRL")  # must not raise
    result = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert result.is_fallback is True


async def test_exchange_rate_endpoint_requires_authentication(client: AsyncClient) -> None:
    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL"}
    )
    assert response.status_code == 401


async def test_exchange_rate_endpoint_returns_fallback_with_warning_flag(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "exchange-rate-endpoint@example.com")

    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_fallback"] is True
    assert body["rate"] == "1"
    assert isinstance(body["rate"], str)
