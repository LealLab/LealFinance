# AI agents

AI agents are optional and disabled by default (`AGENTS_ENABLED`). When enabled,
the feature is a streaming chat over the user's own financial data: the model
answers questions about accounts, transactions, categories, budgets, and
spending, and - after the user confirms each change - can create an institution,
account, or transaction, and create, rename, or delete category groups and
categories. Requests unrelated to personal finance or to this application are
refused.

Disabled instances return `agents.disabled` for every `/api/v1/agents/*` route
and never call a provider.

## Access

Provider linking (`/agents/providers/*`) stays administrator-only. Active
administrators always have chat access. Members are gated by `ai_chat_enabled`,
a flag an administrator sets from Administration -> Users
(`PATCH /auth/users/{id}`), off by default. The same rule governs the MCP
server, so clearing the flag revokes a member's access immediately - including
outstanding MCP tokens. An administrator's stored flag is preserved if they
are later demoted, at which point it governs their member access.

## Custom instructions

Each user can write their own instructions for the assistant from Settings.
The text is folded into the system prompt after the assistant's own rules,
which are restated around it: instructions refine tone, format, and level of
detail, and cannot grant abilities, change a tool, skip a write confirmation,
or lift the off-topic rule.

Because the text reaches the system prompt, it is classified before it is
stored. The user's own provider is asked to judge the candidate as data - not
as a message to answer - and only a bare `ALLOW` verdict saves it. Anything
else, including an unparseable answer, is refused as
`agents.instructions_rejected` and never written, with a one-line reason in
the user's language. Saving needs a reachable provider; clearing the field
does not. The value is excluded from backup export/restore, so a restore
cannot reinstate text without re-running the check.

## Import categorization

The transaction import page (`/transactions/import`) has an opt-in **AI Assist**
that is a one-shot structured call, not a conversation:
`POST /api/v1/agents/import/suggest` (`app/services/import_suggest.py`) sends the
still-uncategorized row descriptions - as data inside a `<rows>` block, never as
instructions - together with the user's own categories and groups, and asks the
model for a JSON array of per-row picks. It is gated by the same
`AGENTS_ENABLED` + `ai_chat_enabled` rules as chat, resolves the provider the
same way, and runs no tools. The response is validated server-side: a suggested
`category_id` must be one of the caller's own categories with a matching kind, a
new-category proposal must carry both a group and a category name, and anything
else is dropped. Nothing is written - the frontend applies each suggestion only
when the user accepts it, and creates any proposed groups/categories through the
normal category endpoints on an explicit "Create and assign".

## Tools

The model is given a fixed tool set (`backend/app/agents/tools.py`), each tool
delegating to an existing user-scoped service:

| Tool | Purpose |
| --- | --- |
| `list_accounts` | accounts with current balances |
| `list_institutions` | user's institutions |
| `list_categories` | categories, optionally filtered by kind; each carries its `group_name` |
| `list_category_groups` | category groups, optionally filtered by kind |
| `search_transactions` | filtered, paginated ledger search |
| `spend_by_category` | expense totals per category group (with `group_name`) over a date range |
| `monthly_totals` | income / expense / net per month |
| `budget_status` | budget vs. actual for a month, per category group (with `group_name`) |
| `list_card_invoices` | a credit-card account's past, current, and projected invoices |
| `create_transaction` | **write** - always shown to the user for confirmation first |
| `create_institution` | **write** - always shown to the user for confirmation first |
| `create_account` | **write** - always shown to the user for confirmation first |
| `create_category_group` | **write** - creates a group and, optionally, its categories in one call |
| `update_category_group` | **write** - rename or restyle a group (kind is fixed) |
| `delete_category_group` | **write** - fails while the group still has categories |
| `create_category` | **write** - creates a category in an existing group; kind comes from the group |
| `update_category` | **write** - rename, restyle, or move a category between groups of the same kind |
| `delete_category` | **write** - fails while a transaction or recurring rule references it |

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

The MCP server does **not** run the in-app confirmation flow: `spec.writes` is
not consulted there, so write tools (including the delete tools) execute as soon
as the client calls them. The confirmation is whatever tool-approval prompt the
external client shows. Every call still runs through the same user-scoped
service and is bounded to the token's user.
Individual tokens cannot be revoked; the levers are clearing `ai_chat_enabled`
for a member, deactivating the user, or rotating `API_SECRET_KEY`. Publishing
port 8001 (or adding an nginx location) to reach it from the host is an
operator decision.

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
provider and turns on `ai_chat_enabled` for each member who should have chat.

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
