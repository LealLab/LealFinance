# Development

## Prerequisites

- [uv](https://docs.astral.sh/uv/) (Python 3.13 - `uv sync` picks up the pinned version automatically from `.python-version`; do not use whatever `python3.14` you may have as default, Celery doesn't support 3.14 yet)
- [pnpm](https://pnpm.io/) + Node 24
- Docker + Docker Compose (for Postgres/Redis locally, or the full stack)

All commands below assume a task runner (`Taskfile.yml` - install from <https://taskfile.dev>, or run the underlying `uv`/`pnpm`/`docker compose` commands directly, shown in parentheses).

## Fastest path: infra in Docker, app on the host

This is the primary dev workflow - fastest iteration loop, since the backend/frontend run natively rather than through a container build.

```bash
cp .env.example .env
docker compose up -d postgres redis   # (or: task up, then stop api/worker/beat/web)

task backend:sync                     # uv sync
task backend:migrate                  # uv run alembic upgrade head
task backend:dev                      # uv run uvicorn app.main:app --reload

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

`docker-compose.override.yml` is applied automatically (no flag needed) and adds hot-reload for the API (`--reload`, source bind-mounted) plus exposes `postgres`/`redis` on the host. The web UI is at `http://localhost:${WEB_PORT}` (default `8080`).

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
| Frontend lint | `task frontend:lint` |
| Frontend tests | `task frontend:test` |
| Frontend build | `task frontend:build` |
| Check for missing/orphaned i18n keys | `task i18n:validate` |

## Running backend tests

Tests need a real Postgres reachable (no SQLite fallback - see `backend/tests/conftest.py`, which creates/tears down schema per test directly from the ORM metadata). `docker compose up -d postgres redis` is enough; point `DATABASE_URL`/`REDIS_URL` env vars at them if not using the defaults from `.env`.

## Migrations

Every migration should round-trip cleanly:

```bash
uv run alembic upgrade head
uv run alembic downgrade base
uv run alembic upgrade head
```

CI enforces this on every push (see `.github/workflows/ci.yml`).

## Money and i18n

Before touching anything that handles currency or adds user-facing text, read [`money-and-currency.md`](money-and-currency.md) and [`i18n.md`](i18n.md), both describe rules that are easy to violate by accident (hardcoded decimal places, hardcoded English strings, amounts serialized as JSON numbers) and hard to unwind later.
