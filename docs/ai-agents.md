# AI agents

Optional, off by default, gated by `AGENTS_ENABLED` (`.env`) plus the
public `GET /meta/settings` flag the frontend uses to hide the nav item
and redirect the route. When disabled, every `/api/v1/agents/*` route
404s as `agents.disabled` and no provider code path runs - see
`app/api/v1/agents.py`.

This covers the provider layer: linking credentials and one non-streaming
"try it" chat call to prove a provider answers. Agent tools over your
accounts/transactions/budgets, MCP, streaming chat, and conversation
history are not built yet.

## Where it runs

Unlike the `worker`/`beat` split, the agents feature runs in-process
inside `api` (`app/agents/`), not as a separate service - there's no
service-to-service auth to invent, and the code is a handful of `httpx`
calls, cheap to import even when unused. The `agents` Compose profile
still exists, but only for an optional local **Ollama** container -
useful if you want to run models on your own hardware instead of a paid
API key or subscription:

```bash
# .env
COMPOSE_PROFILES=agents
OLLAMA_BASE_URL=http://ollama:11434   # the in-container hostname, not localhost
```

## Providers

Three providers, configurable per-instance (`.env`) or per-user (the
Providers page, Settings → AI agents → Manage providers):

| Provider | Auth modes | Notes |
| --- | --- | --- |
| Anthropic (Claude) | API key, subscription (Claude Pro/Max) | `ANTHROPIC_API_KEY` |
| OpenAI (Codex) | API key, subscription (ChatGPT Plus/Pro) | `OPENAI_API_KEY` |
| Ollama | none | `OLLAMA_BASE_URL`, e.g. the bundled container above |

**Credential precedence** (`app/agents/credentials.py`): a user's own
linked credential always wins over the instance-wide `.env` key. Linking
a provider in the UI doesn't require an instance key to exist first, and
removing a linked credential falls back to the `.env` key (or to "not
configured" if there isn't one). A stored secret that fails to decrypt -
e.g. `API_SECRET_KEY` was rotated, see below - is treated as absent, not
an error: the caller sees "not configured" and can re-link.

No LLM SDKs are used. Each provider is one JSON request/response over
`httpx`; api-key mode for Ollama/OpenAI/Anthropic is a plain REST call,
subscription mode uses the same endpoints the official CLIs use (below).

## Subscription linking is unsanctioned

Linking a Claude Pro/Max or ChatGPT Plus/Pro subscription (rather than an
API key) works by using the same OAuth client the Claude Code / Codex CLI
use - it is **not** a published, supported third-party integration.
Consequences:

- It sits outside both vendors' consumer ToS.
- The client IDs, endpoints, and token formats (`app/agents/oauth.py`)
  can change without notice and stop working.
- If a subscription link breaks (expired refresh token, endpoint
  change), the provider falls back to any configured `.env` key rather
  than failing the request - but if there's no fallback, chat requests
  against that provider return `agents.not_configured` until you
  re-link or fall back to an API key.

If you'd rather not depend on this, use an API key instead - it's the
fully-supported path for both vendors.

### Linking flow (manual code paste)

The server runs in Docker, often behind a homelab reverse proxy with no
public callback URL, and both vendors' OAuth apps are pinned to their own
redirect URIs anyway (a console page for Anthropic, a fixed localhost
port for OpenAI) - so a server-hosted `/callback` route wouldn't work
even self-hosted on a fresh VPS. Instead:

1. The Providers page calls `POST /agents/providers/{provider}/oauth/start`
   and opens the returned `authorize_url` in a new tab.
2. You log in with your Anthropic/OpenAI account and approve access.
3. **Anthropic** displays a code directly on the page - copy the whole
   string (it's `<code>#<state>`).
   **OpenAI** redirects to `http://localhost:1455/auth/callback?code=...` -
   this page will fail to load (connection refused, expected), but the
   code is in the browser's address bar. Copy the full URL.
4. Paste what you copied back into the providers page, which calls
   `POST /agents/providers/{provider}/oauth/complete`. The backend
   accepts either a bare code or a full URL/`code#state` string.

There's no server-side session for this two-minute handshake - the PKCE
verifier and state from step 1 round-trip through your browser, not a
database row. For Anthropic, the state embedded in the pasted code is
checked against what step 1 issued; a mismatch means the paste is stale
or wrong and the link is rejected (`agents.oauth_state_mismatch`).

## Encryption at rest

Every other secret in this codebase is one-way (Argon2id passwords,
HMAC-peppered session tokens - see `app/core/security.py`). A provider
API key or OAuth token has to be read back to call the provider, so it's
the first reversible secret: `app/core/crypto.py` encrypts it with
Fernet, keyed by `API_SECRET_KEY` (via HKDF, not stored separately).
This means the same failure mode that already applies to sessions and
invitations now also applies here: **rotating `API_SECRET_KEY`
invalidates every stored provider credential** - users see "not
configured" and need to re-link.

No secret - encrypted or plaintext - is ever included in an API
response; the providers list only exposes whether a provider is
configured, its source (`user` or `env`), and a display label.

## API

See [`backend-api.md`](backend-api.md#ai-agents) for the full endpoint
list, request/response shapes, and error codes.
