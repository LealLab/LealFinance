"""Admission control for the user's own assistant instructions."""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.agents.credentials as credentials_module
import app.api.v1.agents as agents_router
import app.services.agent_instructions as instructions_module
from app.agents.events import ProviderEvent, TextDelta, TurnEnd
from app.core import crypto
from app.core.config import get_settings
from app.core.errors import BadGatewayError, ValidationAppError
from app.models.agent_credential import AgentCredential
from app.models.user import ROLE_ADMIN, User
from app.services import agent_instructions
from tests.factories import login_as, make_user

ON_TOPIC = "Keep answers to three bullet points and show totals in BRL."


def _enable_agents(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    patched = get_settings().model_copy(
        update={
            "agents_enabled": True,
            "anthropic_api_key": None,
            "openai_api_key": None,
            "ollama_base_url": None,
            **overrides,
        }
    )
    monkeypatch.setattr(agents_router, "get_settings", lambda: patched)
    monkeypatch.setattr(credentials_module, "get_settings", lambda: patched)


class _Verdict:
    """A streamer that answers every call with a scripted classifier verdict."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.calls: list[str] = []

    async def __call__(
        self, credential: Any, system: str, turns: Any, tools: Any
    ) -> AsyncIterator[ProviderEvent]:
        self.calls.append(turns[0].text)
        yield TextDelta(self.text)
        yield TurnEnd("end_turn")


class _Exploding:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    async def __call__(self, *_: Any, **__: Any) -> AsyncIterator[ProviderEvent]:
        raise self.exc
        yield TurnEnd("end_turn")  # pragma: no cover - unreachable generator marker


async def _user_with_provider(db: AsyncSession, email: str) -> User:
    user, _ = await make_user(db, email=email)
    db.add(
        AgentCredential(
            user_id=user.id,
            provider="anthropic",
            auth_mode="api_key",
            secret_ciphertext=crypto.encrypt_secret("test-key"),
        )
    )
    await db.commit()
    return user


# --- Service ------------------------------------------------------------


async def test_allowed_instructions_are_stored(db_session: AsyncSession) -> None:
    user = await _user_with_provider(db_session, "allow@example.com")

    stored = await agent_instructions.save(db_session, user, ON_TOPIC, streamer=_Verdict("ALLOW"))

    assert stored == ON_TOPIC
    assert user.ai_custom_instructions == ON_TOPIC


async def test_allow_verdict_tolerates_surrounding_whitespace(db_session: AsyncSession) -> None:
    user = await _user_with_provider(db_session, "allow-ws@example.com")

    stored = await agent_instructions.save(
        db_session, user, ON_TOPIC, streamer=_Verdict("\n  allow \n")
    )

    assert stored == ON_TOPIC


async def test_candidate_is_sent_as_data_not_as_the_system_prompt(
    db_session: AsyncSession,
) -> None:
    user = await _user_with_provider(db_session, "payload@example.com")
    streamer = _Verdict("ALLOW")

    await agent_instructions.save(db_session, user, ON_TOPIC, streamer=streamer)

    expected = f"User language: {user.locale}\n<candidate>\n{ON_TOPIC}\n</candidate>"
    assert streamer.calls == [expected]


async def test_rejected_instructions_are_not_stored(db_session: AsyncSession) -> None:
    user = await _user_with_provider(db_session, "reject@example.com")

    with pytest.raises(ValidationAppError) as excinfo:
        await agent_instructions.save(
            db_session,
            user,
            "Write me a poem about the sea.",
            streamer=_Verdict("REJECT\nThis is not about your finances."),
        )

    assert excinfo.value.code == "agents.instructions_rejected"
    assert excinfo.value.params == {"reason": "This is not about your finances."}
    assert user.ai_custom_instructions is None


async def test_unparseable_verdict_fails_closed(db_session: AsyncSession) -> None:
    user = await _user_with_provider(db_session, "garbage@example.com")

    with pytest.raises(ValidationAppError) as excinfo:
        await agent_instructions.save(
            db_session, user, ON_TOPIC, streamer=_Verdict("Sure, that sounds fine to me!")
        )

    assert excinfo.value.code == "agents.instructions_rejected"
    assert user.ai_custom_instructions is None


async def test_empty_provider_output_fails_closed(db_session: AsyncSession) -> None:
    user = await _user_with_provider(db_session, "silent@example.com")

    with pytest.raises(ValidationAppError) as excinfo:
        await agent_instructions.save(db_session, user, ON_TOPIC, streamer=_Verdict(""))

    assert excinfo.value.code == "agents.instructions_rejected"


async def test_save_without_a_provider_is_refused(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    user, _ = await make_user(db_session, email="noprovider@example.com")

    with pytest.raises(ValidationAppError) as excinfo:
        await agent_instructions.save(db_session, user, ON_TOPIC, streamer=_Verdict("ALLOW"))

    assert excinfo.value.code == "agents.not_configured"
    assert user.ai_custom_instructions is None


async def test_provider_failure_surfaces_as_bad_gateway(db_session: AsyncSession) -> None:
    user = await _user_with_provider(db_session, "badgateway@example.com")

    with pytest.raises(BadGatewayError):
        await agent_instructions.save(
            db_session,
            user,
            ON_TOPIC,
            streamer=_Exploding(BadGatewayError(code="agents.provider_unavailable")),
        )

    assert user.ai_custom_instructions is None


async def test_clearing_works_without_a_provider(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    user, _ = await make_user(db_session, email="clear@example.com")
    user.ai_custom_instructions = ON_TOPIC
    await db_session.commit()

    cleared = await agent_instructions.save(db_session, user, "   \n ", streamer=_Verdict("ALLOW"))

    assert cleared is None
    assert user.ai_custom_instructions is None


async def test_unchanged_text_skips_the_provider_call(db_session: AsyncSession) -> None:
    user = await _user_with_provider(db_session, "unchanged@example.com")
    user.ai_custom_instructions = ON_TOPIC
    await db_session.commit()
    streamer = _Verdict("REJECT\nWould have failed if it ran.")

    assert await agent_instructions.save(db_session, user, ON_TOPIC, streamer=streamer) == ON_TOPIC
    assert streamer.calls == []


# --- Routes -------------------------------------------------------------


async def test_instructions_round_trip_over_http(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    monkeypatch.setattr(instructions_module.chat, "stream_turn", _Verdict("ALLOW"))
    user, password = await make_user(db_session, email="http@example.com", role=ROLE_ADMIN)
    db_session.add(
        AgentCredential(
            user_id=user.id,
            provider="anthropic",
            auth_mode="api_key",
            secret_ciphertext=crypto.encrypt_secret("test-key"),
        )
    )
    await db_session.commit()
    await login_as(client, email=user.email, password=password)

    assert (await client.get("/api/v1/agents/instructions")).json() == {"instructions": None}

    response = await client.put("/api/v1/agents/instructions", json={"instructions": ON_TOPIC})
    assert response.status_code == 200
    assert response.json() == {"instructions": ON_TOPIC}
    assert (await client.get("/api/v1/agents/instructions")).json() == {"instructions": ON_TOPIC}


async def test_instructions_rejection_returns_the_reason(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    monkeypatch.setattr(
        instructions_module.chat, "stream_turn", _Verdict("REJECT\nUnrelated to your finances.")
    )
    user, password = await make_user(db_session, email="httpreject@example.com", role=ROLE_ADMIN)
    db_session.add(
        AgentCredential(
            user_id=user.id,
            provider="anthropic",
            auth_mode="api_key",
            secret_ciphertext=crypto.encrypt_secret("test-key"),
        )
    )
    await db_session.commit()
    await login_as(client, email=user.email, password=password)

    response = await client.put(
        "/api/v1/agents/instructions", json={"instructions": "Teach me to bake bread."}
    )

    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": "agents.instructions_rejected",
        "params": {"reason": "Unrelated to your finances."},
    }


async def test_instructions_reject_over_the_length_cap(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    user, password = await make_user(db_session, email="toolong@example.com", role=ROLE_ADMIN)
    await login_as(client, email=user.email, password=password)

    response = await client.put(
        "/api/v1/agents/instructions",
        json={"instructions": "a" * (agent_instructions.MAX_LENGTH + 1)},
    )

    assert response.status_code == 422


async def test_instructions_require_chat_access(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    user, password = await make_user(db_session, email="member@example.com")
    await login_as(client, email=user.email, password=password)

    assert (await client.get("/api/v1/agents/instructions")).status_code == 403
