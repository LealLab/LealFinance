"""Revocable bearer tokens for the standalone MCP server (app/mcp/server.py).

Like Session and TrustedDevice, the raw token is shown to the admin once and
only its HMAC hash (app/core/security.py) is stored, so a database dump alone
yields nothing replayable.

This is credential metadata, so it is deliberately a plain Base model rather
than a UserOwnedModel: that keeps it out of the AI change journal (nothing to
undo, and the journal would copy token hashes into `before`/`after`) and out of
backup export/restore (a restored token would outlive the revocation that
killed it, and archives must not carry credentials).
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

MCP_SCOPE_READ = "read"
MCP_SCOPE_WRITE = "write"
MCP_SCOPES = (MCP_SCOPE_READ, MCP_SCOPE_WRITE)
MCP_TOKEN_NAME_MAX_LENGTH = 100


class McpToken(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "mcp_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_mcp_tokens_token_hash"),
        CheckConstraint("scope IN ('read', 'write')", name="ck_mcp_tokens_scope"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_mcp_tokens_user_id"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    scope: Mapped[str] = mapped_column(String(5), nullable=False)
    name: Mapped[str | None] = mapped_column(String(MCP_TOKEN_NAME_MAX_LENGTH))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
