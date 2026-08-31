"""Conversation CRUD and streaming orchestration for AI chat."""

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from datetime import date
from typing import Any, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import credentials, loop, prompt, tools
from app.agents.credentials import ResolvedCredential
from app.agents.providers import PROVIDERS
from app.core.db import session_scope
from app.core.errors import ValidationAppError
from app.models.agent_conversation import (
    AGENT_CONVERSATION_STATUS_AWAITING,
    AGENT_CONVERSATION_STATUS_IDLE,
    AgentConversation,
)
from app.models.agent_message import AgentMessage
from app.models.user import User
from app.schemas.agent import ConversationCreate
from app.services.agent_providers import _require_known_provider
from app.services.ownership import get_owned, list_owned


async def list_conversations(db: AsyncSession, user_id: UUID) -> list[AgentConversation]:
    conversations = await list_owned(db, AgentConversation, user_id)
    return sorted(conversations, key=lambda conversation: conversation.created_at, reverse=True)


async def get_conversation(
    db: AsyncSession, user_id: UUID, conversation_id: UUID
) -> AgentConversation:
    return await get_owned(db, AgentConversation, conversation_id, user_id)


async def _messages(db: AsyncSession, conversation_id: UUID) -> list[AgentMessage]:
    result = await db.execute(
        select(AgentMessage)
        .where(AgentMessage.conversation_id == conversation_id)
        .order_by(AgentMessage.position)
    )
    return list(result.scalars().all())


async def get_conversation_detail(
    db: AsyncSession, user_id: UUID, conversation_id: UUID
) -> tuple[AgentConversation, list[AgentMessage]]:
    conversation = await get_conversation(db, user_id, conversation_id)
    return conversation, await _messages(db, conversation.id)


async def delete_conversation(db: AsyncSession, user_id: UUID, conversation_id: UUID) -> None:
    conversation = await get_conversation(db, user_id, conversation_id)
    await db.delete(conversation)
    await db.commit()


async def _resolve_provider(
    db: AsyncSession, user_id: UUID, requested: str | None
) -> ResolvedCredential:
    if requested:
        _require_known_provider(requested)
        resolved = await credentials.resolve(db, user_id, requested)
        if resolved is not None:
            return resolved
    else:
        for provider in PROVIDERS:
            resolved = await credentials.resolve(db, user_id, provider)
            if resolved is not None:
                return resolved

    raise ValidationAppError(code="agents.not_configured")


async def create_conversation(
    db: AsyncSession, user_id: UUID, data: ConversationCreate
) -> AgentConversation:
    resolved = await _resolve_provider(db, user_id, data.provider)
    conversation = AgentConversation(
        user_id=user_id,
        provider=resolved.provider,
        model=resolved.model,
        status=AGENT_CONVERSATION_STATUS_IDLE,
        title=None,
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return conversation


def _sse_frame(event_name: str, payload: dict[str, Any]) -> bytes:
    return f"event: {event_name}\ndata: {json.dumps(payload)}\n\n".encode()


def _serialize(event: loop.StreamEvent) -> bytes:
    if isinstance(event, loop.Delta):
        return _sse_frame("delta", {"text": event.text})
    if isinstance(event, loop.ToolStarted):
        return _sse_frame(
            "tool_call", {"id": event.id, "name": event.name, "arguments": event.arguments}
        )
    if isinstance(event, loop.ToolFinished):
        return _sse_frame("tool_result", {"id": event.id, "name": event.name, "ok": event.ok})
    if isinstance(event, loop.ToolAwaitingConfirmation):
        return _sse_frame(
            "tool_confirm",
            {"id": event.id, "name": event.name, "arguments": event.arguments},
        )
    if isinstance(event, loop.Refusal):
        return _sse_frame("refusal", {"code": event.code})
    if isinstance(event, loop.StreamError):
        return _sse_frame("error", {"code": event.code, "params": event.params})
    if isinstance(event, loop.Done):
        return _sse_frame("done", {"status": event.status, "message_id": event.message_id})
    raise TypeError(f"unsupported stream event: {type(event)!r}")


async def _heartbeat(events: AsyncIterator[bytes], interval: float = 15.0) -> AsyncIterator[bytes]:
    """Interleave SSE comment frames so an idle stretch (a slow provider turn or
    a long tool call) never trips a reverse proxy's read timeout. The producer
    runs in its own task and is never cancelled mid-event - only the queue wait
    times out - so a heartbeat can't interrupt a half-written message or tool."""
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()

    async def _drain() -> None:
        try:
            async for chunk in events:
                await queue.put(chunk)
        finally:
            await queue.put(None)

    producer = asyncio.create_task(_drain())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), interval)
            except TimeoutError:
                yield b": heartbeat\n\n"
                continue
            if item is None:
                return
            yield item
    finally:
        producer.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await producer


async def stream_message(
    user_id: UUID, conversation_id: UUID, content: str
) -> AsyncIterator[bytes]:
    async with session_scope() as db:
        conversation = await get_conversation(db, user_id, conversation_id)
        if conversation.status == AGENT_CONVERSATION_STATUS_AWAITING:
            yield _sse_frame("error", {"code": "agents.awaiting_confirmation", "params": {}})
            return

        user = await db.get(User, user_id)
        assert user is not None
        await loop.persist_message(db, conversation, role="user", content=content)
        if conversation.title is None:
            conversation.title = content[:200]
            await db.commit()

        messages = await _messages(db, conversation.id)
        turns = loop.rehydrate_turns(messages)
        credential = await credentials.resolve(db, user_id, conversation.provider)
        if credential is None:
            yield _sse_frame("error", {"code": "agents.not_configured", "params": {}})
            return

        system = prompt.build(user, date.today())
        async for event in loop.run_turn(db, conversation, turns, credential, system):
            yield _serialize(event)


async def stream_confirm(
    user_id: UUID,
    conversation_id: UUID,
    tool_call_id: str,
    approved: bool,
    arguments: dict[str, Any] | None,
) -> AsyncIterator[bytes]:
    async with session_scope() as db:
        conversation = await get_conversation(db, user_id, conversation_id)
        if (
            conversation.status != AGENT_CONVERSATION_STATUS_AWAITING
            or conversation.pending_call_id != tool_call_id
        ):
            yield _sse_frame("error", {"code": "agents.no_pending_tool", "params": {}})
            return

        messages = await _messages(db, conversation.id)
        pending: dict[str, object] | None = None
        for message in reversed(messages):
            if message.role != "assistant" or not message.tool_calls:
                continue
            pending = next(
                (call for call in message.tool_calls if str(call.get("id")) == tool_call_id),
                None,
            )
            if pending is not None:
                break
        if pending is None:
            yield _sse_frame("error", {"code": "agents.no_pending_tool", "params": {}})
            return

        name = str(pending["name"])
        pending_arguments = pending.get("arguments", {})
        call_args = (
            arguments
            if arguments is not None
            else (
                cast(dict[str, Any], pending_arguments)
                if isinstance(pending_arguments, dict)
                else {}
            )
        )
        user = await db.get(User, user_id)
        assert user is not None

        if approved:
            spec = tools.SPEC_BY_NAME.get(name)
            if spec is None:
                content = json.dumps({"error": "agents.tool_unknown", "params": {"name": name}})
                is_error = True
            else:
                content, is_error = await loop.execute_tool(db, user_id, spec, call_args)
            await loop.persist_message(
                db,
                conversation,
                role="tool",
                content=content,
                tool_call_id=tool_call_id,
                tool_name=name,
                is_error=is_error,
            )
            yield _serialize(loop.ToolFinished(tool_call_id, name, ok=not is_error))
        else:
            content = json.dumps({"status": "rejected_by_user"})
            await loop.persist_message(
                db,
                conversation,
                role="tool",
                content=content,
                tool_call_id=tool_call_id,
                tool_name=name,
                is_error=False,
            )
            yield _serialize(loop.ToolFinished(tool_call_id, name, ok=True))

        conversation.status = AGENT_CONVERSATION_STATUS_IDLE
        conversation.pending_call_id = None
        await db.commit()
        credential = await credentials.resolve(db, user_id, conversation.provider)
        if credential is None:
            yield _sse_frame("error", {"code": "agents.not_configured", "params": {}})
            return

        turns = loop.rehydrate_turns(await _messages(db, conversation.id))
        system = prompt.build(user, date.today())
        async for event in loop.run_turn(db, conversation, turns, credential, system):
            yield _serialize(event)
