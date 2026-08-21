"""One non-streaming chat call per provider - just enough to prove a
configured provider actually answers. Real agent tool use, streaming, and
conversation persistence are a follow-up; see docs/ai-agents.md.

No LLM SDKs: each provider is one JSON POST over httpx.AsyncClient, a
fresh client per call (matching app/services/exchange_rates.py - chat
volume here is a single "try it" request, not a hot path). A provider
outage or bad response never propagates as our own 500 - it's normalized
to `agents.provider_unavailable`, matching the codebase's rule that a
third-party integration failing is never why the request as a whole
fails.
"""

import json
import logging
import uuid

import httpx

from app.agents.credentials import ResolvedCredential
from app.core.errors import BadGatewayError
from app.models.agent_credential import PROVIDER_ANTHROPIC, PROVIDER_OPENAI

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(60.0)

# The subscription (OAuth) endpoint only accepts requests whose system
# prompt opens with exactly this line - it's how the vendor distinguishes
# "the official CLI" traffic. Required only in oauth mode; api_key mode
# has no such restriction.
_ANTHROPIC_OAUTH_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude."

# Anthropic requires max_tokens to exceed the thinking budget; this is the
# room left for the actual answer on top of it.
_ANTHROPIC_ANSWER_HEADROOM = 4096
_ANTHROPIC_THINKING_BUDGETS = {"low": 1024, "medium": 4096, "high": 8192, "xhigh": 16384}

ChatMessage = dict[str, str]  # {"role": "user" | "assistant", "content": "..."}


async def send_chat(credential: ResolvedCredential, messages: list[ChatMessage]) -> str:
    try:
        if credential.provider == PROVIDER_ANTHROPIC:
            return await _send_anthropic(credential, messages)
        if credential.provider == PROVIDER_OPENAI:
            return await _send_openai_responses(credential, messages)
        return await _send_openai_compatible(credential, messages)
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


async def _send_anthropic(credential: ResolvedCredential, messages: list[ChatMessage]) -> str:
    headers = {"anthropic-version": "2023-06-01", "content-type": "application/json"}
    max_tokens = 1024
    body: dict[str, object] = {
        "model": credential.model,
        "messages": messages,
    }
    budget = _ANTHROPIC_THINKING_BUDGETS.get(credential.reasoning_effort or "")
    if budget is not None:
        body["thinking"] = {"type": "enabled", "budget_tokens": budget}
        max_tokens = budget + _ANTHROPIC_ANSWER_HEADROOM
    body["max_tokens"] = max_tokens
    if credential.auth_mode == "oauth":
        headers["authorization"] = f"Bearer {credential.secret}"
        headers["anthropic-beta"] = "oauth-2025-04-20"
        body["system"] = [{"type": "text", "text": _ANTHROPIC_OAUTH_SYSTEM_PREFIX}]
    else:
        headers["x-api-key"] = credential.secret or ""

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages", headers=headers, json=body
        )
        response.raise_for_status()
        payload = response.json()
        return "".join(block["text"] for block in payload["content"] if block.get("type") == "text")


async def _send_openai_responses(
    credential: ResolvedCredential, messages: list[ChatMessage]
) -> str:
    """OpenAI subscription mode (Codex): the Responses API, always via SSE
    even for a single non-streaming answer, collapsed here into one
    string. api_key mode uses the plain Chat Completions API instead - see
    _send_openai_compatible."""
    if credential.auth_mode != "oauth":
        return await _send_openai_compatible(credential, messages)

    headers = {
        "authorization": f"Bearer {credential.secret}",
        "content-type": "application/json",
        "accept": "text/event-stream",
        # The Codex CLI's own headers - the backend-api endpoint (unlike
        # the public platform API) checks for "official CLI" traffic the
        # same way Anthropic's OAuth endpoint does (see the system-prompt
        # prefix above). Without these the call 4xxs immediately.
        "openai-beta": "responses=experimental",
        "originator": "codex_cli_rs",
        "session_id": str(uuid.uuid4()),
    }
    if credential.account_id:
        headers["chatgpt-account-id"] = credential.account_id
    body: dict[str, object] = {
        "model": credential.model,
        "instructions": "You are Codex, a helpful coding and finance assistant.",
        "input": [
            {
                "type": "message",
                "role": m["role"],
                "content": [
                    {
                        "type": "output_text" if m["role"] == "assistant" else "input_text",
                        "text": m["content"],
                    }
                ],
            }
            for m in messages
        ],
        "stream": True,
        "store": False,
        "tools": [],
        "tool_choice": "auto",
        "parallel_tool_calls": False,
    }
    if credential.reasoning_effort:
        body["reasoning"] = {"effort": credential.reasoning_effort, "summary": "auto"}

    text_parts: list[str] = []
    async with (
        httpx.AsyncClient(timeout=_TIMEOUT) as client,
        client.stream(
            "POST", "https://chatgpt.com/backend-api/codex/responses", headers=headers, json=body
        ) as response,
    ):
        if response.is_error:
            await response.aread()
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            data = line.removeprefix("data:").strip()
            if not data or data == "[DONE]":
                continue
            event = json.loads(data)
            if event.get("type") != "response.output_text.delta":
                continue
            delta = event.get("delta")
            if isinstance(delta, str):
                text_parts.append(delta)
    return "".join(text_parts)


async def _send_openai_compatible(
    credential: ResolvedCredential, messages: list[ChatMessage]
) -> str:
    """Serves both Ollama (no auth, custom base_url) and OpenAI api_key
    mode (bearer, api.openai.com) - both speak the same Chat Completions
    request/response shape."""
    if credential.base_url:
        url = f"{credential.base_url.rstrip('/')}/v1/chat/completions"
        headers = {}
    else:
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"authorization": f"Bearer {credential.secret}"}

    body: dict[str, object] = {"model": credential.model, "messages": messages}
    # Ollama's catalog carries no reasoning_efforts, so this is always None
    # there - only ever set for OpenAI api_key mode.
    if credential.reasoning_effort:
        body["reasoning_effort"] = credential.reasoning_effort

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(url, headers=headers, json=body)
        response.raise_for_status()
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        return content if isinstance(content, str) else ""
