"""Exercise memory deduplication with independent database transactions."""

import asyncio

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import Currency
from app.models.user import User
from app.services import agent_memories


async def test_concurrent_duplicate_memories(_engine: AsyncEngine) -> None:
    # These rows must be committed so both connections can see the same user.
    async with AsyncSession(_engine, expire_on_commit=False) as setup:
        setup.add(Currency(code="USD", name="US Dollar", symbol="$", decimal_digits=2))
        await setup.commit()
        user = User(
            email="memory-race@example.com",
            normalized_email="memory-race@example.com",
            password_hash="unused",
            display_name="Memory race",
            display_currency="USD",
        )
        setup.add(user)
        await setup.commit()
        user_id = user.id

    barrier = asyncio.Barrier(2)
    missing_reads = asyncio.Barrier(2)

    class RacingSession(AsyncSession):
        async def scalar(self, statement, *args, **kwargs):
            result = await super().scalar(statement, *args, **kwargs)
            # Force both pre-insert lookups to miss if deduplication uses a SELECT.
            if statement.is_select and result is None:
                await missing_reads.wait()
            return result

    async def save() -> object:
        async with RacingSession(_engine, expire_on_commit=False) as db:
            await barrier.wait()
            memory = await agent_memories.remember(db, user_id, "Gets paid on the 5th")
            # A duplicate must leave the session usable, not in a failed transaction.
            assert len(await agent_memories.list_memories(db, user_id)) == 1
            return memory.id

    try:
        results = await asyncio.wait_for(
            asyncio.gather(save(), save(), return_exceptions=True), timeout=10
        )
        assert not any(isinstance(result, BaseException) for result in results), results
        assert results[0] == results[1]
    finally:
        async with AsyncSession(_engine) as cleanup:
            await cleanup.execute(delete(User).where(User.id == user_id))
            await cleanup.execute(delete(Currency).where(Currency.code == "USD"))
            await cleanup.commit()
