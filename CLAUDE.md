# CLAUDE.md - LealFinance

Project-specific conventions. Global instructions (pnpm, Angular
templateUrl/styleUrl siblings, commit/PR rules) still apply on top of this.

## Stack & pinned versions

- Backend: Python **3.13** (not 3.14 - Celery doesn't support 3.14 yet),
  FastAPI, SQLAlchemy 2, Alembic, Celery. Managed with **uv**, not poetry.
- Frontend: Angular 22, **TypeScript ~6.0.3** (pinned - `@angular/build`
  requires `>=6.0 <6.1`; do not let this drift to npm `latest`). Zoneless,
  standalone components, Vitest (not Karma/Jasmine). 2025 file-naming style
  guide: no `.component` suffix (`dashboard.ts` / `.html` / `.scss`, class
  `Dashboard`), but templateUrl/styleUrl always point at sibling files per
  the global Angular rule.
- Tailwind CSS 4, Transloco 8 for i18n.
- Database: PostgreSQL. Queue: Redis + Celery.

## Money

- Every monetary column is `NUMERIC(19,4)` paired with an ISO 4217 currency
  code column - never a bare amount. See `docs/money-and-currency.md`.
- Python side uses `Decimal` end-to-end. No floats for money, anywhere.
- The API serializes amounts as **JSON strings**, not numbers.
- Display rounding uses the currency's `decimal_digits`, never a hardcoded 2.

## i18n

- Backend returns machine-readable error codes (`account.insufficient_balance`),
  never translated strings. Translation happens only in the frontend.
- New user-facing strings always go through Transloco - no hardcoded text in
  templates. Run `task i18n:validate` before committing frontend changes.
- pt-BR strings run ~20-30% longer than English; don't build fixed-width UI.

## AI Agents

- Runs in-process in `api` (`app/agents/`), gated by `AGENTS_ENABLED` -
  not a separate service. Every `/api/v1/agents/*` route 404s
  `agents.disabled` when off. The `agents` Compose profile only starts an
  optional local Ollama container. See `docs/ai-agents.md`.
- Three providers: Anthropic, OpenAI, Ollama. Credential precedence is a
  user's own linked row (`agent_credentials`, `app/agents/credentials.py`)
  over the instance-wide `.env` key over nothing - never raise on a
  missing/broken credential, resolve to `None`/fall through instead,
  matching `exchange_rates.py`'s degrade-don't-raise style.
- Subscription linking (Claude Pro/Max, ChatGPT Plus/Pro via
  `app/agents/oauth.py`) reuses the official CLIs' OAuth clients - it is
  unsanctioned, can break without notice, and must never be the reason a
  request 500s; a broken link falls back to the `.env` credential.
- No LLM SDKs (`anthropic`/`openai` packages) - provider calls are plain
  `httpx` JSON requests in `app/agents/chat.py`.
- Provider secrets are the only reversible-encrypted values in this
  codebase (`app/core/crypto.py`, Fernet keyed off `API_SECRET_KEY`) -
  everything else is one-way hashed. Never serialize a secret in an API
  response, encrypted or not.

## Currency conversion

- `app/services/exchange_rates.py` (`get_exchange_rate`) is **on-demand**,
  not scheduled - called at request time, caches into `exchange_rates` for
  the day. The disabled Celery task in `app/workers/tasks/rates.py` is a
  separate, unrelated (and still unimplemented) idea; don't conflate them.
- No `OPENEXCHANGERATES_APP_ID` configured → 1:1 fallback, `is_fallback=True`.
  Never let a missing key or a provider failure raise - always fall back.
- Precedence is identity → caller's manual rate → its inverse → cached
  provider rate → live provider fetch → 1:1 fallback. See
  `docs/money-and-currency.md` for the full rule and
  `docs/backend-api.md` for the endpoint.
- Called from transaction/recurring-rule creation (cross-currency
  conversion validation, `app/services/conversion.py`), from recurring
  rule posting (`app/services/recurring_posting.py` re-resolves a live
  rate per occurrence rather than replaying the template's frozen one),
  and from `GET /api/v1/meta/exchange-rate` (now authenticated - it
  consults the caller's own manual rates).

## Backend domain model

- All of it exists now: users/sessions/invitations, institutions, accounts,
  categories, budgets, budget allocations, expected income, transactions,
  recurring rules, manual rates, goals. See `docs/backend-api.md` for
  endpoints/ownership/error codes and `docs/architecture.md` for the
  identity/ownership pattern (`UserOwnedModel`,
  `app/services/ownership.py`).
- The frontend is wired to the real API (`app.config.ts` provides the
  `Http*Repository` classes) - `frontend/src/app/data/mock/` still exists
  and is exercised by unit tests, but is no longer what the running app
  uses.
- Recurring rules post for real: a Celery beat task
  (`app/workers/tasks/recurring.py`, via
  `app/services/recurring_posting.py`) materializes each rule's due
  occurrences as Transactions daily. `domain/calc/recurrence.ts` still
  projects *upcoming* occurrences client-side for display, but those are
  separate from what actually posts - never conflate the two.

## Workflow

- Task runner: `Taskfile.yml` (`task backend:test`, `task frontend:lint`,
  etc.) - check it before reaching for raw `uv`/`pnpm`/`docker compose`
  invocations.
- Alembic migrations must round-trip: `alembic upgrade head` then
  `alembic downgrade base` then `alembic upgrade head` again, cleanly.
- Don't run `task backend:migrate` and `task backend:test` back-to-back
  against the same database without a reset in between - see
  `docs/development.md`.
