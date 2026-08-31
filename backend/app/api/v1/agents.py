"""AI provider linking and a smoke-test chat call. Every handler is gated
by `_require_agents_enabled` and admin auth, so the whole surface 404s as
`agents.disabled` when `AGENTS_ENABLED=false` - the flag this router is
entirely behind (see CLAUDE.md's AI Agents section)."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, status

from app.agents import MCP_TOKEN_TTL_SECONDS
from app.api.deps import AdminUser, AiChatUser, DbSession
from app.core import crypto
from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.schemas.agent import (
    McpTokenRead,
    OAuthCompleteCreate,
    OAuthStartRead,
    ProviderLinkUpdate,
    ProviderStatusRead,
    ProviderTestRead,
)
from app.services import agent_providers


def _require_agents_enabled() -> None:
    if not get_settings().agents_enabled:
        raise NotFoundError(code="agents.disabled")


router = APIRouter(
    prefix="/agents", tags=["agents"], dependencies=[Depends(_require_agents_enabled)]
)


@router.get("/providers", response_model=list[ProviderStatusRead])
async def list_providers(admin: AdminUser, db: DbSession) -> list[ProviderStatusRead]:
    return await agent_providers.list_provider_status(db, admin.id)


@router.put("/providers/{provider}", response_model=ProviderStatusRead)
async def link_provider(
    provider: str, payload: ProviderLinkUpdate, admin: AdminUser, db: DbSession
) -> ProviderStatusRead:
    return await agent_providers.link_api_key(db, admin.id, provider, payload)


@router.delete("/providers/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_provider(provider: str, admin: AdminUser, db: DbSession) -> None:
    await agent_providers.unlink(db, admin.id, provider)


@router.post("/providers/{provider}/oauth/start", response_model=OAuthStartRead)
async def start_provider_oauth(provider: str, _admin: AdminUser) -> OAuthStartRead:
    return agent_providers.start_oauth(provider)


@router.post("/providers/{provider}/oauth/complete", response_model=ProviderStatusRead)
async def complete_provider_oauth(
    provider: str, payload: OAuthCompleteCreate, admin: AdminUser, db: DbSession
) -> ProviderStatusRead:
    return await agent_providers.complete_oauth(db, admin.id, provider, payload)


@router.post("/providers/{provider}/test", response_model=ProviderTestRead)
async def test_provider(provider: str, admin: AdminUser, db: DbSession) -> ProviderTestRead:
    return await agent_providers.test_provider(db, admin.id, provider)


@router.post("/mcp-token", response_model=McpTokenRead)
async def create_mcp_token(user: AiChatUser) -> McpTokenRead:
    token = crypto.mint_mcp_token(user.id)
    expires_at = datetime.now(UTC) + timedelta(seconds=MCP_TOKEN_TTL_SECONDS)
    return McpTokenRead(token=token, expires_at=expires_at)
