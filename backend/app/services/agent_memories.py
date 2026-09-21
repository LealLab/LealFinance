"""Durable per-user facts the AI assistant carries between conversations.

The whole list is folded into every system prompt (`app/agents/prompt.py::build`),
so it is capped: past `MAX_MEMORIES` the oldest rows are dropped.
"""

from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_memory import AgentMemory
from app.services.ownership import get_owned, owned

MAX_MEMORIES = 100


async def list_memories(db: AsyncSession, user_id: UUID) -> list[AgentMemory]:
    """Newest first."""
    result = await db.execute(owned(AgentMemory, user_id).order_by(AgentMemory.created_at.desc()))
    return list(result.scalars().all())


async def remember(db: AsyncSession, user_id: UUID, content: str) -> AgentMemory:
    """Store a fact; saving one the user already has returns the existing row."""
    existing = await db.scalar(owned(AgentMemory, user_id).where(AgentMemory.content == content))
    if existing is not None:
        return existing

    # clock_timestamp() rather than the column's now(): now() is frozen for the whole
    # transaction, which would make "oldest" ambiguous for rows saved within one.
    memory = AgentMemory(user_id=user_id, content=content, created_at=func.clock_timestamp())
    db.add(memory)
    await db.flush()

    keep = (
        select(AgentMemory.id)
        .where(AgentMemory.user_id == user_id)
        .order_by(AgentMemory.created_at.desc(), AgentMemory.id)
        .limit(MAX_MEMORIES)
    )
    await db.execute(
        delete(AgentMemory).where(AgentMemory.user_id == user_id, AgentMemory.id.not_in(keep))
    )
    await db.commit()
    await db.refresh(memory)
    return memory


async def delete_memory(db: AsyncSession, user_id: UUID, memory_id: UUID) -> None:
    memory = await get_owned(db, AgentMemory, memory_id, user_id)
    await db.delete(memory)
    await db.commit()
