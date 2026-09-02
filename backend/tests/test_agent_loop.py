"""Agent loop, prompt, and off-topic gate behavior."""

import json
from collections.abc import AsyncIterator, Callable
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import prompt
from app.agents.credentials import ResolvedCredential
from app.agents.events import (
    ProviderEvent,
    TextDelta,
    ToolCall,
    ToolResultInput,
    ToolSpec,
    Turn,
    TurnEnd,
)
from app.agents.loop import (
    MAX_ITERATIONS,
    Delta,
    Done,
    Refusal,
    StreamError,
    ToolAwaitingConfirmation,
    ToolFinished,
    ToolStarted,
    rehydrate_turns,
    run_turn,
)
from app.agents.tools import ToolDef
from app.core.errors import BadGatewayError, NotFoundError
from app.models.agent_conversation import AgentConversation
from app.models.agent_message import AgentMessage
from app.models.user import User
from tests.factories import make_user


def _credential() -> ResolvedCredential:
    return ResolvedCredential(
        provider="anthropic",
        auth_mode="api_key",
        secret="test-secret",
        base_url=None,
        model="claude-sonnet-5",
        account_id=None,
        account_label=None,
        source="user",
    )


async def _conversation(db: AsyncSession, email: str) -> tuple[User, AgentConversation]:
    user, _ = await make_user(db, email=email)
    conversation = AgentConversation(
        user_id=user.id,
        provider="anthropic",
        model="claude-sonnet-5",
        status="idle",
    )
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return user, conversation


async def _peek(_db: AsyncSession, _user_id: Any, _arguments: dict[str, Any]) -> dict[str, int]:
    return {"ok": 1}


async def _not_found(
    _db: AsyncSession, _user_id: Any, _arguments: dict[str, Any]
) -> dict[str, int]:
    raise NotFoundError("x.not_found")


def _tool(name: str, run: Callable[..., Any], *, writes: bool = False) -> ToolDef:
    return ToolDef(
        name=name,
        description=name,
        schema={"type": "object", "properties": {}, "additionalProperties": False},
        run=run,
        writes=writes,
    )


def _scripted(
    scripts: list[list[ProviderEvent]], seen_turns: list[list[Turn]] | None = None
) -> Callable[..., AsyncIterator[ProviderEvent]]:
    async def fake(
        _credential: ResolvedCredential,
        _system: str,
        turns: list[Turn],
        _tools: list[ToolSpec],
    ) -> AsyncIterator[ProviderEvent]:
        if seen_turns is not None:
            seen_turns.append(list(turns))
        for event in scripts.pop(0):
            yield event

    return fake


async def test_plain_text_answer(db_session: AsyncSession) -> None:
    user, conversation = await _conversation(db_session, "loop-plain@example.com")
    events = [
        event
        async for event in run_turn(
            db_session,
            conversation,
            [Turn(role="user", text="hello")],
            _credential(),
            "system",
            streamer=_scripted([[TextDelta("Hello "), TextDelta("world"), TurnEnd("end_turn")]]),
            tool_defs=[],
        )
    ]

    assert events[:2] == [Delta("Hello "), Delta("world")]
    assert isinstance(events[2], Done)
    assert events[2].status == "idle"
    assert events[2].message_id is not None
    messages = (
        (
            await db_session.execute(
                select(AgentMessage).where(AgentMessage.conversation_id == conversation.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(messages) == 1
    assert messages[0].user_id == user.id
    assert messages[0].content == "Hello world"
    assert conversation.status == "idle"


async def test_off_topic_is_refused_without_delta(db_session: AsyncSession) -> None:
    _, conversation = await _conversation(db_session, "loop-off-topic@example.com")
    events = [
        event
        async for event in run_turn(
            db_session,
            conversation,
            [Turn(role="user", text="tell me a joke")],
            _credential(),
            "system",
            streamer=_scripted([[TextDelta(prompt.OFF_TOPIC_MARKER), TurnEnd("end_turn")]]),
            tool_defs=[],
        )
    ]

    assert events[0] == Refusal("agents.off_topic")
    assert isinstance(events[1], Done)
    assert not any(isinstance(event, Delta) for event in events)
    message = (
        await db_session.execute(
            select(AgentMessage).where(AgentMessage.conversation_id == conversation.id)
        )
    ).scalar_one()
    assert message.content == prompt.OFF_TOPIC_MARKER


async def test_off_topic_gate_flushes_nonmatching_prefix(db_session: AsyncSession) -> None:
    _, conversation = await _conversation(db_session, "loop-gate@example.com")
    events = [
        event
        async for event in run_turn(
            db_session,
            conversation,
            [Turn(role="user", text="not finance")],
            _credential(),
            "system",
            streamer=_scripted([[TextDelta("[[LF"), TextDelta(" no wait"), TurnEnd("end_turn")]]),
            tool_defs=[],
        )
    ]

    assert "".join(event.text for event in events if isinstance(event, Delta)) == "[[LF no wait"
    assert not any(isinstance(event, Refusal) for event in events)


async def test_read_tool_then_answer(db_session: AsyncSession) -> None:
    _, conversation = await _conversation(db_session, "loop-read@example.com")
    seen: list[list[Turn]] = []
    events = [
        event
        async for event in run_turn(
            db_session,
            conversation,
            [Turn(role="user", text="peek")],
            _credential(),
            "system",
            streamer=_scripted(
                [
                    [ToolCall("c1", "peek", {}), TurnEnd("tool_use")],
                    [TextDelta("done"), TurnEnd("end_turn")],
                ],
                seen,
            ),
            tool_defs=[_tool("peek", _peek)],
        )
    ]

    assert ToolStarted("c1", "peek", {}) in events
    assert ToolFinished("c1", "peek", ok=True) in events
    assert Delta("done") in events
    assert isinstance(events[-1], Done)
    tool_message = (
        await db_session.execute(
            select(AgentMessage).where(
                AgentMessage.conversation_id == conversation.id,
                AgentMessage.role == "tool",
            )
        )
    ).scalar_one()
    assert tool_message.tool_call_id == "c1"
    assert any(turn.tool_results for turn in seen[1])


async def test_read_tool_app_error_continues(db_session: AsyncSession) -> None:
    _, conversation = await _conversation(db_session, "loop-tool-error@example.com")
    events = [
        event
        async for event in run_turn(
            db_session,
            conversation,
            [Turn(role="user", text="peek")],
            _credential(),
            "system",
            streamer=_scripted(
                [
                    [ToolCall("c1", "missing", {}), TurnEnd("tool_use")],
                    [TextDelta("recovered"), TurnEnd("end_turn")],
                ]
            ),
            tool_defs=[_tool("missing", _not_found)],
        )
    ]

    assert ToolFinished("c1", "missing", ok=False) in events
    assert Delta("recovered") in events
    tool_message = (
        await db_session.execute(
            select(AgentMessage).where(
                AgentMessage.conversation_id == conversation.id,
                AgentMessage.role == "tool",
            )
        )
    ).scalar_one()
    assert tool_message.is_error is True
    assert json.loads(tool_message.content) == {"error": "x.not_found", "params": {}}


async def test_write_tool_suspends_for_confirmation(db_session: AsyncSession) -> None:
    _, conversation = await _conversation(db_session, "loop-write@example.com")
    arguments = {"amount": "10.00"}
    called = False

    async def write(_db: AsyncSession, _user_id: Any, _arguments: dict[str, Any]) -> dict[str, int]:
        nonlocal called
        called = True
        return {"ok": 1}

    events = [
        event
        async for event in run_turn(
            db_session,
            conversation,
            [Turn(role="user", text="create")],
            _credential(),
            "system",
            streamer=_scripted(
                [[ToolCall("w1", "create_transaction", arguments), TurnEnd("tool_use")]]
            ),
            tool_defs=[_tool("create_transaction", write, writes=True)],
        )
    ]

    assert events[-2] == ToolAwaitingConfirmation("w1", "create_transaction", arguments)
    assert isinstance(events[-1], Done)
    assert events[-1].status == "awaiting_confirmation"
    assert conversation.status == "awaiting_confirmation"
    assert conversation.pending_call_id == "w1"
    assert called is False


async def test_iteration_cap(db_session: AsyncSession) -> None:
    _, conversation = await _conversation(db_session, "loop-cap@example.com")
    calls = 0

    async def always_tool(
        _credential: ResolvedCredential,
        _system: str,
        _turns: list[Turn],
        _tools: list[ToolSpec],
    ) -> AsyncIterator[ProviderEvent]:
        nonlocal calls
        calls += 1
        yield ToolCall(f"c{calls}", "peek", {})
        yield TurnEnd("tool_use")

    events = [
        event
        async for event in run_turn(
            db_session,
            conversation,
            [Turn(role="user", text="loop")],
            _credential(),
            "system",
            streamer=always_tool,
            tool_defs=[_tool("peek", _peek)],
        )
    ]

    assert calls == MAX_ITERATIONS
    assert events[-1] == StreamError("agents.tool_loop_exhausted", {})


async def test_provider_failure_resets_conversation(db_session: AsyncSession) -> None:
    _, conversation = await _conversation(db_session, "loop-provider-error@example.com")

    async def failing(
        _credential: ResolvedCredential,
        _system: str,
        _turns: list[Turn],
        _tools: list[ToolSpec],
    ) -> AsyncIterator[ProviderEvent]:
        yield TextDelta("partial")
        raise BadGatewayError("agents.provider_unavailable")

    events = [
        event
        async for event in run_turn(
            db_session,
            conversation,
            [Turn(role="user", text="hello")],
            _credential(),
            "system",
            streamer=failing,
            tool_defs=[],
        )
    ]

    assert events[-1] == StreamError("agents.provider_unavailable", {})
    assert conversation.status == "idle"


async def test_rehydrate_turns_folds_tools_and_skips_refusal(db_session: AsyncSession) -> None:
    user, conversation = await _conversation(db_session, "loop-rehydrate@example.com")
    db_session.add_all(
        [
            AgentMessage(
                user_id=user.id,
                conversation_id=conversation.id,
                role="user",
                content="show it",
                position=0,
            ),
            AgentMessage(
                user_id=user.id,
                conversation_id=conversation.id,
                role="assistant",
                content="",
                tool_calls=[{"id": "c1", "name": "peek", "arguments": {}}],
                position=1,
            ),
            AgentMessage(
                user_id=user.id,
                conversation_id=conversation.id,
                role="tool",
                content='{"ok": 1}',
                tool_call_id="c1",
                tool_name="peek",
                position=2,
            ),
            AgentMessage(
                user_id=user.id,
                conversation_id=conversation.id,
                role="assistant",
                content="done",
                position=3,
            ),
            AgentMessage(
                user_id=user.id,
                conversation_id=conversation.id,
                role="assistant",
                content=prompt.OFF_TOPIC_MARKER,
                position=4,
            ),
        ]
    )
    await db_session.commit()
    messages = (
        (
            await db_session.execute(
                select(AgentMessage).where(AgentMessage.conversation_id == conversation.id)
            )
        )
        .scalars()
        .all()
    )

    assert rehydrate_turns(messages) == [
        Turn(role="user", text="show it"),
        Turn(role="assistant", tool_calls=(ToolCall("c1", "peek", {}),)),
        Turn(
            role="user",
            tool_results=(ToolResultInput("c1", "peek", '{"ok": 1}'),),
        ),
        Turn(role="assistant", text="done"),
    ]


async def test_prompt_build_includes_context() -> None:
    user = User(
        email="prompt@example.com",
        normalized_email="prompt@example.com",
        password_hash="unused",
        display_name="Prompt User",
        locale="pt-BR",
        display_currency="USD",
    )

    built = prompt.build(user, date(2026, 1, 15))

    assert prompt.OFF_TOPIC_MARKER in built
    assert "USD" in built
    assert "2026-01-15" in built
    assert "pt-BR" in built


def _prompt_user(instructions: str | None) -> User:
    return User(
        email="custom@example.com",
        normalized_email="custom@example.com",
        password_hash="unused",
        display_name="Custom User",
        locale="pt-BR",
        display_currency="USD",
        ai_custom_instructions=instructions,
    )


async def test_prompt_build_appends_custom_instructions_after_the_rules() -> None:
    built = prompt.build(_prompt_user("Keep answers to three bullet points."), date(2026, 1, 15))

    assert "<user_preferences>\nKeep answers to three bullet points.\n</user_preferences>" in built
    # The preface must sit between the base prompt and the user's text so the
    # guardrails, not the user, have the last word before the block.
    assert built.index(prompt.OFF_TOPIC_MARKER) < built.index(prompt.CUSTOM_INSTRUCTIONS_PREFACE)
    assert built.index(prompt.CUSTOM_INSTRUCTIONS_PREFACE) < built.index("<user_preferences>")


async def test_prompt_build_ignores_blank_custom_instructions() -> None:
    baseline = prompt.build(_prompt_user(None), date(2026, 1, 15))

    assert prompt.build(_prompt_user("   \n  "), date(2026, 1, 15)) == baseline
    assert "<user_preferences>" not in baseline
