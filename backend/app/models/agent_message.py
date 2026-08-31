"""Persisted messages belonging to an AI chat conversation."""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel

AGENT_MESSAGE_ROLE_USER = "user"
AGENT_MESSAGE_ROLE_ASSISTANT = "assistant"
AGENT_MESSAGE_ROLE_TOOL = "tool"
AGENT_MESSAGE_ROLES = (
    AGENT_MESSAGE_ROLE_USER,
    AGENT_MESSAGE_ROLE_ASSISTANT,
    AGENT_MESSAGE_ROLE_TOOL,
)


class AgentMessage(UserOwnedModel):
    __tablename__ = "agent_messages"
    __error_prefix__ = "agent_message"
    __table_args__ = (
        CheckConstraint(
            "role IN ('user', 'assistant', 'tool')",
            name="ck_agent_messages_role",
        ),
        UniqueConstraint(
            "conversation_id", "position", name="uq_agent_messages_conversation_position"
        ),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "agent_conversations.id",
            ondelete="CASCADE",
            name="fk_agent_messages_conversation_id",
        ),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    tool_calls: Mapped[list[dict[str, object]] | None] = mapped_column(JSONB)
    tool_call_id: Mapped[str | None] = mapped_column(String(64))
    tool_name: Mapped[str | None] = mapped_column(String(64))
    is_error: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
