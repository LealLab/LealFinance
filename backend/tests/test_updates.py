"""Tests for the update-availability check.

See app/services/updates.py - no network calls happen in these tests; the
provider fetch is monkeypatched everywhere.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.updates as updates_module
from app.core.config import get_settings
from app.models.user import ROLE_ADMIN, ROLE_MEMBER
from tests.factories import login_as, make_user


async def _authed(
    client: AsyncClient, db_session: AsyncSession, email: str, role: str = ROLE_ADMIN
) -> None:
    user, password = await make_user(db_session, email=email, role=role)
    await login_as(client, email=user.email, password=password)


@pytest.fixture(autouse=True)
def _reset_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(updates_module, "_cache", None)


async def test_update_status_requires_admin(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "member-updates@example.com", role=ROLE_MEMBER)

    response = await client.get("/api/v1/meta/update-status")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "auth.admin_required"


async def test_update_check_disabled_never_calls_provider(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "update_check_enabled", False)
    await _authed(client, db_session, "disabled-updates@example.com")

    async def _boom() -> dict | None:
        raise AssertionError("provider fetch must not be called when disabled")

    monkeypatch.setattr(updates_module, "_fetch_latest_release", _boom)

    response = await client.get("/api/v1/meta/update-status")
    assert response.status_code == 200
    body = response.json()
    assert body["update_available"] is False
    assert body["latest_version"] is None
    assert body["release_url"] is None


async def test_dev_build_never_reports_update_available(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "update_check_enabled", True)
    await _authed(client, db_session, "dev-build@example.com")

    async def _fake_fetch() -> dict | None:
        return {
            "tag_name": "v9.9.9",
            "html_url": "https://github.com/LealLab/LealFinance/releases/tag/v9.9.9",
        }

    monkeypatch.setattr(updates_module, "_fetch_latest_release", _fake_fetch)

    response = await client.get("/api/v1/meta/update-status")
    assert response.status_code == 200
    body = response.json()
    assert body["current_version"] == "dev"
    assert body["update_available"] is False


async def test_tagged_build_behind_latest_reports_update_available(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "update_check_enabled", True)
    monkeypatch.setattr(get_settings(), "app_version", "v1.0.0")
    await _authed(client, db_session, "tagged-build@example.com")

    async def _fake_fetch() -> dict | None:
        return {
            "tag_name": "v1.2.0",
            "html_url": "https://github.com/LealLab/LealFinance/releases/tag/v1.2.0",
        }

    monkeypatch.setattr(updates_module, "_fetch_latest_release", _fake_fetch)

    response = await client.get("/api/v1/meta/update-status")
    assert response.status_code == 200
    body = response.json()
    assert body["current_version"] == "v1.0.0"
    assert body["latest_version"] == "v1.2.0"
    assert body["update_available"] is True
    assert body["release_url"] == "https://github.com/LealLab/LealFinance/releases/tag/v1.2.0"
