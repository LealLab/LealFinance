"""Conversation CRUD and SSE chat routes."""

import json
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.agents.credentials as credentials_module
import app.api.v1.agents as agents_router
from app.core.config import get_settings
from app.models.agent_conversation import (
    AGENT_CONVERSATION_STATUS_AWAITING,
    AgentConversation,
)
from app.models.agent_message import AgentMessage
from app.models.transaction import Transaction
from app.models.user import ROLE_MEMBER
from tests.factories import login_as, make_user


@pytest.fixture(autouse=True)
def _shared_session(db_session, monkeypatch):
    @asynccontextmanager
    async def _scope():
        yield db_session

    monkeypatch.setattr("app.services.agent_chat.session_scope", _scope)


_RealAsyncClient = httpx.AsyncClient


def _enable_agents(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    patched = get_settings().model_copy(update={"agents_enabled": True, **overrides})
    monkeypatch.setattr(agents_router, "get_settings", lambda: patched)
    monkeypatch.setattr(credentials_module, "get_settings", lambda: patched)


async def _chat_user(client: AsyncClient, db: AsyncSession, email: str):
    user, password = await make_user(db, email=email, role=ROLE_MEMBER)
    user.ai_chat_enabled = True
    await db.commit()
    await login_as(client, email=user.email, password=password)
    return user


async def _conversation(client: AsyncClient) -> dict[str, object]:
    response = await client.post("/api/v1/agents/conversations", json={})
    assert response.status_code == 201, response.text
    return response.json()


def _frame(name: str, payload: dict[str, object]) -> bytes:
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n".encode()


def _text_body(*texts: str) -> bytes:
    body = b"".join(
        _frame(
            "content_block_delta",
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}},
        )
        for text in texts
    )
    return (
        body
        + _frame("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}})
        + _frame("message_stop", {"type": "message_stop"})
    )


def _tool_body(tool_id: str, name: str, arguments: dict[str, object]) -> bytes:
    return (
        _frame(
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "tool_use", "id": tool_id, "name": name},
            },
        )
        + _frame(
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {
                    "type": "input_json_delta",
                    "partial_json": json.dumps(arguments),
                },
            },
        )
        + _frame("content_block_stop", {"type": "content_block_stop", "index": 0})
        + _frame("message_delta", {"type": "message_delta", "delta": {"stop_reason": "tool_use"}})
        + _frame("message_stop", {"type": "message_stop"})
    )


def _mock_client_factory(handler: object) -> object:
    def factory(*args: object, **kwargs: object) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(handler)  # type: ignore[arg-type]
        return _RealAsyncClient(*args, **kwargs)  # type: ignore[arg-type]

    return factory


def _events(text: str) -> list[tuple[str, dict[str, object]]]:
    result = []
    for block in text.split("\n\n"):
        lines = block.splitlines()
        if not lines or lines[0].startswith(":"):
            continue
        name = next(line.removeprefix("event: ") for line in lines if line.startswith("event:"))
        data = next(line.removeprefix("data: ") for line in lines if line.startswith("data:"))
        result.append((name, json.loads(data)))
    return result


async def test_create_list_and_detail(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    await _chat_user(client, db_session, "chat-crud@example.com")

    created = await _conversation(client)
    assert created["provider"] == "anthropic"
    assert created["model"] == "claude-sonnet-5"

    listed = await client.get("/api/v1/agents/conversations")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [created["id"]]

    detail = await client.get(f"/api/v1/agents/conversations/{created['id']}")
    assert detail.status_code == 200
    assert detail.json()["messages"] == []


async def test_create_without_configured_provider_returns_not_configured(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(
        monkeypatch,
        anthropic_api_key=None,
        openai_api_key=None,
        ollama_base_url=None,
    )
    await _chat_user(client, db_session, "chat-no-provider@example.com")

    response = await client.post("/api/v1/agents/conversations", json={})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.not_configured"


async def test_message_stream_persists_user_and_assistant(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    await _chat_user(client, db_session, "chat-message@example.com")
    conversation = await _conversation(client)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=_text_body("Hel", "lo"), headers={"content-type": "text/event-stream"}
        )

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    response = await client.post(
        f"/api/v1/agents/conversations/{conversation['id']}/messages",
        json={"content": "Hello assistant"},
    )
    assert response.status_code == 200, response.text
    events = _events(response.text)
    assert [name for name, _ in events] == ["delta", "delta", "done"]
    assert events[-1][1]["status"] == "idle"

    detail = await client.get(f"/api/v1/agents/conversations/{conversation['id']}")
    body = detail.json()
    assert body["title"] == "Hello assistant"
    assert [message["role"] for message in body["messages"]] == ["user", "assistant"]


async def test_message_stream_uses_client_date_in_system_prompt(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    await _chat_user(client, db_session, "chat-client-date@example.com")
    conversation = await _conversation(client)
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(
            200, content=_text_body("ok"), headers={"content-type": "text/event-stream"}
        )

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    response = await client.post(
        f"/api/v1/agents/conversations/{conversation['id']}/messages",
        json={"content": "spent 10", "client_date": "2031-03-14"},
    )
    assert response.status_code == 200, response.text
    body = json.loads(captured["request"].content)
    assert "2031-03-14" in body["system"]


async def test_write_tool_confirmation_executes_only_after_approval(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    user = await _chat_user(client, db_session, "chat-write@example.com")
    conversation = await _conversation(client)

    account = await client.post(
        "/api/v1/accounts",
        json={"name": "Checking", "type": "checking", "currency": "BRL"},
    )
    assert account.status_code == 201, account.text
    group = await client.post(
        "/api/v1/category-groups",
        json={"name": "Expenses", "kind": "expense", "color": "#112233", "icon": "tag"},
    )
    assert group.status_code == 201, group.text
    category = await client.post(
        "/api/v1/categories",
        json={
            "name": "Food",
            "kind": "expense",
            "group_id": group.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert category.status_code == 201, category.text
    arguments = {
        "type": "expense",
        "date": "2026-08-31",
        "amount": "10.00",
        "currency": "BRL",
        "account_id": account.json()["id"],
        "category_id": category.json()["id"],
        "description": "Lunch",
    }
    responses = [_tool_body("w1", "create_transaction", arguments), _text_body("Recorded")]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=responses.pop(0), headers={"content-type": "text/event-stream"}
        )

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    first = await client.post(
        f"/api/v1/agents/conversations/{conversation['id']}/messages",
        json={"content": "Add lunch expense"},
    )
    first_events = _events(first.text)
    assert [name for name, _ in first_events][-2:] == ["tool_confirm", "done"]
    assert first_events[-1][1]["status"] == AGENT_CONVERSATION_STATUS_AWAITING
    assert (
        await db_session.scalar(select(Transaction).where(Transaction.user_id == user.id)) is None
    )

    row = await db_session.get(AgentConversation, UUID(str(conversation["id"])))
    assert row is not None
    assert row.status == AGENT_CONVERSATION_STATUS_AWAITING
    assert row.pending_call_id == "w1"

    confirmed = await client.post(
        f"/api/v1/agents/conversations/{conversation['id']}/confirm",
        json={"tool_call_id": "w1", "approved": True, "arguments": arguments},
    )
    confirm_events = _events(confirmed.text)
    assert [name for name, _ in confirm_events] == ["tool_result", "delta", "done"]
    assert confirm_events[-1][1]["status"] == "idle"
    assert (
        await db_session.scalar(select(Transaction).where(Transaction.user_id == user.id))
        is not None
    )

    await db_session.refresh(row)
    assert row.status == "idle"
    assert row.pending_call_id is None


async def test_stale_confirmation_returns_conflict(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    user = await _chat_user(client, db_session, "chat-stale-confirm@example.com")
    conversation = await _conversation(client)
    row = await db_session.get(AgentConversation, UUID(str(conversation["id"])))
    assert row is not None
    row.status = AGENT_CONVERSATION_STATUS_AWAITING
    row.pending_call_id = "w1"
    await db_session.commit()

    response = await client.post(
        f"/api/v1/agents/conversations/{conversation['id']}/confirm",
        json={"tool_call_id": "stale", "approved": True},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "agents.no_pending_tool"
    assert user.id == row.user_id


async def test_message_while_awaiting_returns_sse_error(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    await _chat_user(client, db_session, "chat-awaiting-message@example.com")
    conversation = await _conversation(client)
    row = await db_session.get(AgentConversation, UUID(str(conversation["id"])))
    assert row is not None
    row.status = AGENT_CONVERSATION_STATUS_AWAITING
    row.pending_call_id = "w1"
    await db_session.commit()

    response = await client.post(
        f"/api/v1/agents/conversations/{conversation['id']}/messages",
        json={"content": "Try again"},
    )
    assert _events(response.text) == [
        ("error", {"code": "agents.awaiting_confirmation", "params": {}})
    ]


async def test_foreign_conversation_is_hidden_from_all_routes(
    client: AsyncClient,
    other_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    await _chat_user(client, db_session, "chat-owner@example.com")
    await _chat_user(other_client, db_session, "chat-foreign@example.com")
    conversation = await _conversation(client)
    path = f"/api/v1/agents/conversations/{conversation['id']}"

    for response in (
        await other_client.get(path),
        await other_client.delete(path),
        await other_client.post(f"{path}/messages", json={"content": "nope"}),
        await other_client.post(f"{path}/confirm", json={"tool_call_id": "w1", "approved": True}),
    ):
        assert response.status_code == 404


async def test_disabled_chat_member_is_rejected_on_all_new_routes(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    user, password = await make_user(db_session, email="chat-disabled-member@example.com")
    await login_as(client, email=user.email, password=password)
    path = f"/api/v1/agents/conversations/{uuid4()}"

    responses = (
        await client.get("/api/v1/agents/conversations"),
        await client.post("/api/v1/agents/conversations", json={}),
        await client.get(path),
        await client.delete(path),
        await client.post(f"{path}/messages", json={"content": "nope"}),
        await client.post(f"{path}/confirm", json={"tool_call_id": "w1", "approved": True}),
    )
    assert [response.status_code for response in responses] == [403] * 6
    assert all(
        response.json()["error"]["code"] == "agents.chat_not_allowed" for response in responses
    )


async def test_agents_disabled_hides_all_new_routes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _chat_user(client, db_session, "chat-agents-disabled@example.com")
    path = f"/api/v1/agents/conversations/{uuid4()}"

    responses = (
        await client.get("/api/v1/agents/conversations"),
        await client.post("/api/v1/agents/conversations", json={}),
        await client.get(path),
        await client.delete(path),
        await client.post(f"{path}/messages", json={"content": "nope"}),
        await client.post(f"{path}/confirm", json={"tool_call_id": "w1", "approved": True}),
    )
    assert [response.status_code for response in responses] == [404] * 6
    assert all(response.json()["error"]["code"] == "agents.disabled" for response in responses)


async def test_delete_conversation_cascades_messages(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    user = await _chat_user(client, db_session, "chat-delete@example.com")
    conversation = await _conversation(client)
    conversation_id = UUID(str(conversation["id"]))
    db_session.add(
        AgentMessage(
            user_id=user.id,
            conversation_id=conversation_id,
            role="user",
            content="hello",
            position=0,
        )
    )
    await db_session.commit()

    response = await client.delete(f"/api/v1/agents/conversations/{conversation['id']}")
    assert response.status_code == 204
    assert (
        await client.get(f"/api/v1/agents/conversations/{conversation['id']}")
    ).status_code == 404
    assert (
        await db_session.scalar(
            select(AgentMessage.id).where(AgentMessage.conversation_id == conversation_id)
        )
        is None
    )
