"""Tests for the on-demand currency conversion service.

See app/services/exchange_rates.py — no network calls happen in these
tests; the provider fetch is monkeypatched everywhere except implicitly
proving it's *not* called (cache hit, identity pair).
"""

from datetime import date
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.currency import Currency
from app.services import exchange_rates as rates_service


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
    # empty) is exactly as "not configured" as the key being absent
    # entirely — `if not settings.openexchangerates_app_id` in the service
    # treats them the same, so the test should too, rather than assuming a
    # specific unset representation.
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "")

    result = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert result.rate == Decimal("1")
    assert result.is_fallback is True
    assert result.source == rates_service.FALLBACK_SOURCE


async def test_provider_failure_falls_back_rather_than_raising(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")

    async def _boom(app_id: str, base_code: str, quote_code: str) -> Decimal:
        raise RuntimeError("simulated network failure")

    monkeypatch.setattr(rates_service, "_fetch_rate_from_provider", _boom)

    result = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert result.rate == Decimal("1")
    assert result.is_fallback is True
    assert result.source == rates_service.FALLBACK_SOURCE


async def test_successful_fetch_is_cached_and_reused_without_refetching(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")
    db_session.add(Currency(code="USD", name="US Dollar", symbol="$", decimal_digits=2))
    await db_session.commit()

    call_count = 0

    async def _fake_fetch(app_id: str, base_code: str, quote_code: str) -> Decimal:
        nonlocal call_count
        call_count += 1
        return Decimal("5.25")

    monkeypatch.setattr(rates_service, "_fetch_rate_from_provider", _fake_fetch)

    first = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert first.rate == Decimal("5.25")
    assert first.is_fallback is False
    assert first.source == rates_service.OXR_SOURCE
    assert call_count == 1

    # Second call for the same pair/day should hit the cache, not the provider.
    second = await rates_service.get_exchange_rate(db_session, "USD", "BRL")
    assert second.rate == Decimal("5.2500000000")
    assert second.source == rates_service.OXR_SOURCE
    assert call_count == 1


async def test_unrecognized_currency_pair_returns_rate_without_caching(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """XYZ isn't in the `currencies` table — exchange_rates has a foreign
    key to it, so this must not attempt to persist (and must not crash)."""
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")

    async def _fake_fetch(app_id: str, base_code: str, quote_code: str) -> Decimal:
        return Decimal("2")

    monkeypatch.setattr(rates_service, "_fetch_rate_from_provider", _fake_fetch)

    result = await rates_service.get_exchange_rate(db_session, "XYZ", "BRL")
    assert result.rate == Decimal("2")
    assert result.is_fallback is False

    cached = await rates_service._get_cached_rate(db_session, "XYZ", "BRL", date.today())
    assert cached is None


async def test_exchange_rate_endpoint_returns_fallback_with_warning_flag(
    client: AsyncClient,
) -> None:
    response = await client.get(
        "/api/v1/meta/exchange-rate", params={"base": "USD", "quote": "BRL"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_fallback"] is True
    assert body["rate"] == "1"
    assert isinstance(body["rate"], str)
