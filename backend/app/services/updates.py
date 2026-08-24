"""Update-availability check against this project's public GitHub releases.

Fetches the latest release tag from GitHub's public API (anonymous GET, no
instance data leaves the machine), cached for 6 hours to avoid hammering the
API on every admin page load. Provider failures never propagate as an error -
same convention as app/services/exchange_rates.py: a GitHub outage should
never be why the admin update-status endpoint fails.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.core.config import get_settings
from app.schemas.update import UpdateStatusRead

logger = logging.getLogger(__name__)

_URL = "https://api.github.com/repos/LealLab/LealFinance/releases/latest"
_TTL = timedelta(hours=6)

# ponytail: module-level cache, per-process - each uvicorn worker fetches its
# own copy every 6h. Move to Redis only if worker count makes that rate matter.
_cache: tuple[datetime, dict[str, Any] | None] | None = None


async def _fetch_latest_release() -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(_URL)
            response.raise_for_status()
            return dict(response.json())
    except Exception:
        logger.warning("Failed to fetch latest release from GitHub", exc_info=True)
        return None


async def get_latest_release() -> dict[str, Any] | None:
    global _cache
    now = datetime.now(UTC)
    if _cache is not None:
        fetched_at, result = _cache
        if now - fetched_at < _TTL:
            return result

    result = await _fetch_latest_release()
    _cache = (now, result)
    return result


async def get_update_status() -> UpdateStatusRead:
    settings = get_settings()
    if not settings.update_check_enabled:
        return UpdateStatusRead(
            current_version=settings.app_version,
            latest_version=None,
            update_available=False,
            release_url=None,
        )

    release = await get_latest_release()
    if release is None:
        return UpdateStatusRead(
            current_version=settings.app_version,
            latest_version=None,
            update_available=False,
            release_url=None,
        )

    latest = release["tag_name"]
    release_url = release["html_url"]
    # ponytail: string compare, not semver - pinning an older TAG correctly
    # reports an update; running a tag newer than the latest release can't
    # happen from published images. Parse versions only if that changes.
    update_available = (
        latest is not None and settings.app_version != "dev" and latest != settings.app_version
    )

    return UpdateStatusRead(
        current_version=settings.app_version,
        latest_version=latest,
        update_available=update_available,
        release_url=release_url,
    )
