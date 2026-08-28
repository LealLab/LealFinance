"""Backfill of conversions frozen at the 1:1 fallback -
app/services/rate_backfill.py."""

from datetime import date
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.transaction import Transaction
from app.services import exchange_rates as rates_service
from app.services.rate_backfill import backfill_fallback_conversions
from tests.factories import login_as, make_user

_TX_DATE = date(2026, 1, 5)


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _account(client: AsyncClient, currency: str) -> str:
    response = await client.post(
        "/api/v1/accounts",
        json={"name": f"{currency} acct", "type": "checking", "currency": currency},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _fallback_transfer(client: AsyncClient) -> str:
    """A BRL->USD transfer whose conversion was recorded at the 1:1 fallback."""
    src = await _account(client, "BRL")
    dst = await _account(client, "USD")
    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": _TX_DATE.isoformat(),
            "amount": "100",
            "currency": "BRL",
            "account_id": src,
            "to_account_id": dst,
            "description": "Rushed transfer",
            "conversion": {"currency": "USD", "amount": "100", "rate": "1", "source": "fallback"},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _stub(monkeypatch: pytest.MonkeyPatch, rates: dict[str, Decimal]) -> None:
    monkeypatch.setattr(get_settings(), "openexchangerates_app_id", "test-key")

    async def _fake(app_id: str, as_of: date) -> dict[str, Decimal]:
        return dict(rates)

    monkeypatch.setattr(rates_service, "_fetch_usd_rates", _fake)


async def test_backfill_rewrites_a_fallback_conversion_with_the_real_rate(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _authed(client, db_session, "backfill-heal@example.com")
    tx_id = await _fallback_transfer(client)
    _stub(monkeypatch, {"USD": Decimal("1"), "BRL": Decimal("5.25")})

    healed = await backfill_fallback_conversions(db_session)
    assert healed == 1

    tx = await db_session.get(Transaction, tx_id)
    assert tx is not None
    assert tx.conversion_source == "quote"
    # BRL->USD bridged as 1 / 5.25, then 100 * rate rounded to USD's 2 dp.
    assert tx.conversion_rate == (Decimal("1") / Decimal("5.25")).quantize(Decimal("0.0000000001"))
    assert tx.conversion_amount == Decimal("19.05")


async def test_backfill_leaves_a_row_untouched_when_no_real_rate_resolves(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _authed(client, db_session, "backfill-skip@example.com")
    tx_id = await _fallback_transfer(client)
    # Provider response omits BRL, so the bridge still can't resolve BRL->USD.
    _stub(monkeypatch, {"USD": Decimal("1"), "EUR": Decimal("0.92")})

    healed = await backfill_fallback_conversions(db_session)
    assert healed == 0

    tx = await db_session.get(Transaction, tx_id)
    assert tx is not None
    assert tx.conversion_source == "fallback"
    assert tx.conversion_rate == Decimal("1")


async def test_backfill_respects_the_per_run_provider_budget(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _authed(client, db_session, "backfill-budget@example.com")
    await _fallback_transfer(client)
    _stub(monkeypatch, {"USD": Decimal("1"), "BRL": Decimal("5.25")})

    healed = await backfill_fallback_conversions(db_session, max_provider_dates=0)
    assert healed == 0


async def test_backfill_is_a_noop_without_any_fallback_rows(db_session: AsyncSession) -> None:
    assert await backfill_fallback_conversions(db_session) == 0
