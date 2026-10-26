"""Issue, list, authenticate and revoke MCP bearer tokens (app/models/mcp_token.py)."""

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import MCP_TOKEN_TTL_SECONDS
from app.core.errors import NotFoundError
from app.core.logging import security_event
from app.core.security import generate_token, hash_token
from app.models.mcp_token import McpToken
from app.models.user import ROLE_ADMIN, User

# last_used_at is a hint for admins, not an audit trail, so a busy client does
# not get a database write per call.
LAST_USED_RESOLUTION = timedelta(minutes=5)


async def create(
    db: AsyncSession, *, user: User, scope: str, name: str | None
) -> tuple[McpToken, str]:
    """Returns the stored row and the raw token, which exists only here."""
    raw = generate_token()
    row = McpToken(
        user_id=user.id,
        token_hash=hash_token(raw),
        scope=scope,
        name=name,
        expires_at=datetime.now(UTC) + timedelta(seconds=MCP_TOKEN_TTL_SECONDS),
    )
    db.add(row)
    await db.commit()
    security_event("mcp_token_issued", level=logging.INFO, user_id=user.id, scope=scope)
    return row, raw


async def list_active(db: AsyncSession, user_id: UUID) -> list[McpToken]:
    result = await db.execute(
        select(McpToken)
        .where(
            McpToken.user_id == user_id,
            McpToken.revoked_at.is_(None),
            McpToken.expires_at > datetime.now(UTC),
        )
        .order_by(McpToken.created_at.desc())
    )
    return list(result.scalars().all())


async def revoke(db: AsyncSession, *, user_id: UUID, token_id: UUID) -> None:
    row = await db.get(McpToken, token_id)
    if row is None or row.user_id != user_id or row.revoked_at is not None:
        raise NotFoundError(code="mcp_token.not_found")
    row.revoked_at = datetime.now(UTC)
    await db.commit()
    security_event("mcp_token_revoked", level=logging.INFO, user_id=user_id, scope=row.scope)


async def revoke_all(db: AsyncSession, *, user_id: UUID) -> None:
    """Does not commit: callers (password change, deactivation, demotion) revoke
    inside their own transaction, next to their session revocation."""
    await db.execute(
        update(McpToken)
        .where(McpToken.user_id == user_id, McpToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


async def authenticate(db: AsyncSession, raw: str) -> McpToken | None:
    """The token row if `raw` is a live token of an active administrator, else
    None. A rejection is logged without the token itself."""
    row = (
        await db.execute(select(McpToken).where(McpToken.token_hash == hash_token(raw)))
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    user = await db.get(User, row.user_id) if row is not None else None
    if (
        row is None
        or row.revoked_at is not None
        or row.expires_at <= now
        or user is None
        or not user.is_active
        or user.role != ROLE_ADMIN
    ):
        security_event(
            "mcp_token_rejected",
            user_id=row.user_id if row is not None else None,
            reason="unknown" if row is None else "revoked_expired_or_not_admin",
        )
        return None
    # Conditional UPDATE: concurrent calls race to one write per window.
    await db.execute(
        update(McpToken)
        .where(
            McpToken.id == row.id,
            or_(
                McpToken.last_used_at.is_(None), McpToken.last_used_at < now - LAST_USED_RESOLUTION
            ),
        )
        .values(last_used_at=now)
    )
    await db.commit()
    return row
