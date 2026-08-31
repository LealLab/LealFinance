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
from collections.abc import AsyncGenerator, Iterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
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


@pytest.fixture(autouse=True)
def _no_instance_provider_configuration() -> Iterator[None]:
    """Never let optional instance provider settings from a developer's .env
    reach tests. Tests that exercise a provider explicitly enable and patch it.
    """
    original = (
        settings.agents_enabled,
        settings.openexchangerates_app_id,
        settings.twelve_data_api_key,
        settings.brapi_token,
    )
    settings.agents_enabled = False
    settings.openexchangerates_app_id = None
    settings.twelve_data_api_key = None
    settings.brapi_token = None
    try:
        yield
    finally:
        (
            settings.agents_enabled,
            settings.openexchangerates_app_id,
            settings.twelve_data_api_key,
            settings.brapi_token,
        ) = original


@pytest_asyncio.fixture(scope="session")
async def _engine() -> AsyncGenerator[AsyncEngine]:
    engine = create_async_engine(settings.sqlalchemy_database_uri)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(_engine: AsyncEngine) -> AsyncGenerator[AsyncSession]:
    async with _engine.connect() as conn:
        outer = await conn.begin()
        session = AsyncSession(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )

        # Matches the currencies seeded by the migrations (baseline + existing
        # currencies + supported-locale currencies).
        session.add_all(
            [
                Currency(code="BRL", name="Brazilian Real", symbol="R$", decimal_digits=2),
                Currency(code="USD", name="US Dollar", symbol="$", decimal_digits=2),
                Currency(code="EUR", name="Euro", symbol="€", decimal_digits=2),
                Currency(code="GBP", name="Pound Sterling", symbol="£", decimal_digits=2),
                Currency(code="PLN", name="Polish Złoty", symbol="zł", decimal_digits=2),
                Currency(code="RUB", name="Russian Ruble", symbol="₽", decimal_digits=2),
                Currency(code="UAH", name="Ukrainian Hryvnia", symbol="₴", decimal_digits=2),
                Currency(code="TRY", name="Turkish Lira", symbol="₺", decimal_digits=2),
                Currency(code="AED", name="UAE Dirham", symbol="د.إ", decimal_digits=2),
                Currency(code="ILS", name="Israeli New Shekel", symbol="₪", decimal_digits=2),
                Currency(code="INR", name="Indian Rupee", symbol="₹", decimal_digits=2),
                Currency(code="CNY", name="Chinese Yuan", symbol="¥", decimal_digits=2),
                Currency(code="TWD", name="New Taiwan Dollar", symbol="NT$", decimal_digits=2),
                Currency(code="JPY", name="Japanese Yen", symbol="¥", decimal_digits=0),
                Currency(code="KRW", name="South Korean Won", symbol="₩", decimal_digits=0),
                Currency(code="IDR", name="Indonesian Rupiah", symbol="Rp", decimal_digits=2),
                Currency(code="VND", name="Vietnamese Đồng", symbol="₫", decimal_digits=0),
                Currency(code="THB", name="Thai Baht", symbol="฿", decimal_digits=2),
                Currency(code="SEK", name="Swedish Krona", symbol="kr", decimal_digits=2),
                Currency(code="DKK", name="Danish Krone", symbol="kr", decimal_digits=2),
                Currency(code="NOK", name="Norwegian Krone", symbol="kr", decimal_digits=2),
                Currency(code="CZK", name="Czech Koruna", symbol="Kč", decimal_digits=2),
                Currency(code="RON", name="Romanian Leu", symbol="lei", decimal_digits=2),
            ]
        )
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


@pytest_asyncio.fixture
async def other_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient]:
    """A second HTTP client with its own cookie jar, sharing the same
    db_session (and therefore the same test transaction) as `client` - for
    tests that need two independently-authenticated users, e.g. session
    isolation and (from Phase 2 onward) cross-user ownership checks."""

    async def _override_get_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_session] = _override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
