"""Streaming provider adapters using raw httpx and normalized events."""

import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

import httpx

from app.agents.credentials import ResolvedCredential
from app.agents.events import ProviderEvent, TextDelta, ToolCall, ToolSpec, Turn, TurnEnd
from app.core.errors import BadGatewayError
from app.models.agent_credential import PROVIDER_ANTHROPIC, PROVIDER_OPENAI

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(60.0)

# The subscription (OAuth) endpoint only accepts requests whose system
# prompt opens with exactly this line - it's how the vendor distinguishes
# "the official CLI" traffic. Required only in oauth mode; api_key mode
# has no such restriction.
_ANTHROPIC_OAUTH_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude."


async def stream_turn(
    credential: ResolvedCredential,
    system: str,
    turns: list[Turn],
    tools: list[ToolSpec],
) -> AsyncIterator[ProviderEvent]:
    try:
        if credential.provider == PROVIDER_ANTHROPIC:
            async for event in _stream_anthropic(credential, system, turns, tools):
                yield event
        elif credential.provider == PROVIDER_OPENAI:
            async for event in _stream_openai_responses(credential, system, turns, tools):
                yield event
        else:
            async for event in _stream_openai_compatible(credential, system, turns, tools):
                yield event
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:500]
        logger.warning(
            "Chat call to provider %s failed: %s %s",
            credential.provider,
            exc.response.status_code,
            body,
        )
        raise BadGatewayError(code="agents.provider_unavailable") from exc
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        logger.warning("Chat call to provider %s failed", credential.provider, exc_info=True)
        raise BadGatewayError(code="agents.provider_unavailable") from exc


async def _raise_for_status(response: httpx.Response) -> None:
    if response.is_error:
        await response.aread()
    response.raise_for_status()


def _arguments(value: str) -> dict[str, Any]:
    parsed = json.loads(value or "{}")
    if not isinstance(parsed, dict):
        raise ValueError("tool arguments must be a JSON object")
    return parsed


def _anthropic_messages(turns: list[Turn]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for turn in turns:
        if turn.role == "assistant":
            content: list[dict[str, Any]] = []
            if turn.text:
                content.append({"type": "text", "text": turn.text})
            content.extend(
                {"type": "tool_use", "id": call.id, "name": call.name, "input": call.arguments}
                for call in turn.tool_calls
            )
            messages.append({"role": "assistant", "content": content})
        elif turn.tool_results:
            messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": result.call_id,
                            "content": result.content,
                            "is_error": result.is_error,
                        }
                        for result in turn.tool_results
                    ],
                }
            )
        else:
            messages.append({"role": "user", "content": turn.text})
    return messages


async def _stream_anthropic(
    credential: ResolvedCredential,
    system: str,
    turns: list[Turn],
    tools: list[ToolSpec],
) -> AsyncIterator[ProviderEvent]:
    headers = {"anthropic-version": "2023-06-01", "content-type": "application/json"}
    body: dict[str, Any] = {
        "model": credential.model,
        "max_tokens": 16000,
        "stream": True,
        "system": (
            [
                {"type": "text", "text": _ANTHROPIC_OAUTH_SYSTEM_PREFIX},
                {"type": "text", "text": system},
            ]
            if credential.auth_mode == "oauth"
            else system
        ),
        "thinking": {"type": "adaptive"},
        "messages": _anthropic_messages(turns),
    }
    if credential.reasoning_effort:
        body["output_config"] = {"effort": credential.reasoning_effort}
    if tools:
        body["tools"] = [
            {"name": spec.name, "description": spec.description, "input_schema": spec.schema}
            for spec in tools
        ]
        body["tool_choice"] = {"type": "auto", "disable_parallel_tool_use": True}

    if credential.auth_mode == "oauth":
        headers["authorization"] = f"Bearer {credential.secret}"
        headers["anthropic-beta"] = "oauth-2025-04-20"
    else:
        headers["x-api-key"] = credential.secret or ""

    tool_blocks: dict[int, tuple[str, str, list[str]]] = {}
    stop_reason: object = None
    event_type = ""
    async with (
        httpx.AsyncClient(timeout=_TIMEOUT) as client,
        client.stream(
            "POST", "https://api.anthropic.com/v1/messages", headers=headers, json=body
        ) as response,
    ):
        await _raise_for_status(response)
        async for line in response.aiter_lines():
            if line.startswith("event:"):
                event_type = line.removeprefix("event:").strip()
                continue
            if not line.startswith("data:"):
                continue
            data = line.removeprefix("data:").strip()
            if not data:
                continue
            event = json.loads(data)
            if not isinstance(event, dict):
                raise ValueError("provider event must be an object")
            kind = event.get("type", event_type)
            if kind == "content_block_start":
                block = event["content_block"]
                if not isinstance(block, dict):
                    raise ValueError("content block must be an object")
                if block.get("type") == "tool_use":
                    tool_blocks[event["index"]] = (block["id"], block["name"], [])
            elif kind == "content_block_delta":
                delta = event["delta"]
                if not isinstance(delta, dict):
                    raise ValueError("content delta must be an object")
                if delta.get("type") == "text_delta":
                    yield TextDelta(delta["text"])
                elif delta.get("type") == "input_json_delta":
                    block = tool_blocks.get(event["index"])
                    if block is not None:
                        partial_json = delta["partial_json"]
                        if not isinstance(partial_json, str):
                            raise ValueError("tool arguments fragment must be text")
                        block[2].append(partial_json)
            elif kind == "content_block_stop":
                block = tool_blocks.pop(event["index"], None)
                if block is not None:
                    yield ToolCall(block[0], block[1], _arguments("".join(block[2])))
            elif kind == "message_delta":
                stop_reason = event["delta"]["stop_reason"]
            elif kind == "message_stop":
                mapped: Literal["end_turn", "tool_use", "max_tokens", "other"]
                if stop_reason == "end_turn":
                    mapped = "end_turn"
                elif stop_reason == "tool_use":
                    mapped = "tool_use"
                elif stop_reason == "max_tokens":
                    mapped = "max_tokens"
                else:
                    mapped = "other"
                yield TurnEnd(mapped)
            elif kind == "error":
                raise ValueError(event)


def _codex_input(turns: list[Turn]) -> list[dict[str, Any]]:
    inputs: list[dict[str, Any]] = []
    for turn in turns:
        if turn.role == "assistant":
            if turn.text:
                inputs.append(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": turn.text}],
                    }
                )
            inputs.extend(
                {
                    "type": "function_call",
                    "call_id": call.id,
                    "name": call.name,
                    "arguments": json.dumps(call.arguments),
                }
                for call in turn.tool_calls
            )
        elif turn.tool_results:
            inputs.extend(
                {
                    "type": "function_call_output",
                    "call_id": result.call_id,
                    "output": result.content,
                }
                for result in turn.tool_results
            )
        else:
            inputs.append(
                {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": turn.text}],
                }
            )
    return inputs


async def _stream_openai_responses(
    credential: ResolvedCredential,
    system: str,
    turns: list[Turn],
    tools: list[ToolSpec],
) -> AsyncIterator[ProviderEvent]:
    if credential.auth_mode != "oauth":
        async for event in _stream_openai_compatible(credential, system, turns, tools):
            yield event
        return

    headers = {
        "authorization": f"Bearer {credential.secret}",
        "content-type": "application/json",
        "accept": "text/event-stream",
        "openai-beta": "responses=experimental",
        "originator": "codex_cli_rs",
        "session_id": str(uuid.uuid4()),
    }
    if credential.account_id:
        headers["chatgpt-account-id"] = credential.account_id
    body: dict[str, Any] = {
        "model": credential.model,
        "instructions": system,
        "input": _codex_input(turns),
        "stream": True,
        "store": False,
        "parallel_tool_calls": False,
        "tools": [
            {
                "type": "function",
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.schema,
                "strict": False,
            }
            for spec in tools
        ],
        "tool_choice": "auto",
    }
    if credential.reasoning_effort:
        body["reasoning"] = {"effort": credential.reasoning_effort, "summary": "auto"}

    emitted_tool_call = False
    async with (
        httpx.AsyncClient(timeout=_TIMEOUT) as client,
        client.stream(
            "POST", "https://chatgpt.com/backend-api/codex/responses", headers=headers, json=body
        ) as response,
    ):
        await _raise_for_status(response)
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line.removeprefix("data:").strip()
            if not data or data == "[DONE]":
                continue
            event = json.loads(data)
            if not isinstance(event, dict):
                raise ValueError("provider event must be an object")
            kind = event.get("type")
            if kind == "response.output_text.delta":
                yield TextDelta(event["delta"])
            elif kind == "response.output_item.done":
                item = event["item"]
                if not isinstance(item, dict):
                    raise ValueError("output item must be an object")
                if item.get("type") == "function_call":
                    emitted_tool_call = True
                    yield ToolCall(
                        item["call_id"], item["name"], _arguments(item["arguments"] or "{}")
                    )
            elif kind == "response.completed":
                yield TurnEnd("tool_use" if emitted_tool_call else "end_turn")
                return
            elif kind in ("response.failed", "error"):
                raise ValueError(event)


def _compatible_messages(turns: list[Turn], system: str) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for turn in turns:
        if turn.role == "assistant":
            message: dict[str, Any] = {"role": "assistant", "content": turn.text or None}
            if turn.tool_calls:
                message["tool_calls"] = [
                    {
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
                    }
                    for call in turn.tool_calls
                ]
            messages.append(message)
        elif turn.tool_results:
            messages.extend(
                {"role": "tool", "tool_call_id": result.call_id, "content": result.content}
                for result in turn.tool_results
            )
        else:
            messages.append({"role": "user", "content": turn.text})
    return messages


async def _stream_openai_compatible(
    credential: ResolvedCredential,
    system: str,
    turns: list[Turn],
    tools: list[ToolSpec],
) -> AsyncIterator[ProviderEvent]:
    if credential.base_url:
        url = f"{credential.base_url.rstrip('/')}/v1/chat/completions"
        headers = {}
    else:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"authorization": f"Bearer {credential.secret}"}

    body: dict[str, Any] = {
        "model": credential.model,
        "stream": True,
        "messages": _compatible_messages(turns, system),
        "parallel_tool_calls": False,
    }
    if credential.reasoning_effort:
        body["reasoning_effort"] = credential.reasoning_effort
    if tools:
        body["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": spec.name,
                    "description": spec.description,
                    "parameters": spec.schema,
                },
            }
            for spec in tools
        ]
        body["tool_choice"] = "auto"

    tool_calls: dict[int, dict[str, str]] = {}
    async with (
        httpx.AsyncClient(timeout=_TIMEOUT) as client,
        client.stream("POST", url, headers=headers, json=body) as response,
    ):
        await _raise_for_status(response)
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line.removeprefix("data:").strip()
            if not data:
                continue
            if data == "[DONE]":
                return
            chunk = json.loads(data)
            if not isinstance(chunk, dict):
                raise ValueError("provider chunk must be an object")
            choice = chunk["choices"][0]
            delta = choice["delta"]
            if delta.get("content"):
                yield TextDelta(delta["content"])
            if delta.get("tool_calls"):
                for tool_call in delta["tool_calls"]:
                    index = tool_call["index"]
                    buffered = tool_calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
                    if tool_call.get("id"):
                        buffered["id"] = tool_call["id"]
                    function = tool_call.get("function", {})
                    if function.get("name"):
                        buffered["name"] = function["name"]
                    arguments = function.get("arguments", "")
                    if not isinstance(arguments, str):
                        raise ValueError("tool arguments fragment must be text")
                    buffered["arguments"] += arguments
            if choice.get("finish_reason") is not None:
                for buffered in tool_calls.values():
                    yield ToolCall(
                        buffered["id"], buffered["name"], _arguments(buffered["arguments"])
                    )
                finish_reason = choice["finish_reason"]
                if tool_calls:
                    yield TurnEnd("tool_use")
                elif finish_reason == "length":
                    yield TurnEnd("max_tokens")
                else:
                    yield TurnEnd("end_turn")
