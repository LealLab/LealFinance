# CLAUDE.md - LealFinance

Repository-specific conventions. Read [`docs/development.md`](docs/development.md)
for setup and [`CONTRIBUTING.md`](CONTRIBUTING.md) for checks and review flow.

## Stack

- Backend: Python 3.13, FastAPI, SQLAlchemy 2, Alembic, Celery, and Redis;
  dependencies use `uv`.
- Frontend: Angular 22, TypeScript 6.0, standalone zoneless components,
  Tailwind CSS 4, Transloco, and Vitest; dependencies use pnpm 11.22.0.
- Database: PostgreSQL.

## Commands

Prefer these Taskfile targets over raw `uv`, `pnpm`, or Compose commands.

| Task | Command |
| --- | --- |
| Backend lint + format | `task backend:lint` |
| Backend type check | `task backend:typecheck` |
| Backend tests | `task backend:test` |
| New migration | `task backend:migration -- "message"` |
| Apply migrations | `task backend:migrate` |
| Local demo data | `task backend:seed` |
| Frontend lint | `task frontend:lint` |
| Frontend tests | `task frontend:test` |
| Frontend build | `task frontend:build` |
| Translation keys | `task i18n:validate` |
| Full stack up | `task up` |

Migration changes must pass upgrade -> downgrade -> upgrade. Do not run
`task backend:migrate` and `task backend:test` against the same database
without resetting it between runs.

## Where code goes

- `backend/app/api/v1/` - thin routers: validate, delegate, return.
- `backend/app/services/` - domain logic; all user-scoped queries.
- `backend/app/models/` - SQLAlchemy; `backend/app/schemas/` - Pydantic.
- `backend/app/workers/` - Celery tasks, including recurring posting.
- `frontend/src/app/features/` - route-level components.
- `frontend/src/app/data/` - repository contracts plus `http/` and `mock/`
  adapters.
- `frontend/src/app/domain/` - models and pure calculations.
- `frontend/src/app/core/` - HTTP client, auth, preferences, Transloco.
- `frontend/src/app/shared/` - reusable UI, pipes, and charts.

See [`docs/architecture.md`](docs/architecture.md) for the full layout.

## Conventions

- Routers stay thin; business logic lives in `services/`. Declare literal
  routes before `/{id}` params (see `backend/app/api/v1/accounts.py`).
- Every user-owned query goes through `app/services/ownership.py`.
- Backend tests: `backend/tests/test_<domain>.py`, fixtures in `conftest.py`,
  builders in `factories.py`.
- Frontend tests: `*.spec.ts` colocated next to the file under test.
- Frontend talks to the API only through repositories in `data/`; components
  never call `api-client` directly.
- Domain models are camelCase; the HTTP adapters map to the backend's
  snake_case wire format.
- Angular components use sibling `templateUrl` and `styleUrl` files.

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
