# AI agents

AI agents are optional and disabled by default (`AGENTS_ENABLED`). When enabled,
the feature is a streaming chat over the user's own financial data: the model
answers questions about accounts, transactions, categories, budgets, and
spending, and can create an institution, account, or transaction after the user
confirms it. Requests unrelated to personal finance or to this application are
refused.

Disabled instances return `agents.disabled` for every `/api/v1/agents/*` route
and never call a provider.

## Access

Provider linking (`/agents/providers/*`) stays administrator-only. Chat is
per user and gated by `ai_chat_enabled`, a flag an administrator sets from
Administration -> Users (`PATCH /auth/users/{id}`), off by default. The same
flag governs the MCP server, so clearing it revokes a user's access
immediately - including outstanding MCP tokens.

## Tools

The model is given a fixed tool set (`backend/app/agents/tools.py`), each tool
delegating to an existing user-scoped service:

| Tool | Purpose |
| --- | --- |
| `list_accounts` | accounts with current balances |
| `list_institutions` | user's institutions |
| `list_categories` | categories, optionally filtered by kind |
| `search_transactions` | filtered, paginated ledger search |
| `spend_by_category` | expense totals per category group over a date range |
| `monthly_totals` | income / expense / net per month |
| `budget_status` | budget vs. actual for a month |
| `create_transaction` | **write** - always shown to the user for confirmation first |
| `create_institution` | **write** - always shown to the user for confirmation first |
| `create_account` | **write** - always shown to the user for confirmation first |

Read tools run automatically inside one turn (bounded at 8 iterations). A write
tool suspends the turn: the conversation goes to `awaiting_confirmation`, the
client shows the proposed values, and `/agents/conversations/{id}/confirm`
either runs the tool or records the rejection before the assistant continues.
A tool's own validation error (a missing category, a cross-user id) is fed back
to the model, which is how it asks the user for what it needs.

Conversations and every message - including tool calls and results - are
persisted (`agent_conversations`, `agent_messages`). Chat history is never
included in backup export/restore.

## MCP server

The `agents` Compose profile also starts a standalone MCP server
(`app/mcp/server.py`, port 8001, unpublished) exposing the same tool set to
external MCP clients such as Claude Desktop. It authenticates with a per-user
bearer token from `POST /api/v1/agents/mcp-token` - a Fernet value derived from
`API_SECRET_KEY` carrying only the user id, valid for one year, shown once.
Individual tokens cannot be revoked; the levers are clearing `ai_chat_enabled`,
deactivating the user, or rotating `API_SECRET_KEY`. Publishing port 8001 (or
adding an nginx location) to reach it from the host is an operator decision.

## Enable the feature

Chat runs inside the `api` container. The `agents` Compose profile starts two
optional containers: the MCP server (`mcp`, always) and Ollama (a local model
runner, only needed if you use it instead of a paid API):

```dotenv
AGENTS_ENABLED=true
COMPOSE_PROFILES=agents
OLLAMA_BASE_URL=http://ollama:11434
```

`ollama` is a Compose hostname. Use the address of an external Ollama server
instead when it runs elsewhere. After enabling, an administrator links a
provider and turns on `ai_chat_enabled` for each user who should have chat.

Ollama is supported for plain chat; its tool-calling is best-effort and not
relied on.

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

Rotating `API_SECRET_KEY` invalidates sessions, invitations, stored provider
credentials, and issued MCP tokens. Users must sign in again, relink providers,
and re-issue any MCP token.

See [`backend-api.md`](backend-api.md#ai-agents) for the endpoint list and
request/response contracts.
