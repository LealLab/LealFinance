"""Durable facts the AI assistant remembers about a user across conversations."""

from sqlalchemy import Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel

AGENT_MEMORY_MAX_LENGTH = 500


class AgentMemory(UserOwnedModel):
    __tablename__ = "agent_memories"
    __error_prefix__ = "agent_memory"
    __table_args__ = (
        UniqueConstraint("user_id", "content", name="uq_agent_memories_user_id_content"),
        Index("ix_agent_memories_user_id_created_at", "user_id", "created_at"),
    )

    content: Mapped[str] = mapped_column(String(AGENT_MEMORY_MAX_LENGTH), nullable=False)
