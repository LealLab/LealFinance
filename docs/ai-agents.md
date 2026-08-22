# AI agents

AI agents are optional and disabled by default. The feature currently provides
provider setup and a non-streaming test chat; financial-data tools, MCP,
streaming, and conversation history are not implemented.

When enabled, provider management and chat are administrator-only. Disabled
instances return `agents.disabled` for `/api/v1/agents/*` and do not call a
provider.

## Enable the feature

The feature runs inside the `api` container. The `agents` Compose profile only
starts the optional Ollama container:

```dotenv
AGENTS_ENABLED=true
COMPOSE_PROFILES=agents
OLLAMA_BASE_URL=http://ollama:11434
```

`ollama` is a Compose hostname. Use the address of an external Ollama server
instead when it runs elsewhere.

## Providers

| Provider | Configuration |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` or an administrator-linked credential |
| OpenAI | `OPENAI_API_KEY` or an administrator-linked credential |
| Ollama | `OLLAMA_BASE_URL` or an administrator-linked URL |

Instance-wide `.env` credentials are used when no administrator-linked
credential exists. A linked credential takes precedence. Removing a linked
credential falls back to the `.env` value, if present.

Provider settings can also be managed from Administration -> AI providers.
Missing or unreadable credentials are treated as not configured rather than as
an application error.

## Subscription linking

Claude Pro/Max and ChatGPT Plus/Pro linking uses the OAuth clients and flows
used by the vendors' command-line tools. This is not a published, supported
third-party integration. Client IDs, endpoints, token formats, or vendor terms
may change without notice. API keys are the supported option.

The manual flow is:

1. Start linking from the Providers page.
2. Sign in and approve access in the provider's page.
3. Anthropic shows a code. OpenAI redirects to
   `http://localhost:1455/auth/callback`; the page failing to load is expected,
   so copy the full URL from the address bar.
4. Paste the code or URL back into the Providers page.

The backend checks the OAuth state when one is present. A stale or mismatched
state is rejected.

## Secret storage

Provider API keys and OAuth tokens must be read back to call a provider, so
they are encrypted with Fernet using a key derived from `API_SECRET_KEY`.
Provider secrets are never returned by the API.

Rotating `API_SECRET_KEY` invalidates sessions, invitations, and stored provider
credentials. Users must sign in again and relink providers.

See [`backend-api.md`](backend-api.md#ai-agents) for the endpoint list and
request/response contracts.
