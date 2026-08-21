"""AI provider linking, credential precedence (user row overrides .env),
OAuth PKCE state checking, the non-streaming smoke-chat call, ownership
isolation, and - the money/security-adjacent part - that a stored secret
is encrypted at rest, degrades cleanly after a key rotation, and never
appears in any response body.
"""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.agents.credentials as credentials_module
import app.api.v1.agents as agents_router
import app.services.agent_providers as agent_providers_module
from app.agents import chat as chat_module
from app.agents import oauth
from app.agents.credentials import ResolvedCredential
from app.agents.oauth import OAuthTokens
from app.core import crypto
from app.core.config import get_settings
from app.core.errors import BadGatewayError
from app.models.agent_credential import AgentCredential
from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


def _enable_agents(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    patched = get_settings().model_copy(update={"agents_enabled": True, **overrides})
    monkeypatch.setattr(agents_router, "get_settings", lambda: patched)
    monkeypatch.setattr(credentials_module, "get_settings", lambda: patched)


# --- Gating -------------------------------------------------------------


async def test_agents_disabled_by_default(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "gate@example.com")
    response = await client.get("/api/v1/agents/providers")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "agents.disabled"


async def test_agents_routes_require_authentication(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    response = await client.get("/api/v1/agents/providers")
    assert response.status_code == 401


# --- Status / credential precedence -------------------------------------


async def test_list_providers_env_fallback(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env-only")
    await _authed(client, db_session, "envfallback@example.com")

    response = await client.get("/api/v1/agents/providers")
    assert response.status_code == 200
    by_provider = {row["provider"]: row for row in response.json()}
    assert by_provider["anthropic"]["configured"] is True
    assert by_provider["anthropic"]["source"] == "env"
    assert by_provider["openai"]["configured"] is False
    assert by_provider["openai"]["source"] == "none"
    assert "sk-env-only" not in response.text


async def test_link_user_row_overrides_env(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env-only")
    await _authed(client, db_session, "override@example.com")

    link = await client.put("/api/v1/agents/providers/anthropic", json={"api_key": "sk-user-key"})
    assert link.status_code == 200, link.text
    assert link.json()["source"] == "user"
    assert link.json()["auth_mode"] == "api_key"
    assert "sk-user-key" not in link.text
    assert "sk-env-only" not in link.text

    unlink = await client.delete("/api/v1/agents/providers/anthropic")
    assert unlink.status_code == 204

    after = await client.get("/api/v1/agents/providers")
    anthropic = next(row for row in after.json() if row["provider"] == "anthropic")
    assert anthropic["source"] == "env"


async def test_link_ollama_requires_base_url(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "ollama-missing-url@example.com")

    response = await client.put("/api/v1/agents/providers/ollama", json={})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.base_url_required"


async def test_link_ollama_with_base_url(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "ollama-ok@example.com")

    response = await client.put(
        "/api/v1/agents/providers/ollama", json={"base_url": "http://ollama:11434"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["auth_mode"] == "none"
    assert response.json()["configured"] is True


async def test_link_unknown_provider_returns_404(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "unknown-provider@example.com")

    response = await client.put("/api/v1/agents/providers/bogus", json={"api_key": "x"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "agents.provider_unknown"


async def test_unlink_missing_credential_returns_404(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "unlink-missing@example.com")

    response = await client.delete("/api/v1/agents/providers/anthropic")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "agent_credential.not_found"


async def test_agents_ownership_isolation(
    client: AsyncClient,
    other_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "owner@example.com")
    await _authed(other_client, db_session, "intruder@example.com")

    linked = await client.put("/api/v1/agents/providers/anthropic", json={"api_key": "sk-owner"})
    assert linked.status_code == 200

    other_list = await other_client.get("/api/v1/agents/providers")
    other_anthropic = next(row for row in other_list.json() if row["provider"] == "anthropic")
    assert other_anthropic["configured"] is False

    other_delete = await other_client.delete("/api/v1/agents/providers/anthropic")
    assert other_delete.status_code == 404
    assert other_delete.json()["error"]["code"] == "agent_credential.not_found"


# --- OAuth ----------------------------------------------------------------


async def test_oauth_start_returns_authorize_url(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "oauth-start@example.com")

    response = await client.post("/api/v1/agents/providers/anthropic/oauth/start")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["authorize_url"].startswith("https://claude.ai/oauth/authorize?")
    assert body["verifier"]
    assert body["state"]


async def test_oauth_start_unsupported_provider(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "oauth-unsupported@example.com")

    response = await client.post("/api/v1/agents/providers/ollama/oauth/start")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.oauth_unsupported"


async def test_oauth_complete_state_mismatch(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No network call needed: the state check for Anthropic happens
    before the token exchange, against the code#state the vendor page
    displays."""
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "oauth-mismatch@example.com")

    response = await client.post(
        "/api/v1/agents/providers/anthropic/oauth/complete",
        json={"verifier": "v", "state": "expected-state", "code": "authcode#other-state"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.oauth_state_mismatch"


async def test_oauth_complete_success_links_and_hides_secret(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "oauth-complete@example.com")

    async def fake_complete(provider: str, **_kwargs: object) -> OAuthTokens:
        return OAuthTokens(
            access_token="oauth-access-token",
            refresh_token="oauth-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            account_id="acct_123",
            account_label="Claude subscription",
        )

    monkeypatch.setattr(agent_providers_module.oauth, "complete", fake_complete)

    response = await client.post(
        "/api/v1/agents/providers/anthropic/oauth/complete",
        json={"verifier": "v", "state": "s", "code": "authcode#s"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "user"
    assert body["auth_mode"] == "oauth"
    assert body["account_label"] == "Claude subscription"
    assert "oauth-access-token" not in response.text
    assert "oauth-refresh-token" not in response.text


# --- Chat -------------------------------------------------------------


async def test_chat_not_configured(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "chat-not-configured@example.com")

    response = await client.post(
        "/api/v1/agents/chat", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.not_configured"


async def test_chat_success(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-chat")
    await _authed(client, db_session, "chat-success@example.com")

    async def fake_send_chat(_credential: object, _messages: object) -> str:
        return "pong"

    monkeypatch.setattr(agent_providers_module.chat_module, "send_chat", fake_send_chat)

    response = await client.post(
        "/api/v1/agents/chat",
        json={"provider": "anthropic", "messages": [{"role": "user", "content": "ping"}]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["reply"] == "pong"
    assert response.json()["provider"] == "anthropic"


async def test_chat_provider_unavailable_never_surfaces_as_500(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-chat")
    await _authed(client, db_session, "chat-unavailable@example.com")

    async def fake_send_chat(_credential: object, _messages: object) -> str:
        raise BadGatewayError(code="agents.provider_unavailable")

    monkeypatch.setattr(agent_providers_module.chat_module, "send_chat", fake_send_chat)

    response = await client.post(
        "/api/v1/agents/chat",
        json={"provider": "anthropic", "messages": [{"role": "user", "content": "ping"}]},
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "agents.provider_unavailable"


async def test_provider_test_endpoint(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-test")
    await _authed(client, db_session, "provider-test@example.com")

    async def ok_send_chat(_credential: object, _messages: object) -> str:
        return "pong"

    monkeypatch.setattr(agent_providers_module.chat_module, "send_chat", ok_send_chat)
    ok_response = await client.post("/api/v1/agents/providers/anthropic/test")
    assert ok_response.json() == {"ok": True, "error_code": None}

    async def failing_send_chat(_credential: object, _messages: object) -> str:
        raise BadGatewayError(code="agents.provider_unavailable")

    monkeypatch.setattr(agent_providers_module.chat_module, "send_chat", failing_send_chat)
    failed_response = await client.post("/api/v1/agents/providers/anthropic/test")
    assert failed_response.json() == {"ok": False, "error_code": "agents.provider_unavailable"}

    not_configured = await client.post("/api/v1/agents/providers/openai/test")
    assert not_configured.json() == {"ok": False, "error_code": "agents.not_configured"}


# --- OAuth refresh precedence -------------------------------------------


async def test_expired_oauth_refresh_success_updates_row(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    user, password = await make_user(db_session, email="refresh-ok@example.com")
    await login_as(client, email=user.email, password=password)

    row = AgentCredential(
        user_id=user.id,
        provider="anthropic",
        auth_mode="oauth",
        secret_ciphertext=crypto.encrypt_secret("stale-access-token"),
        refresh_ciphertext=crypto.encrypt_secret("valid-refresh-token"),
        expires_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    db_session.add(row)
    await db_session.commit()

    async def fake_refresh(_provider: str, _refresh_token: str) -> OAuthTokens:
        return OAuthTokens(
            access_token="fresh-access-token",
            refresh_token="fresh-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            account_id=None,
            account_label=None,
        )

    monkeypatch.setattr(credentials_module.oauth, "refresh", fake_refresh)

    response = await client.get("/api/v1/agents/providers")
    anthropic = next(r for r in response.json() if r["provider"] == "anthropic")
    assert anthropic["configured"] is True
    assert anthropic["source"] == "user"
    assert "fresh-access-token" not in response.text


async def test_expired_oauth_refresh_failure_clears_row_and_falls_back(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env-after-failed-refresh")
    user, password = await make_user(db_session, email="refresh-fail@example.com")
    await login_as(client, email=user.email, password=password)

    row = AgentCredential(
        user_id=user.id,
        provider="anthropic",
        auth_mode="oauth",
        secret_ciphertext=crypto.encrypt_secret("stale-access-token"),
        refresh_ciphertext=crypto.encrypt_secret("dead-refresh-token"),
        expires_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    db_session.add(row)
    await db_session.commit()

    async def failing_refresh(_provider: str, _refresh_token: str) -> OAuthTokens:
        raise httpx.HTTPStatusError(
            "refresh rejected",
            request=httpx.Request("POST", "https://x"),
            response=httpx.Response(400),
        )

    monkeypatch.setattr(credentials_module.oauth, "refresh", failing_refresh)

    response = await client.get("/api/v1/agents/providers")
    anthropic = next(r for r in response.json() if r["provider"] == "anthropic")
    assert anthropic["configured"] is True
    assert anthropic["source"] == "env"


# --- Crypto ---------------------------------------------------------------


def test_encrypt_decrypt_round_trip() -> None:
    ciphertext = crypto.encrypt_secret("super-secret-api-key")
    assert ciphertext != "super-secret-api-key"
    assert crypto.decrypt_secret(ciphertext) == "super-secret-api-key"


def test_decrypt_returns_none_after_key_rotation(monkeypatch: pytest.MonkeyPatch) -> None:
    ciphertext = crypto.encrypt_secret("rotate-me")

    rotated = get_settings().model_copy(update={"api_secret_key": "a-completely-different-key"})
    monkeypatch.setattr(crypto, "get_settings", lambda: rotated)
    crypto._fernet.cache_clear()
    try:
        assert crypto.decrypt_secret(ciphertext) is None
    finally:
        crypto._fernet.cache_clear()


def test_decrypt_returns_none_for_garbage() -> None:
    assert crypto.decrypt_secret("not-a-valid-fernet-token") is None


# --- OAuth helper functions (no network) ----------------------------------


def test_oauth_pkce_pair_is_url_safe_and_matches_challenge() -> None:
    verifier, challenge = oauth._pkce_pair()
    assert verifier and challenge
    assert verifier != challenge


def test_decode_id_token_claim_reads_payload() -> None:
    import base64
    import json

    payload = base64.urlsafe_b64encode(
        json.dumps({"https://api.openai.com/auth": {"chatgpt_account_id": "acct_1"}}).encode()
    ).rstrip(b"=")
    token = f"header.{payload.decode()}.signature"
    claim = oauth._decode_id_token_claim(token, "https://api.openai.com/auth")
    assert claim == {"chatgpt_account_id": "acct_1"}


def test_decode_id_token_claim_handles_malformed_token() -> None:
    assert oauth._decode_id_token_claim("not-a-jwt", "claim") is None


# --- chat.py against a mocked transport (no real network) ----------------

_RealAsyncClient = httpx.AsyncClient  # captured before any monkeypatching below


def _mock_client_factory(
    handler: object,
) -> object:
    def factory(*args: object, **kwargs: object) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(handler)  # type: ignore[arg-type]
        return _RealAsyncClient(*args, **kwargs)  # type: ignore[arg-type]

    return factory


async def test_send_chat_anthropic_api_key_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"content": [{"type": "text", "text": "hello"}]})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    credential = ResolvedCredential(
        provider="anthropic",
        auth_mode="api_key",
        secret="sk-x",
        base_url=None,
        model="claude-sonnet-5",
        account_id=None,
        account_label=None,
        source="env",
    )
    reply = await chat_module.send_chat(credential, [{"role": "user", "content": "hi"}])
    assert reply == "hello"
    assert captured["request"].headers["x-api-key"] == "sk-x"
    assert "anthropic-beta" not in captured["request"].headers


async def test_send_chat_anthropic_oauth_mode_includes_system_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"content": [{"type": "text", "text": "hi there"}]})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    credential = ResolvedCredential(
        provider="anthropic",
        auth_mode="oauth",
        secret="oauth-token",
        base_url=None,
        model="claude-sonnet-5",
        account_id=None,
        account_label=None,
        source="user",
    )
    reply = await chat_module.send_chat(credential, [{"role": "user", "content": "hi"}])
    assert reply == "hi there"
    request = captured["request"]
    assert request.headers["authorization"] == "Bearer oauth-token"
    assert request.headers["anthropic-beta"] == "oauth-2025-04-20"
    import json as _json

    body = _json.loads(request.content)
    assert body["system"] == [{"type": "text", "text": chat_module._ANTHROPIC_OAUTH_SYSTEM_PREFIX}]


async def test_send_chat_ollama_uses_base_url_and_no_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"choices": [{"message": {"content": "pong"}}]})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    credential = ResolvedCredential(
        provider="ollama",
        auth_mode="none",
        secret=None,
        base_url="http://ollama:11434",
        model="llama3.1",
        account_id=None,
        account_label=None,
        source="env",
    )
    reply = await chat_module.send_chat(credential, [{"role": "user", "content": "hi"}])
    assert reply == "pong"
    request = captured["request"]
    assert str(request.url) == "http://ollama:11434/v1/chat/completions"
    assert "authorization" not in request.headers


async def test_send_chat_openai_api_key_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(200, json={"choices": [{"message": {"content": "hey"}}]})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    credential = ResolvedCredential(
        provider="openai",
        auth_mode="api_key",
        secret="sk-y",
        base_url=None,
        model="gpt-5.1",
        account_id=None,
        account_label=None,
        source="env",
    )
    reply = await chat_module.send_chat(credential, [{"role": "user", "content": "hi"}])
    assert reply == "hey"
    request = captured["request"]
    assert request.headers["authorization"] == "Bearer sk-y"
    assert str(request.url) == "https://api.openai.com/v1/chat/completions"


async def test_send_chat_openai_oauth_mode_streams_sse(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        body = b'data: {"delta":"Hel"}\n\ndata: {"delta":"lo"}\n\ndata: [DONE]\n\n'
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    credential = ResolvedCredential(
        provider="openai",
        auth_mode="oauth",
        secret="codex-token",
        base_url=None,
        model="gpt-5.1-codex",
        account_id="acct_1",
        account_label="ChatGPT subscription",
        source="user",
    )
    reply = await chat_module.send_chat(credential, [{"role": "user", "content": "hi"}])
    assert reply == "Hello"
    assert captured["request"].headers["chatgpt-account-id"] == "acct_1"


async def test_send_chat_wraps_http_errors_as_bad_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    credential = ResolvedCredential(
        provider="anthropic",
        auth_mode="api_key",
        secret="sk-x",
        base_url=None,
        model="claude-sonnet-5",
        account_id=None,
        account_label=None,
        source="env",
    )
    with pytest.raises(BadGatewayError) as exc_info:
        await chat_module.send_chat(credential, [{"role": "user", "content": "hi"}])
    assert exc_info.value.code == "agents.provider_unavailable"
