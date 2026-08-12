"""Shared test fixtures.

Tests run against a real Postgres instance (see docs/development.md for how
to start one locally; CI provides one as a service container). Schema is
created directly from the ORM metadata per test function and torn down
afterwards — this is faster than running Alembic per test and exercises the
same models the migration was hand-written to match (see
alembic/versions/b0b0888983a8_*.py, which is round-trip tested separately).
"""

import asyncio
import sys
from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.db import get_session
from app.main import app
from app.models.base import Base
from app.models.currency import Currency

# Same Windows event-loop caveat as alembic/env.py: psycopg's async mode
# needs the selector loop, not the proactor loop Windows defaults to.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

settings = get_settings()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession]:
    engine = create_async_engine(settings.sqlalchemy_database_uri)
    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as session:
        session.add(Currency(code="BRL", name="Brazilian Real", symbol="R$", decimal_digits=2))
        await session.commit()

        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient]:
    async def _override_get_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_session] = _override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
