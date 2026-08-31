"""Provider/tool loop and outward stream events for agent conversations."""

import json
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import chat, tools
from app.agents.credentials import ResolvedCredential
from app.agents.events import ProviderEvent, TextDelta, ToolCall, ToolResultInput, Turn, TurnEnd
from app.agents.prompt import OFF_TOPIC_CODE, OFF_TOPIC_MARKER
from app.core.errors import AppError, BadGatewayError
from app.models.agent_conversation import (
    AGENT_CONVERSATION_STATUS_AWAITING,
    AGENT_CONVERSATION_STATUS_IDLE,
    AgentConversation,
)
from app.models.agent_message import AgentMessage


@dataclass(frozen=True, slots=True)
class Delta:
    text: str


@dataclass(frozen=True, slots=True)
class ToolStarted:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ToolFinished:
    id: str
    name: str
    ok: bool


@dataclass(frozen=True, slots=True)
class ToolAwaitingConfirmation:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class Refusal:
    code: str


@dataclass(frozen=True, slots=True)
class StreamError:
    code: str
    params: dict[str, Any]


@dataclass(frozen=True, slots=True)
class Done:
    status: str
    message_id: str | None


StreamEvent = (
    Delta | ToolStarted | ToolFinished | ToolAwaitingConfirmation | Refusal | StreamError | Done
)


class _OffTopicGate:
    def __init__(self) -> None:
        self._buffer = ""
        self._flushed = False

    def feed(self, text: str) -> list[str]:
        if self._flushed:
            return [text] if text else []

        self._buffer += text
        if (
            len(self._buffer) < len(OFF_TOPIC_MARKER) and OFF_TOPIC_MARKER.startswith(self._buffer)
        ) or self._buffer == OFF_TOPIC_MARKER:
            return []

        self._flushed = True
        text = self._buffer
        self._buffer = ""
        return [text]

    def finish(self) -> tuple[bool, str]:
        if not self._flushed and self._buffer.strip() == OFF_TOPIC_MARKER:
            return True, ""
        return False, "" if self._flushed else self._buffer


MAX_ITERATIONS = 8
# ponytail: no per-user rate limit or daily message cap; add one if this
# stops being a single-family self-hosted app


async def _next_position(db: AsyncSession, conversation_id: UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(AgentMessage.position), -1) + 1).where(
            AgentMessage.conversation_id == conversation_id
        )
    )
    return result.scalar_one()


async def execute_tool(
    db: AsyncSession, user_id: UUID, spec: tools.ToolDef, arguments: dict[str, Any]
) -> tuple[str, bool]:
    try:
        return json.dumps(await spec.run(db, user_id, arguments)), False
    except AppError as err:
        return json.dumps({"error": err.code, "params": err.params}), True


async def persist_message(
    db: AsyncSession,
    conversation: AgentConversation,
    *,
    role: str,
    content: str = "",
    tool_calls: list[dict[str, Any]] | None = None,
    tool_call_id: str | None = None,
    tool_name: str | None = None,
    is_error: bool = False,
) -> AgentMessage:
    message = AgentMessage(
        user_id=conversation.user_id,
        conversation_id=conversation.id,
        role=role,
        content=content,
        tool_calls=tool_calls,
        tool_call_id=tool_call_id,
        tool_name=tool_name,
        is_error=is_error,
        position=await _next_position(db, conversation.id),
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message


async def run_turn(
    db: AsyncSession,
    conversation: AgentConversation,
    turns: list[Turn],
    credential: ResolvedCredential,
    system: str,
    *,
    streamer: Callable[..., AsyncIterator[ProviderEvent]] = chat.stream_turn,
    tool_defs: list[tools.ToolDef] | None = None,
) -> AsyncIterator[StreamEvent]:
    tool_defs = tool_defs if tool_defs is not None else tools.SPECS
    provider_tools = [definition.provider_spec() for definition in tool_defs]
    spec_by_name = {definition.name: definition for definition in tool_defs}
    user_id = conversation.user_id

    for _ in range(MAX_ITERATIONS):
        gate = _OffTopicGate()
        text_parts: list[str] = []
        calls: list[ToolCall] = []
        try:
            async for event in streamer(credential, system, turns, provider_tools):
                if isinstance(event, TextDelta):
                    text_parts.append(event.text)
                    for chunk in gate.feed(event.text):
                        yield Delta(chunk)
                elif isinstance(event, ToolCall):
                    calls.append(event)
                elif isinstance(event, TurnEnd):
                    pass  # Stop reason is intentionally unused for now.
        except BadGatewayError as exc:
            conversation.status = AGENT_CONVERSATION_STATUS_IDLE
            conversation.pending_call_id = None
            await db.commit()
            yield StreamError(exc.code, exc.params)
            return

        is_refusal, leftover = gate.finish()
        full_text = "".join(text_parts)
        if is_refusal:
            message = await persist_message(
                db, conversation, role="assistant", content=OFF_TOPIC_MARKER
            )
            yield Refusal(OFF_TOPIC_CODE)
            yield Done(status=AGENT_CONVERSATION_STATUS_IDLE, message_id=str(message.id))
            return

        if leftover:
            yield Delta(leftover)

        assistant_message = await persist_message(
            db,
            conversation,
            role="assistant",
            content=full_text,
            tool_calls=[
                {"id": call.id, "name": call.name, "arguments": call.arguments} for call in calls
            ]
            or None,
        )
        if not calls:
            conversation.status = AGENT_CONVERSATION_STATUS_IDLE
            conversation.pending_call_id = None
            await db.commit()
            yield Done(status=AGENT_CONVERSATION_STATUS_IDLE, message_id=str(assistant_message.id))
            return

        call = calls[0]
        spec = spec_by_name.get(call.name)
        if spec is None:
            content = json.dumps({"error": "agents.tool_unknown", "params": {"name": call.name}})
            await persist_message(
                db,
                conversation,
                role="tool",
                content=content,
                tool_call_id=call.id,
                tool_name=call.name,
                is_error=True,
            )
            yield ToolFinished(call.id, call.name, ok=False)
            turns.extend(
                [
                    Turn(role="assistant", text=full_text, tool_calls=tuple(calls)),
                    Turn(
                        role="user",
                        tool_results=(ToolResultInput(call.id, call.name, content, True),),
                    ),
                ]
            )
            continue

        if spec.writes:
            conversation.status = AGENT_CONVERSATION_STATUS_AWAITING
            conversation.pending_call_id = call.id
            await db.commit()
            yield ToolAwaitingConfirmation(call.id, call.name, call.arguments)
            yield Done(
                status=AGENT_CONVERSATION_STATUS_AWAITING,
                message_id=str(assistant_message.id),
            )
            return

        yield ToolStarted(call.id, call.name, call.arguments)
        content, is_error = await execute_tool(db, user_id, spec, call.arguments)
        await persist_message(
            db,
            conversation,
            role="tool",
            content=content,
            tool_call_id=call.id,
            tool_name=call.name,
            is_error=is_error,
        )
        yield ToolFinished(call.id, call.name, ok=not is_error)
        turns.extend(
            [
                Turn(role="assistant", text=full_text, tool_calls=tuple(calls)),
                Turn(
                    role="user",
                    tool_results=(ToolResultInput(call.id, call.name, content, is_error),),
                ),
            ]
        )

    conversation.status = AGENT_CONVERSATION_STATUS_IDLE
    conversation.pending_call_id = None
    await db.commit()
    yield StreamError(code="agents.tool_loop_exhausted", params={})


def rehydrate_turns(messages: Sequence[AgentMessage]) -> list[Turn]:
    ordered = sorted(messages, key=lambda message: message.position)
    turns: list[Turn] = []
    index = 0
    while index < len(ordered):
        message = ordered[index]
        if message.role == "user" and message.tool_call_id is None:
            turns.append(Turn(role="user", text=message.content))
        elif message.role == "tool":
            results: list[ToolResultInput] = []
            while index < len(ordered) and ordered[index].role == "tool":
                tool = ordered[index]
                assert tool.tool_call_id is not None
                assert tool.tool_name is not None
                results.append(
                    ToolResultInput(tool.tool_call_id, tool.tool_name, tool.content, tool.is_error)
                )
                index += 1
            turns.append(Turn(role="user", tool_results=tuple(results)))
            continue
        elif message.role == "assistant":
            calls = tuple(
                ToolCall(
                    str(call["id"]),
                    str(call["name"]),
                    cast(dict[str, Any], call["arguments"]),
                )
                for call in (message.tool_calls or [])
            )
            if not (message.content == OFF_TOPIC_MARKER and not calls):
                turns.append(Turn(role="assistant", text=message.content, tool_calls=calls))
        index += 1
    return turns
