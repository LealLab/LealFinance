"""Per-user AI chat conversation state."""

from sqlalchemy import CheckConstraint, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel

AGENT_CONVERSATION_STATUS_IDLE = "idle"
AGENT_CONVERSATION_STATUS_AWAITING = "awaiting_confirmation"
AGENT_CONVERSATION_STATUSES = (
    AGENT_CONVERSATION_STATUS_IDLE,
    AGENT_CONVERSATION_STATUS_AWAITING,
)


class AgentConversation(UserOwnedModel):
    __tablename__ = "agent_conversations"
    __error_prefix__ = "agent_conversation"
    __table_args__ = (
        CheckConstraint(
            "status IN ('idle', 'awaiting_confirmation')",
            name="ck_agent_conversations_status",
        ),
        CheckConstraint(
            "(status = 'awaiting_confirmation') = (pending_call_id IS NOT NULL)",
            name="ck_agent_conversations_pending_shape",
        ),
        Index("ix_agent_conversations_user_id_created_at", "user_id", "created_at"),
    )

    title: Mapped[str | None] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="idle", server_default="idle"
    )
    pending_call_id: Mapped[str | None] = mapped_column(String(64))
