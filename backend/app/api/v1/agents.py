"""AI provider linking and a smoke-test chat call. Every handler is gated
by `_require_agents_enabled` in addition to normal auth, so the whole
surface 404s as `agents.disabled` when `AGENTS_ENABLED=false` - the flag
this router is entirely behind (see CLAUDE.md's AI Agents section)."""

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.schemas.agent import (
    ChatCreate,
    ChatRead,
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
async def list_providers(user: CurrentUser, db: DbSession) -> list[ProviderStatusRead]:
    return await agent_providers.list_provider_status(db, user.id)


@router.put("/providers/{provider}", response_model=ProviderStatusRead)
async def link_provider(
    provider: str, payload: ProviderLinkUpdate, user: CurrentUser, db: DbSession
) -> ProviderStatusRead:
    return await agent_providers.link_api_key(db, user.id, provider, payload)


@router.delete("/providers/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_provider(provider: str, user: CurrentUser, db: DbSession) -> None:
    await agent_providers.unlink(db, user.id, provider)


@router.post("/providers/{provider}/oauth/start", response_model=OAuthStartRead)
async def start_provider_oauth(provider: str, _user: CurrentUser) -> OAuthStartRead:
    return agent_providers.start_oauth(provider)


@router.post("/providers/{provider}/oauth/complete", response_model=ProviderStatusRead)
async def complete_provider_oauth(
    provider: str, payload: OAuthCompleteCreate, user: CurrentUser, db: DbSession
) -> ProviderStatusRead:
    return await agent_providers.complete_oauth(db, user.id, provider, payload)


@router.post("/providers/{provider}/test", response_model=ProviderTestRead)
async def test_provider(provider: str, user: CurrentUser, db: DbSession) -> ProviderTestRead:
    return await agent_providers.test_provider(db, user.id, provider)


@router.post("/chat", response_model=ChatRead)
async def chat(payload: ChatCreate, user: CurrentUser, db: DbSession) -> ChatRead:
    return await agent_providers.send_chat(db, user.id, payload)
