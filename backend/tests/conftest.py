"""Shared test fixtures.

Tests run against a real Postgres instance (see docs/development.md for how
to start one locally; CI provides one as a service container). The schema is
created once per test *session* directly from the ORM metadata - this is the
same schema the migration in alembic/versions/ is hand-written to match,
which is round-trip tested separately (see docs/development.md).

Each test then runs inside its own outer transaction that is rolled back at
teardown, with the session bound to it via SQLAlchemy's documented "join a
Session into an external transaction" pattern
(`join_transaction_mode="create_savepoint"`): a service calling
`session.commit()` (see app/services/exchange_rates.py) only commits an
inner SAVEPOINT, so the outer transaction - and therefore isolation between
tests - survives it. This replaces a per-test `create_all`/`drop_all`, which
becomes the dominant cost once the schema has more than a couple of tables.
"""

import asyncio
import sys
from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.core.config import get_settings
from app.core.db import get_session
from app.main import app
from app.models import Currency
from app.models.base import Base

# Same Windows event-loop caveat as alembic/env.py: psycopg's async mode
# needs the selector loop, not the proactor loop Windows defaults to.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

settings = get_settings()


@pytest_asyncio.fixture(scope="session")
async def _engine() -> AsyncGenerator[AsyncEngine]:
    engine = create_async_engine(settings.sqlalchemy_database_uri)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(_engine: AsyncEngine) -> AsyncGenerator[AsyncSession]:
    async with _engine.connect() as conn:
        outer = await conn.begin()
        session = AsyncSession(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )

        session.add(Currency(code="BRL", name="Brazilian Real", symbol="R$", decimal_digits=2))
        await session.commit()

        yield session

        await session.close()
        await outer.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient]:
    async def _override_get_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_session] = _override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
