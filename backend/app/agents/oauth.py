"""PKCE OAuth for subscription-tier providers (Claude Pro/Max via
Anthropic, ChatGPT Plus/Pro via Codex).

Unsanctioned: these are the client IDs and endpoints the Claude Code and
Codex CLIs use, not a published third-party API. They sit outside both
vendors' consumer ToS and can change without notice - see
docs/ai-agents.md. That's a design constraint, not a blocker: every
caller here either raises an AppError with a machine-readable code or lets
an httpx error propagate for the caller to catch, and
app/agents/credentials.py always has the .env fallback to fall back to.

Flow (manual code paste): the server runs in Docker/behind a homelab
reverse proxy, so a vendor redirect to a server-hosted callback can't
reliably reach it. Both vendors' consumer OAuth apps are also pinned to
their own redirect URIs (a console page for Anthropic, a fixed localhost
port for OpenAI) - a third-party redirect isn't accepted regardless.

 1. `start(provider)` returns an authorize_url to open in the user's own
    browser, plus the PKCE verifier/state - there's no server-side
    session to stash them in for a two-minute handshake, so the frontend
    carries them and echoes them back to `complete`.
 2. The vendor authenticates the user and displays (Anthropic) or
    redirects to a dead localhost URL containing (OpenAI) an
    authorization code.
 3. `complete(provider, verifier=..., state=..., code=...)` exchanges it.
    `code` is whatever the user pasted back - a bare code, Anthropic's
    `code#state` display string, or the full URL from the address bar
    (needed for OpenAI's dead redirect, but accepted for either vendor) -
    `_split_code` below normalizes all three.
"""

import base64
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx

from app.core.errors import ValidationAppError
from app.models.agent_credential import PROVIDER_ANTHROPIC, PROVIDER_OPENAI

_TIMEOUT = httpx.Timeout(15.0)

ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
ANTHROPIC_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
ANTHROPIC_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
ANTHROPIC_SCOPES = "org:create_api_key user:profile user:inference"

OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token"
OPENAI_REDIRECT_URI = "http://localhost:1455/auth/callback"
OPENAI_SCOPES = "openid profile email offline_access"

OAUTH_PROVIDERS = (PROVIDER_ANTHROPIC, PROVIDER_OPENAI)


@dataclass(frozen=True)
class OAuthStart:
    authorize_url: str
    verifier: str
    state: str


@dataclass(frozen=True)
class OAuthTokens:
    access_token: str
    refresh_token: str | None
    expires_at: datetime
    account_id: str | None
    account_label: str | None


def _pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    return verifier, challenge


def start(provider: str) -> OAuthStart:
    if provider not in OAUTH_PROVIDERS:
        raise ValidationAppError(code="agents.oauth_unsupported")

    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(24)

    if provider == PROVIDER_ANTHROPIC:
        params = {
            "code": "true",
            "client_id": ANTHROPIC_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": ANTHROPIC_REDIRECT_URI,
            "scope": ANTHROPIC_SCOPES,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
        }
        url = f"{ANTHROPIC_AUTHORIZE_URL}?{httpx.QueryParams(params)}"
    else:
        params = {
            "client_id": OPENAI_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": OPENAI_REDIRECT_URI,
            "scope": OPENAI_SCOPES,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "state": state,
            "id_token_add_organizations": "true",
            "codex_cli_simplified_flow": "true",
        }
        url = f"{OPENAI_AUTHORIZE_URL}?{httpx.QueryParams(params)}"

    return OAuthStart(authorize_url=url, verifier=verifier, state=state)


def _decode_id_token_claim(id_token: str, claim: str) -> dict[str, object] | None:
    """Reads a claim out of the id_token payload without verifying the
    signature - it's our own token, received directly from the vendor's
    token endpoint over TLS a moment earlier, not user-supplied input."""
    try:
        payload_b64 = id_token.split(".")[1]
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except (IndexError, ValueError):
        return None
    value = payload.get(claim)
    return value if isinstance(value, dict) else None


def _tokens_from_response(provider: str, body: dict[str, object]) -> OAuthTokens:
    expires_in = body.get("expires_in", 3600)
    expires_at = datetime.now(UTC) + timedelta(
        seconds=expires_in if isinstance(expires_in, int) else 3600
    )
    account_id: str | None = None
    account_label: str | None = None
    if provider == PROVIDER_OPENAI:
        id_token = body.get("id_token")
        claim = (
            _decode_id_token_claim(id_token, "https://api.openai.com/auth")
            if isinstance(id_token, str)
            else None
        )
        raw_account_id = claim.get("chatgpt_account_id") if claim else None
        account_id = raw_account_id if isinstance(raw_account_id, str) else None
        account_label = "ChatGPT subscription"
    else:
        account_label = "Claude subscription"

    access_token = body["access_token"]
    refresh_token = body.get("refresh_token")
    assert isinstance(access_token, str)
    return OAuthTokens(
        access_token=access_token,
        refresh_token=refresh_token if isinstance(refresh_token, str) else None,
        expires_at=expires_at,
        account_id=account_id,
        account_label=account_label,
    )


def _split_code(pasted: str) -> tuple[str, str | None]:
    """Accepts whatever the user pasted: a bare code, the `code#state`
    string Anthropic's console displays, or the full redirect URL the
    browser lands on (OpenAI's dead localhost callback, or Anthropic's
    console callback pasted by mistake). Returns (code, state-or-None) -
    state is None only when nothing in the pasted text carried one."""
    pasted = pasted.strip()
    if pasted.startswith(("http://", "https://")):
        query = parse_qs(urlsplit(pasted).query)
        return query.get("code", [""])[0], (query.get("state") or [""])[0] or None
    auth_code, _, embedded_state = pasted.partition("#")
    return auth_code, embedded_state or None


async def complete(provider: str, *, verifier: str, state: str, code: str) -> OAuthTokens:
    """`code` is whatever the user pasted back - `_split_code` normalizes a
    bare code, `code#state`, or a full URL for either vendor. The embedded
    state, when present, is checked against what the frontend echoed from
    `start` - our only anti-CSRF check given the stateless (no server-side
    pending-flow record) design. Anthropic's console always displays a
    state, so it's required for that provider; OpenAI's dead-redirect URL
    carries one too when the user pastes the full address bar, but a bare
    code (no state to check) is still accepted since that's the flow the
    docs recommend as the fallback."""
    if provider not in OAUTH_PROVIDERS:
        raise ValidationAppError(code="agents.oauth_unsupported")

    auth_code, embedded_state = _split_code(code)
    if not auth_code:
        raise ValidationAppError(code="agents.oauth_failed")
    if provider == PROVIDER_ANTHROPIC and embedded_state is None:
        raise ValidationAppError(code="agents.oauth_state_mismatch")
    if embedded_state is not None and embedded_state != state:
        raise ValidationAppError(code="agents.oauth_state_mismatch")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        if provider == PROVIDER_ANTHROPIC:
            response = await client.post(
                ANTHROPIC_TOKEN_URL,
                json={
                    "grant_type": "authorization_code",
                    "code": auth_code,
                    "state": embedded_state,
                    "client_id": ANTHROPIC_CLIENT_ID,
                    "redirect_uri": ANTHROPIC_REDIRECT_URI,
                    "code_verifier": verifier,
                },
            )
        else:
            response = await client.post(
                OPENAI_TOKEN_URL,
                json={
                    "grant_type": "authorization_code",
                    "code": auth_code,
                    "client_id": OPENAI_CLIENT_ID,
                    "redirect_uri": OPENAI_REDIRECT_URI,
                    "code_verifier": verifier,
                },
            )
        response.raise_for_status()
        return _tokens_from_response(provider, response.json())


async def refresh(provider: str, refresh_token: str) -> OAuthTokens:
    """Raises httpx.HTTPStatusError on a rejected refresh token -
    app/agents/credentials.py catches this and falls back to the .env
    credential rather than letting a stale subscription link break chat."""
    if provider not in OAUTH_PROVIDERS:
        raise ValidationAppError(code="agents.oauth_unsupported")

    token_url = ANTHROPIC_TOKEN_URL if provider == PROVIDER_ANTHROPIC else OPENAI_TOKEN_URL
    client_id = ANTHROPIC_CLIENT_ID if provider == PROVIDER_ANTHROPIC else OPENAI_CLIENT_ID

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(
            token_url,
            json={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
            },
        )
        response.raise_for_status()
        body = response.json()
        tokens = _tokens_from_response(provider, body)
        if tokens.refresh_token is None:
            # Some refresh responses omit a rotated refresh_token, meaning
            # the original stays valid - carry it forward rather than
            # losing it.
            tokens = OAuthTokens(
                access_token=tokens.access_token,
                refresh_token=refresh_token,
                expires_at=tokens.expires_at,
                account_id=tokens.account_id,
                account_label=tokens.account_label,
            )
        return tokens
