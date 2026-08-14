"""Liveness and readiness probes.

Liveness only proves the process is up. Readiness proves its dependencies
(database, cache) are actually reachable, and must be able to fail - see
docs/development.md for how this is exercised in verification.
"""

from fastapi import APIRouter, Response, status
from redis.asyncio import Redis

from app.core.config import get_settings
from app.core.db import check_database_connection

router = APIRouter(prefix="/health", tags=["health"])
settings = get_settings()


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def readiness(response: Response) -> dict[str, object]:
    db_ok = await check_database_connection()

    redis_ok = False
    try:
        client: Redis = Redis.from_url(settings.celery_broker_url, socket_timeout=2)
        redis_ok = bool(await client.ping())
        await client.aclose()
    except Exception:
        redis_ok = False

    ready = db_ok and redis_ok
    response.status_code = status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ok" if ready else "unavailable", "database": db_ok, "redis": redis_ok}
