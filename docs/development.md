# Development

## Prerequisites

- [uv](https://docs.astral.sh/uv/) with Python 3.13 (the backend requires
  `>=3.13,<3.14`; do not use Python 3.14)
- [pnpm](https://pnpm.io/) 11.13.0 + Node 24
- Docker + Docker Compose (for Postgres/Redis locally, or the full stack)

All commands below assume a task runner (`Taskfile.yml` - install from <https://taskfile.dev>, or run the underlying `uv`/`pnpm`/`docker compose` commands directly, shown in parentheses).

## Fastest path: infra in Docker, app on the host

This is the primary dev workflow - fastest iteration loop, since the backend/frontend run natively rather than through a container build.

```bash
cp .env.example .env
docker compose up -d postgres redis   # (or: task up, then stop api/worker/beat/web)

task backend:sync                     # uv sync
task backend:migrate                  # uv run alembic upgrade head
task backend:dev                      # uv run python -m app.dev

task frontend:install                 # pnpm install
task frontend:dev                     # pnpm start (ng serve)
```

The frontend dev server does not proxy API requests by default. Point it at the
API directly, or use the full Docker stack below if you want the nginx-proxied
setup exactly as it runs in production.

## Full stack via Docker Compose

```bash
cp .env.example .env
docker compose up -d --build           # (or: task up)
```

`docker-compose.override.yml` is applied automatically (no flag needed) and adds
hot-reload for the API (`--reload`, source bind-mounted) plus exposes
`postgres`/`redis` on the host. The web UI is at `http://localhost:${WEB_PORT}`;
the copied `.env.example` uses `8081`, while Compose falls back to `8080` when
`WEB_PORT` is unset.

If port 8080 or 5432 is already taken on your machine (e.g. by another Compose project), override `WEB_PORT` / `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` in `.env` - see the comments there.

```bash
docker compose ps                      # all services should show (healthy)
docker compose logs -f api             # (or: task logs)
docker compose down                    # stop
docker compose down -v                 # stop + wipe data (fresh start)
```

## Common tasks

| What | Command |
| --- | --- |
| Backend lint + format check | `task backend:lint` |
| Backend type check | `task backend:typecheck` |
| Backend tests | `task backend:test` |
| New migration | `task backend:migration -- "add accounts table"` |
| Seed local demo data | `task backend:seed` |
| Frontend lint | `task frontend:lint` |
| Frontend tests | `task frontend:test` |
| Frontend build | `task frontend:build` |
| Check for missing/orphaned i18n keys | `task i18n:validate` |
| Dependency security audit | `task security:audit` |

## Running backend tests

Tests need a real Postgres reachable (no SQLite fallback - see
`backend/tests/conftest.py`, which builds the schema once per test session
directly from the ORM metadata, then isolates each test in a transaction that's
rolled back at teardown). `docker compose up -d postgres redis` is enough.

`.env`'s `POSTGRES_HOST=postgres`/`REDIS_HOST=redis` values resolve inside the
Compose network. Anything run natively on the host (`task backend:migrate`,
`backend:test`, `backend:dev`) must use host endpoints instead. After
starting `postgres` and `redis`, set these values in `.env` (or in the shell
environment), adjusting ports if you changed the host mappings:

```dotenv
DATABASE_URL=postgresql+psycopg://lealfinance:change-me@localhost:55433/lealfinance
REDIS_URL=redis://localhost:6379/0
```

Don't run `task backend:migrate` and `task backend:test` back-to-back against the same database without a reset in between: migrations leave committed data behind (the seeded currencies, any account you registered), while `backend:test` builds and seeds its own schema from ORM metadata on top of whatever's already there - the two collide (e.g. a duplicate-key error re-inserting BRL). `backend:test`'s teardown always leaves the database empty afterward, so tests will pass again immediately if you just rerun them; if you want to poke around manually with `backend:migrate`/`backend:dev`, do that *after* your last test run, not interleaved with it.

`task backend:test` also enforces a minimum coverage of 80% (`--cov-fail-under=80` in `pyproject.toml`) and writes `coverage.json`, read by CI to update the coverage badge. `[tool.coverage.run]` sets `concurrency = ["greenlet"]` - without it, coverage.py's tracer loses line tracking after every `await db.execute(...)`/`await db.commit()` (SQLAlchemy's async engine suspends through a greenlet), undercounting real coverage by ~20 points.

## Bootstrapping the first admin

Registration is invite-only, with one exception: while the instance has no
users at all, `POST /api/v1/auth/register` accepts a request with no
invitation token and creates that user as the administrator. In practice,
just open the frontend and register - the first account created becomes the
admin.

Once an admin exists, they issue invitations (`POST /api/v1/auth/invitations`)
for everyone else; the response includes the raw invitation token exactly
once, for out-of-band delivery (there's no email provider in v1). See
[`docs/backend-api.md`](backend-api.md) for the full auth flow, endpoint
list, and error codes.

## Seeding local demo data

`task backend:seed` (run after `task backend:migrate`, since every currency
column is a real FK) builds one plausible dev user - institutions, accounts,
categories, a year of transactions, budgets, a recurring rule history, and a
goal - so you have something to look at without hand-creating it through the
UI. It's interactive by default, prompting for each value (date range,
transaction volume, currencies, RNG seed) with a sensible default shown, so
pressing Enter through every prompt is enough. Pass `-y` to accept every
default without prompting:

```bash
task backend:seed                              # (or: uv run python -m scripts.seed)
uv run python -m scripts.seed -y                # non-interactive, all defaults
```

Re-running it wipes and rebuilds the same email's data (FK CASCADE removes
everything that user owns), and is deterministic for a given RNG seed - the
same answers always produce the same database. The script prints the login
email/password when it finishes.

## Migrations

Every migration should round-trip cleanly:

```bash
uv run alembic upgrade head
uv run alembic downgrade base
uv run alembic upgrade head
```

CI enforces this on every push (see [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

## Money and i18n

Before touching anything that handles currency or adds user-facing text, read [`money-and-currency.md`](money-and-currency.md) and [`i18n.md`](i18n.md), both describe rules that are easy to violate by accident (hardcoded decimal places, hardcoded English strings, amounts serialized as JSON numbers) and hard to unwind later.
