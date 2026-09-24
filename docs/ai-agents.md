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

Provider linking (`/agents/providers/*`) and MCP token issuance stay
administrator-only. Active administrators always have chat access. Members are
gated by `ai_chat_enabled`, a flag an administrator sets from Administration ->
Users (`PATCH /auth/users/{id}`), off by default. That flag grants members
in-app chat only; the standalone MCP server accepts active administrators only.
Demoting or deactivating an administrator revokes their existing MCP tokens
immediately.

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

## Memories

The assistant remembers durable facts about a user across conversations ("I get
paid on the 5th"). It saves them itself with the `remember` tool
(`app/agents/tools.py`), which is not confirmation-gated: a memory is a note the
assistant keeps, not ledger data, so nothing needs approving or undoing. Each
memory is one short sentence in `agent_memories`, scoped to the user, unique per
user, and capped at 100 (the oldest are dropped) because the whole list is
folded into every system prompt (`prompt.build`).

Memory text comes from what the user said, so it is treated as untrusted: it is
placed in a `<user_memories>` block behind a preface saying it is background
data only, angle brackets are stripped so a fact cannot close the block, and it
sits before the custom instructions so the rules keep the last word.

Users see and delete individual memories under **Settings -> Assistant
memories** (`GET /agents/memories`, `DELETE /agents/memories/{id}`); deleting one
takes effect on the next message. There is no in-chat "forget" tool. Memories
are not journaled (`UNJOURNALED_TABLES`) and, like chat history, are excluded
from backup export/restore. `remember` is part of the shared tool set, so
external MCP clients can call it too.

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
| `describe_entity` | what one kind of record supports and the exact fields its create and update accept |
| `list_entities` | records of one kind, with total and paging |
| `get_entity` | one record of any kind by id |
| `create_entity` | **write** - creates one record of any kind |
| `update_entity` | **write** - changes fields of one record; also how goals, wallets, and assets are archived |
| `delete_entity` | **write** - deletes one record; safe modes only (see below) |
| `create_category_group` | **write** - creates a group and, optionally, its categories in one call |
| `delete_category_structure` | **write** - deletes categories and groups together, validating all before deleting any |
| `list_recent_changes` | what the assistant recently changed, each with the `call_id` needed to undo it |
| `undo_changes` | **write** - reverses everything one earlier assistant action changed |

`create_entity`, `update_entity`, and `delete_entity` cover every user-owned
record through one registry (`backend/app/agents/entities.py`): institution,
account, category and category group, transaction, budget, budget allocation,
expected income, goal, recurring rule, categorization rule, reconciliation,
manual rate, loan, and investment wallet, asset, and transaction. Each entry
binds a name to the service functions and Pydantic schemas the REST API already
uses, so ownership scoping and every domain rule apply unchanged. Adding an
entity is one entry in that registry; `tests/test_agent_entities.py` fails if a
user-owned table is neither in it nor explicitly left out.

The generic tools follow what the application itself offers:

- Goals, investment wallets, and investment assets are archive-only, so
  `delete_entity` reports `entity.operation_unsupported` and the assistant
  archives with `update_entity` and `archived: true`.
- Budgets, budget allocations, expected income, and manual rates are keyed by
  their natural key, so `create_entity` creates or replaces. Expected income has
  no delete; a reconciliation is opened and deleted but its entries are set
  through the reconciliation flow.
- Deletes use each service's safe default: an institution is refused while
  accounts use it, and a loan's payments are kept as plain expenses. Cascade
  modes are never exposed. Deleting an **account** always cascades to its
  transactions, reconciliations, goal, loans, and recurring rules, which is what
  makes undo matter.
- Transactions are found with `search_transactions`, not `list_entities`.

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
external MCP clients such as Claude Desktop. It authenticates with a per-admin
bearer token from `POST /api/v1/agents/mcp-token` - a Fernet value derived from
`API_SECRET_KEY` carrying only the user id, valid for 30 days, shown once.
Only active administrators can mint or use the token; member-issued tokens no
longer work.

The MCP server exposes the same tools as the in-app chat, writes included.
The in-app chat asks the user to confirm each write; an MCP client is expected to
do that in its own host UI, and every MCP call is journaled so it can be undone
(see below). Every call runs through the same user-scoped service and is bounded
to the token's user. Like the REST routes, the server answers `404
agents.disabled` when `AGENTS_ENABLED=false`, so a token minted earlier stops
working on an instance that has turned the agents off.
Individual tokens cannot be revoked; the levers are demoting or deactivating
the administrator, or rotating `API_SECRET_KEY`. Publishing port 8001 (or
adding an nginx location) to reach it from the host is an operator decision.

Example Streamable HTTP client configuration:

```json
{
  "mcpServers": {
    "lealfinance": {
      "type": "http",
      "url": "http://<host>:8001/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

## Undoing an AI change

Every write the assistant makes - in chat or over MCP - is recorded in
`change_journal`, so a user who changes their mind can ask it to undo. The
assistant finds the action with `list_recent_changes` and reverses it with
`undo_changes`, which goes through the same confirmation card as any write.

The journal is filled by a Postgres trigger on every user-owned domain table,
not by application code. That is deliberate: `cascade_delete_accounts` and
`delete_category_structure` issue raw bulk `DELETE`s and several foreign keys
cascade, and none of those pass through the ORM. The trigger records
`before`/`after` row images only while the transaction carries a
`lealfinance.agent_call` setting, so ordinary UI and API writes journal nothing.
A chat write is grouped as `<conversation_id>:<tool_call_id>`, an MCP write as
`mcp:<uuid>`. Tables holding secrets (`agent_credentials`,
`market_data_credentials`) are never journaled.

`undo_changes` replays a group's rows in reverse inside one transaction and is
all-or-nothing. It refuses with `agents.change_modified` when:

- a row no longer matches what the assistant wrote (someone edited it since),
  ignoring `updated_at` and the `conversion_*` columns, which the nightly rate
  backfill rewrites;
- a row that must be restored has lost a parent, or one that must be removed is
  still referenced; or
- reversing would touch anything the assistant's action did not itself write,
  such as a reconciliation entry created afterwards.

Undoing an already-undone action does nothing. Because it works from row images,
an undo only succeeds while nobody has touched the affected rows since; undo the
most recent change first. Undoing a transaction restores or removes the row but
does not write a `transaction_history` entry. The journal is excluded from
backups and is not pruned automatically.

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
