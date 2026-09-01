"""FastAPI application factory."""

import asyncio
import logging
import sys
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool
from starlette.exceptions import HTTPException as StarletteHTTPException

# Same Windows event-loop caveat as alembic/env.py and tests/conftest.py:
# psycopg's async mode requires the selector loop, not the proactor loop
# Windows defaults to. Set here, at the module uvicorn imports as its ASGI
# app target, so it takes effect before uvicorn creates its event loop.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.api.v1.router import api_v1_router
from app.core.config import get_settings
from app.core.errors import (
    AppError,
    app_error_handler,
    http_exception_handler,
    validation_error_handler,
)
from app.core.logging import configure_logging
from app.services.exchange_rates import ensure_rates_cached

settings = get_settings()
logger = logging.getLogger(__name__)


async def _warm_exchange_rates() -> None:
    """Populate today's rate cache at startup so a newly added provider key
    takes effect without waiting up to six hours for the Celery beat run.
    A no-op once today's rows exist, or with no key. Its own short-lived
    engine - same event-loop reasoning as app/workers/tasks/rates.py."""
    engine = create_async_engine(settings.sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            await ensure_rates_cached(db)
            await db.commit()
    except Exception:
        logger.warning("Startup exchange-rate warm-up failed", exc_info=True)
    finally:
        await engine.dispose()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    configure_logging(settings.log_level)
    await _warm_exchange_rates()
    yield


def create_app() -> FastAPI:
    # The interactive docs expose the whole API surface; keep them off in
    # production, where every deployed instance would otherwise serve them.
    docs_enabled = settings.environment != "production"
    app = FastAPI(
        title="LealFinance API",
        version=settings.app_version,
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-XSRF-TOKEN"],
        expose_headers=["X-Total-Count"],
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.include_router(api_v1_router)

    return app


app = create_app()
