"""HTTP coverage for user-owned market-data credential management."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.market_data_credentials as credentials_service
from app.core.config import get_settings
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def test_credentials_require_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/market-data/credentials")
    assert response.status_code == 401


async def test_credentials_crud_precedence_and_secret_redaction(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings().model_copy(update={"twelve_data_api_key": "env-twelve-secret"})
    monkeypatch.setattr(credentials_service, "get_settings", lambda: settings)
    await _authed(client, db_session, "market-data-crud@example.com")

    initial = await client.get("/api/v1/market-data/credentials")
    assert initial.status_code == 200
    twelve = next(row for row in initial.json() if row["provider"] == "twelve_data")
    assert twelve == {"provider": "twelve_data", "configured": True, "source": "env"}
    assert "env-twelve-secret" not in initial.text

    linked = await client.put(
        "/api/v1/market-data/credentials/twelve_data",
        json={"api_key": "user-twelve-secret"},
    )
    assert linked.status_code == 200, linked.text
    assert linked.json() == {
        "provider": "twelve_data",
        "configured": True,
        "source": "user",
    }
    assert "user-twelve-secret" not in linked.text
    assert "env-twelve-secret" not in linked.text

    deleted = await client.delete("/api/v1/market-data/credentials/twelve_data")
    assert deleted.status_code == 204

    after = await client.get("/api/v1/market-data/credentials")
    assert next(row for row in after.json() if row["provider"] == "twelve_data")["source"] == "env"
    assert "user-twelve-secret" not in after.text


async def test_credentials_are_isolated_and_missing_delete_is_404(
    client: AsyncClient,
    other_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    await _authed(client, db_session, "market-data-owner@example.com")
    await _authed(other_client, db_session, "market-data-other@example.com")

    linked = await client.put(
        "/api/v1/market-data/credentials/brapi",
        json={"api_key": "owner-token"},
    )
    assert linked.status_code == 200

    other_rows = await other_client.get("/api/v1/market-data/credentials")
    brapi = next(row for row in other_rows.json() if row["provider"] == "brapi")
    assert brapi == {"provider": "brapi", "configured": False, "source": "none"}

    missing = await other_client.delete("/api/v1/market-data/credentials/brapi")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "market_data_credential.not_found"
    assert "owner-token" not in other_rows.text


async def test_unknown_provider_is_rejected(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "market-data-unknown@example.com")

    link = await client.put(
        "/api/v1/market-data/credentials/unknown",
        json={"api_key": "secret"},
    )
    assert link.status_code == 422
    assert link.json()["error"]["code"] == "market_data_credential.provider_unknown"

    unlink = await client.delete("/api/v1/market-data/credentials/unknown")
    assert unlink.status_code == 422
    assert unlink.json()["error"]["code"] == "market_data_credential.provider_unknown"
