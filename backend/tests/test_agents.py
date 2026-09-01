"""AI provider linking, credential precedence, OAuth PKCE state checking,
streaming provider adapters, ownership isolation, and secret handling.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.agents.credentials as credentials_module
import app.api.v1.agents as agents_router
import app.services.agent_providers as agent_providers_module
from app.agents import MCP_TOKEN_TTL_SECONDS, oauth
from app.agents import chat as chat_module
from app.agents.credentials import ResolvedCredential
from app.agents.events import TextDelta, ToolCall, Turn, TurnEnd
from app.agents.oauth import OAuthTokens
from app.core import crypto
from app.core.config import get_settings
from app.core.errors import BadGatewayError, ValidationAppError
from app.models.agent_credential import AgentCredential
from app.models.user import ROLE_ADMIN, ROLE_MEMBER
from tests.factories import login_as, make_user


async def _authed(
    client: AsyncClient,
    db_session: AsyncSession,
    email: str,
    role: str = ROLE_ADMIN,
) -> None:
    user, password = await make_user(db_session, email=email, role=role)
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


async def test_agents_routes_require_admin(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "member-agents@example.com", role=ROLE_MEMBER)

    response = await client.get("/api/v1/agents/providers")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "auth.admin_required"


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


async def test_link_model_only_update_preserves_api_key_auth(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "model-only-api-key@example.com")

    linked = await client.put("/api/v1/agents/providers/anthropic", json={"api_key": "sk-user-key"})
    assert linked.status_code == 200, linked.text

    changed = await client.put(
        "/api/v1/agents/providers/anthropic", json={"model": "claude-opus-5"}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["auth_mode"] == "api_key"
    assert changed.json()["model"] == "claude-opus-5"
    assert "sk-user-key" not in changed.text


async def test_link_model_only_update_preserves_oauth_tokens(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A model change on an OAuth-linked provider must not demand an API
    key or wipe the refresh token/account id - that was the bug that made
    picking a model impossible after a subscription link."""
    _enable_agents(monkeypatch)
    user, password = await make_user(
        db_session, email="model-only-oauth@example.com", role=ROLE_ADMIN
    )
    await login_as(client, email=user.email, password=password)

    row = AgentCredential(
        user_id=user.id,
        provider="anthropic",
        auth_mode="oauth",
        secret_ciphertext=crypto.encrypt_secret("access-token"),
        refresh_ciphertext=crypto.encrypt_secret("refresh-token"),
        account_id="acct_123",
        account_label="Claude subscription",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(row)
    await db_session.commit()

    response = await client.put(
        "/api/v1/agents/providers/anthropic", json={"model": "claude-opus-5"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["auth_mode"] == "oauth"
    assert body["account_label"] == row.account_label
    assert body["model"] == "claude-opus-5"

    await db_session.refresh(row)
    assert row.refresh_ciphertext is not None
    assert row.account_id == "acct_123"


async def test_link_model_only_update_without_existing_row_requires_api_key(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "model-only-no-row@example.com")

    response = await client.put(
        "/api/v1/agents/providers/anthropic", json={"model": "claude-opus-5"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.api_key_required"


async def test_list_providers_exposes_openai_catalog_and_reasoning_efforts(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "catalog@example.com")

    response = await client.get("/api/v1/agents/providers")
    assert response.status_code == 200
    by_provider = {row["provider"]: row for row in response.json()}

    openai = by_provider["openai"]
    assert openai["default_model"] == "gpt-5.6-luna"
    assert openai["models"] == ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"]
    assert openai["reasoning_efforts"] == ["low", "medium", "high", "xhigh"]

    ollama = by_provider["ollama"]
    assert ollama["reasoning_efforts"] == []


async def test_link_effort_only_update_preserves_oauth_tokens(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mirrors test_link_model_only_update_preserves_oauth_tokens - setting
    the reasoning effort alone must not demand an API key or wipe the
    refresh token/account id either."""
    _enable_agents(monkeypatch)
    user, password = await make_user(
        db_session, email="effort-only-oauth@example.com", role=ROLE_ADMIN
    )
    await login_as(client, email=user.email, password=password)

    row = AgentCredential(
        user_id=user.id,
        provider="openai",
        auth_mode="oauth",
        secret_ciphertext=crypto.encrypt_secret("access-token"),
        refresh_ciphertext=crypto.encrypt_secret("refresh-token"),
        model="gpt-5.6-luna",
        account_id="acct_123",
        account_label="ChatGPT subscription",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(row)
    await db_session.commit()

    response = await client.put("/api/v1/agents/providers/openai", json={"reasoning_effort": "low"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["auth_mode"] == "oauth"
    assert body["model"] == "gpt-5.6-luna"
    assert body["reasoning_effort"] == "low"

    await db_session.refresh(row)
    assert row.refresh_ciphertext is not None
    assert row.account_id == "acct_123"


async def test_link_model_change_resets_reasoning_effort_to_new_default(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "model-switch-effort@example.com")

    linked = await client.put(
        "/api/v1/agents/providers/openai",
        json={"api_key": "sk-user-key", "model": "gpt-5.6-luna", "reasoning_effort": "xhigh"},
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["reasoning_effort"] == "xhigh"

    switched = await client.put("/api/v1/agents/providers/openai", json={"model": "gpt-5.6-sol"})
    assert switched.status_code == 200, switched.text
    assert switched.json()["model"] == "gpt-5.6-sol"
    # sol's own default (medium), not luna's leftover xhigh.
    assert switched.json()["reasoning_effort"] == "medium"


async def test_link_rejects_out_of_range_reasoning_effort(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "bad-effort@example.com")

    response = await client.put(
        "/api/v1/agents/providers/openai",
        json={"api_key": "sk-user-key", "reasoning_effort": "extreme"},
    )
    assert response.status_code == 422


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


def test_split_code_bare_code() -> None:
    assert oauth._split_code("authcode") == ("authcode", None)


def test_split_code_hash_state() -> None:
    assert oauth._split_code("authcode#the-state") == ("authcode", "the-state")


def test_split_code_full_url_extracts_code_and_state() -> None:
    """The pasted string for OpenAI's dead-redirect page - previously sent
    verbatim as `code` to the token endpoint, which is exactly why linking
    OpenAI failed after a successful login."""
    pasted = "http://localhost:1455/auth/callback?code=ac_abc123&state=the-state"
    assert oauth._split_code(pasted) == ("ac_abc123", "the-state")


def test_split_code_full_url_without_state() -> None:
    pasted = "http://localhost:1455/auth/callback?code=ac_abc123"
    assert oauth._split_code(pasted) == ("ac_abc123", None)


async def test_oauth_complete_openai_full_localhost_url_extracts_bare_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pasting the whole dead-redirect URL (as docs/ai-agents.md and the
    pasteHintOpenai copy instruct) must reach OpenAI's token endpoint with
    a bare code, not the full URL string."""
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(
            200,
            json={
                "access_token": "chatgpt-access-token",
                "refresh_token": "chatgpt-refresh-token",
                "expires_in": 3600,
            },
        )

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    pasted = "http://localhost:1455/auth/callback?code=ac_abc123&state=the-state"
    tokens = await oauth.complete("openai", verifier="v", state="the-state", code=pasted)
    assert tokens.access_token == "chatgpt-access-token"

    import json as _json

    sent_body = _json.loads(captured["request"].content)
    assert sent_body["code"] == "ac_abc123"


async def test_oauth_complete_openai_full_url_state_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("token endpoint must not be called on a state mismatch")

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    pasted = "http://localhost:1455/auth/callback?code=ac_abc123&state=other-state"
    with pytest.raises(ValidationAppError) as excinfo:
        await oauth.complete("openai", verifier="v", state="the-state", code=pasted)
    assert excinfo.value.code == "agents.oauth_state_mismatch"


async def test_oauth_complete_openai_bare_code_still_accepted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The documented fallback (copy just the code, no state to check)
    still has to work - not every browser exposes a copyable address bar
    the same way."""
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return httpx.Response(
            200, json={"access_token": "chatgpt-access-token", "expires_in": 3600}
        )

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))

    tokens = await oauth.complete("openai", verifier="v", state="the-state", code="ac_abc123")
    assert tokens.access_token == "chatgpt-access-token"
    import json as _json

    assert _json.loads(captured["request"].content)["code"] == "ac_abc123"


async def test_provider_test_endpoint(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-test")
    await _authed(client, db_session, "provider-test@example.com")

    def ok_handler(_request: httpx.Request) -> httpx.Response:
        body = (
            b"event: content_block_delta\n"
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n'
            b"event: message_stop\n"
            b'data: {"type":"message_stop"}\n\n'
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(ok_handler))
    ok_response = await client.post("/api/v1/agents/providers/anthropic/test")
    assert ok_response.json() == {"ok": True, "error_code": None}

    def failing_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(failing_handler))
    failed_response = await client.post("/api/v1/agents/providers/anthropic/test")
    assert failed_response.json() == {"ok": False, "error_code": "agents.provider_unavailable"}

    not_configured = await client.post("/api/v1/agents/providers/openai/test")
    assert not_configured.json() == {"ok": False, "error_code": "agents.not_configured"}


# --- OAuth refresh precedence -------------------------------------------


async def test_expired_oauth_refresh_success_updates_row(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    user, password = await make_user(db_session, email="refresh-ok@example.com", role=ROLE_ADMIN)
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
    user, password = await make_user(db_session, email="refresh-fail@example.com", role=ROLE_ADMIN)
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


def test_mcp_token_round_trip() -> None:
    user_id = uuid4()
    token = crypto.mint_mcp_token(user_id)
    assert crypto.verify_mcp_token(token, max_age=MCP_TOKEN_TTL_SECONDS) == user_id


def test_verify_mcp_token_returns_none_for_invalid_tokens() -> None:
    token = crypto.mint_mcp_token(uuid4())
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")

    assert crypto.verify_mcp_token(tampered, max_age=MCP_TOKEN_TTL_SECONDS) is None
    assert crypto.verify_mcp_token("garbage", max_age=MCP_TOKEN_TTL_SECONDS) is None
    assert crypto.verify_mcp_token(token, max_age=-1) is None


def test_mcp_tokens_are_domain_separated_from_credentials() -> None:
    assert (
        crypto.verify_mcp_token(crypto.encrypt_secret("x"), max_age=MCP_TOKEN_TTL_SECONDS) is None
    )


async def test_create_mcp_token_for_ai_chat_member(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    user, password = await make_user(db_session, email="mcp-enabled@example.com", role=ROLE_MEMBER)
    user.ai_chat_enabled = True
    await db_session.commit()
    await login_as(client, email=user.email, password=password)

    response = await client.post("/api/v1/agents/mcp-token")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token"]
    assert body["expires_at"]
    assert crypto.verify_mcp_token(body["token"], max_age=MCP_TOKEN_TTL_SECONDS) == user.id


async def test_create_mcp_token_for_active_admin_without_ai_chat_flag(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "mcp-admin@example.com", role=ROLE_ADMIN)

    response = await client.post("/api/v1/agents/mcp-token")

    assert response.status_code == 200, response.text
    assert response.json()["token"]


async def test_create_mcp_token_requires_ai_chat_enabled_member(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_agents(monkeypatch)
    await _authed(client, db_session, "mcp-disabled-user@example.com", role=ROLE_MEMBER)

    response = await client.post("/api/v1/agents/mcp-token")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "agents.chat_not_allowed"


async def test_mcp_token_route_is_disabled_with_agents_flag(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "mcp-agents-disabled@example.com", role=ROLE_MEMBER)

    response = await client.post("/api/v1/agents/mcp-token")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "agents.disabled"


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


def _credential(
    provider: str,
    *,
    auth_mode: str = "api_key",
    secret: str | None = "test-secret",
    base_url: str | None = None,
    reasoning_effort: str | None = None,
) -> ResolvedCredential:
    return ResolvedCredential(
        provider=provider,
        auth_mode=auth_mode,
        secret=secret,
        base_url=base_url,
        model="claude-sonnet-5" if provider == "anthropic" else "gpt-5.6-luna",
        account_id="acct_1" if auth_mode == "oauth" else None,
        account_label="ChatGPT subscription" if auth_mode == "oauth" else None,
        source="user",
        reasoning_effort=reasoning_effort,
    )


async def test_stream_turn_anthropic_text(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        body = (
            b"event: content_block_delta\n"
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"He"}}\n\n'
            b"event: content_block_delta\n"
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"llo"}}\n\n'
            b"event: message_delta\n"
            b'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n'
            b"event: message_stop\n"
            b'data: {"type":"message_stop"}\n\n'
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    events = [
        event
        async for event in chat_module.stream_turn(
            _credential("anthropic"), "sys", [Turn(role="user", text="hi")], []
        )
    ]
    assert events == [TextDelta("He"), TextDelta("llo"), TurnEnd("end_turn")]


async def test_stream_turn_anthropic_tool_use(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        body = (
            b"event: content_block_start\n"
            b'data: {"type":"content_block_start","index":0,'
            b'"content_block":{"type":"tool_use","id":"call-1","name":"lookup"}}\n\n'
            b"event: content_block_delta\n"
            b'data: {"type":"content_block_delta","index":0,'
            b'"delta":{"type":"input_json_delta",'
            b'"partial_json":"{\\"city\\":\\"S"}}\n\n'
            b"event: content_block_delta\n"
            b'data: {"type":"content_block_delta","index":0,'
            b'"delta":{"type":"input_json_delta",'
            b'"partial_json":"eattle\\"}"}}\n\n'
            b"event: content_block_stop\n"
            b'data: {"type":"content_block_stop","index":0}\n\n'
            b"event: message_delta\n"
            b'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n'
            b"event: message_stop\n"
            b'data: {"type":"message_stop"}\n\n'
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    events = [
        event
        async for event in chat_module.stream_turn(
            _credential("anthropic"), "sys", [Turn(role="user", text="hi")], []
        )
    ]
    assert events == [ToolCall("call-1", "lookup", {"city": "Seattle"}), TurnEnd("tool_use")]


async def test_stream_turn_anthropic_request_shape_and_oauth_system(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        body = b'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    credential = _credential("anthropic", auth_mode="oauth", reasoning_effort="medium")
    [event async for event in chat_module.stream_turn(credential, "sys", [], [])]

    import json as _json

    request = captured["request"]
    body = _json.loads(request.content)
    assert body["thinking"] == {"type": "adaptive"}
    assert "budget_tokens" not in _json.dumps(body)
    assert body["output_config"] == {"effort": "medium"}
    assert body["max_tokens"] == 16000
    assert body["stream"] is True
    assert body["system"] == [
        {"type": "text", "text": chat_module._ANTHROPIC_OAUTH_SYSTEM_PREFIX},
        {"type": "text", "text": "sys"},
    ]
    assert request.headers["authorization"] == "Bearer test-secret"
    assert request.headers["anthropic-beta"] == "oauth-2025-04-20"


async def test_stream_turn_codex_text(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        body = (
            b'data: {"type":"response.output_text.delta","delta":"He"}\n\n'
            b'data: {"type":"response.output_text.delta","delta":"llo"}\n\n'
            b'data: {"type":"response.completed"}\n\n'
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    events = [
        event
        async for event in chat_module.stream_turn(
            _credential("openai", auth_mode="oauth"), "sys", [Turn(role="user", text="hi")], []
        )
    ]
    assert events == [TextDelta("He"), TextDelta("llo"), TurnEnd("end_turn")]


async def test_stream_turn_codex_tool_call(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        body = (
            b'data: {"type":"response.output_item.done","item":'
            b'{"type":"function_call","call_id":"call-2","name":"lookup",'
            b'"arguments":"{\\"city\\":\\"Seattle\\"}"}}\n\n'
            b'data: {"type":"response.completed"}\n\n'
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    events = [
        event
        async for event in chat_module.stream_turn(
            _credential("openai", auth_mode="oauth"), "sys", [Turn(role="user", text="hi")], []
        )
    ]
    assert events == [ToolCall("call-2", "lookup", {"city": "Seattle"}), TurnEnd("tool_use")]


async def test_stream_turn_codex_malformed_sse_is_bad_gateway(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=b"data: {not valid json\n\n", headers={"content-type": "text/event-stream"}
        )

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    with pytest.raises(BadGatewayError) as exc_info:
        [
            event
            async for event in chat_module.stream_turn(
                _credential("openai", auth_mode="oauth"), "sys", [Turn(role="user", text="hi")], []
            )
        ]
    assert exc_info.value.code == "agents.provider_unavailable"


async def test_stream_turn_ollama_text_and_end(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        body = (
            b'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n'
            b'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n'
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    events = [
        event
        async for event in chat_module.stream_turn(
            _credential("ollama", secret=None, base_url="http://ollama:11434"),
            "sys",
            [Turn(role="user", text="hi")],
            [],
        )
    ]
    assert events == [TextDelta("Hel"), TextDelta("lo"), TurnEnd("end_turn")]


async def test_stream_turn_ollama_tool_call(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        body = (
            b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
            b'"id":"call-3","function":{"name":"lookup",'
            b'"arguments":"{\\"city\\":\\"Seattle\\"}"}}]},'
            b'"finish_reason":"tool_calls"}]}\n\n'
        )
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    events = [
        event
        async for event in chat_module.stream_turn(
            _credential("ollama", secret=None, base_url="http://ollama:11434"),
            "sys",
            [Turn(role="user", text="hi")],
            [],
        )
    ]
    assert events == [ToolCall("call-3", "lookup", {"city": "Seattle"}), TurnEnd("tool_use")]


async def test_stream_turn_500_is_bad_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    with pytest.raises(BadGatewayError) as exc_info:
        [
            event
            async for event in chat_module.stream_turn(
                _credential("anthropic"), "sys", [Turn(role="user", text="hi")], []
            )
        ]
    assert exc_info.value.code == "agents.provider_unavailable"
