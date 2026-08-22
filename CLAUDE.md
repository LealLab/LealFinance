# CLAUDE.md - LealFinance

Repository-specific conventions. Read [`docs/development.md`](docs/development.md)
for setup and [`CONTRIBUTING.md`](CONTRIBUTING.md) for checks and review flow.

## Stack

- Backend: Python 3.13, FastAPI, SQLAlchemy 2, Alembic, Celery, and Redis;
  dependencies use `uv`.
- Frontend: Angular 22, TypeScript 6.0, standalone zoneless components,
  Tailwind CSS 4, Transloco, and Vitest; dependencies use pnpm 11.22.0.
- Database: PostgreSQL.

## Money

- Store every monetary value as `NUMERIC(19,4)` with an ISO 4217 currency code.
- Use `Decimal` in Python. Never use floats for money calculations.
- Serialize amounts and rates as JSON strings.
- Display rounding comes from the currency's `decimal_digits`.

See [`docs/money-and-currency.md`](docs/money-and-currency.md).

## Internationalization

- Backend errors are machine-readable codes, never translated strings.
- New user-facing text must use Transloco; run `task i18n:validate`.
- Check new layouts with longer translations and a 320px viewport.

See [`docs/i18n.md`](docs/i18n.md).

## AI agents and secrets

- Agents run inside `api` and are disabled by `AGENTS_ENABLED`; the `agents`
  Compose profile only starts optional Ollama.
- Provider credentials are resolved in this order: user-linked credential,
  instance `.env` credential, then unavailable.
- Never return provider secrets. They are encrypted with a key derived from
  `API_SECRET_KEY`; rotating that key invalidates sessions, invitations, and
  stored provider credentials.

See [`docs/ai-agents.md`](docs/ai-agents.md).

## Application behavior

- The frontend uses HTTP-backed repositories in production. In-memory
  repositories are test doubles only.
- User-owned queries go through `app/services/ownership.py`; cross-user ids
  return resource-specific `404` responses.
- Recurring rules are posted by Celery as real transactions. Frontend
  recurrence calculations only project upcoming occurrences.
- Currency lookup is on demand: identity, user manual rate, inverse manual
  rate, today's provider cache, live provider, then flagged 1:1 fallback.

See [`docs/architecture.md`](docs/architecture.md) and
[`docs/backend-api.md`](docs/backend-api.md).

## Workflow

- Use the Taskfile before reaching for raw `uv`, `pnpm`, or Compose commands.
- Migration changes must pass upgrade -> downgrade -> upgrade.
- Do not run `task backend:migrate` and `task backend:test` against the same
  database without resetting it between runs.
- Angular components use sibling `templateUrl` and `styleUrl` files.
