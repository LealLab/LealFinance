"""AI provider linking and a smoke-test chat call. Every handler is gated
by `_require_agents_enabled` and admin auth, so the whole surface 404s as
`agents.disabled` when `AGENTS_ENABLED=false` - the flag this router is
entirely behind (see CLAUDE.md's AI Agents section)."""

from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Body, Depends, status
from fastapi.responses import Response, StreamingResponse

from app.api.deps import AdminUser, AiChatUser, DbSession
from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError
from app.models.agent_conversation import AGENT_CONVERSATION_STATUS_AWAITING, AgentConversation
from app.models.agent_memory import AgentMemory
from app.models.mcp_token import McpToken
from app.schemas.agent import (
    AgentMessageRead,
    ConfirmCreate,
    ConversationCreate,
    ConversationDetailRead,
    ConversationRead,
    ImportSuggestRead,
    ImportSuggestRequest,
    InstructionsRead,
    InstructionsUpdate,
    McpTokenCreate,
    McpTokenRead,
    McpTokenSummary,
    MemoryRead,
    MessageCreate,
    OAuthCompleteCreate,
    OAuthStartRead,
    ProviderLinkUpdate,
    ProviderStatusRead,
    ProviderTestRead,
)
from app.services import (
    agent_chat,
    agent_instructions,
    agent_memories,
    agent_providers,
    import_suggest,
    mcp_tokens,
)


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


# `/mcp-token` is the original path and still works (bodyless = a read-only token).
@router.post("/mcp-token", response_model=McpTokenRead)
@router.post("/mcp-tokens", response_model=McpTokenRead, status_code=status.HTTP_201_CREATED)
async def create_mcp_token(
    admin: AdminUser,
    db: DbSession,
    payload: Annotated[McpTokenCreate | None, Body()] = None,
) -> McpTokenRead:
    body = payload or McpTokenCreate()
    row, raw = await mcp_tokens.create(db, user=admin, scope=body.scope, name=body.name)
    return McpTokenRead(**McpTokenSummary.model_validate(row).model_dump(), token=raw)


@router.get("/mcp-tokens", response_model=list[McpTokenSummary])
async def list_mcp_tokens(admin: AdminUser, db: DbSession) -> list[McpToken]:
    return await mcp_tokens.list_active(db, admin.id)


@router.delete("/mcp-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_mcp_token(token_id: UUID, admin: AdminUser, db: DbSession) -> None:
    await mcp_tokens.revoke(db, user_id=admin.id, token_id=token_id)


@router.post("/import/suggest", response_model=ImportSuggestRead)
async def suggest_import_categories(
    payload: ImportSuggestRequest, user: AiChatUser, db: DbSession
) -> ImportSuggestRead:
    suggestions = await import_suggest.suggest(db, user.id, payload.items, user.locale)
    return ImportSuggestRead(suggestions=suggestions)


@router.get("/instructions", response_model=InstructionsRead)
async def get_instructions(user: AiChatUser) -> InstructionsRead:
    return InstructionsRead(instructions=agent_instructions.get(user))


@router.put("/instructions", response_model=InstructionsRead)
async def update_instructions(
    payload: InstructionsUpdate, user: AiChatUser, db: DbSession
) -> InstructionsRead:
    stored = await agent_instructions.save(db, user, payload.instructions)
    return InstructionsRead(instructions=stored)


@router.get("/memories", response_model=list[MemoryRead])
async def list_memories(user: AiChatUser, db: DbSession) -> list[AgentMemory]:
    return await agent_memories.list_memories(db, user.id)


@router.delete("/memories/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(memory_id: UUID, user: AiChatUser, db: DbSession) -> None:
    await agent_memories.delete_memory(db, user.id, memory_id)


@router.get("/conversations", response_model=list[ConversationRead])
async def list_conversations(user: AiChatUser, db: DbSession) -> list[AgentConversation]:
    return await agent_chat.list_conversations(db, user.id)


@router.post("/conversations", response_model=ConversationRead, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    payload: ConversationCreate, user: AiChatUser, db: DbSession
) -> AgentConversation:
    return await agent_chat.create_conversation(db, user.id, payload)


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailRead)
async def get_conversation(
    conversation_id: UUID, user: AiChatUser, db: DbSession
) -> ConversationDetailRead:
    conversation, messages = await agent_chat.get_conversation_detail(db, user.id, conversation_id)
    return ConversationDetailRead(
        **ConversationRead.model_validate(conversation).model_dump(),
        messages=[AgentMessageRead.model_validate(message) for message in messages],
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: UUID, user: AiChatUser, db: DbSession) -> None:
    await agent_chat.delete_conversation(db, user.id, conversation_id)


@router.get("/conversations/{conversation_id}/attachments/{attachment_id}")
async def get_attachment(
    conversation_id: UUID, attachment_id: UUID, user: AiChatUser, db: DbSession
) -> Response:
    attachment = await agent_chat.get_attachment(db, user.id, conversation_id, attachment_id)
    return Response(
        content=attachment.data,
        media_type=attachment.media_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(attachment.name)}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/conversations/{conversation_id}/messages")
async def post_message(
    conversation_id: UUID, payload: MessageCreate, user: AiChatUser, db: DbSession
) -> StreamingResponse:
    await agent_chat.prepare_message(db, user.id, conversation_id, payload)
    # The generator opens its own session because FastAPI may close this one first.
    return StreamingResponse(
        agent_chat._heartbeat(
            agent_chat.stream_message(user.id, conversation_id, payload.client_date)
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/conversations/{conversation_id}/confirm")
async def post_confirm(
    conversation_id: UUID, payload: ConfirmCreate, user: AiChatUser, db: DbSession
) -> StreamingResponse:
    conversation = await agent_chat.get_conversation(db, user.id, conversation_id)
    if (
        conversation.status != AGENT_CONVERSATION_STATUS_AWAITING
        or conversation.pending_call_id != payload.tool_call_id
    ):
        raise ConflictError(code="agents.no_pending_tool")
    # The request session is only for the pre-stream ownership/conflict check.
    # The generator opens its own session because FastAPI may close this one first.
    return StreamingResponse(
        agent_chat._heartbeat(
            agent_chat.stream_confirm(
                user.id,
                conversation_id,
                payload.tool_call_id,
                payload.approved,
                payload.arguments,
                payload.client_date,
            )
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
