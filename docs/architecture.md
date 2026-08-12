# Architecture

## Services

| Service    | What it does                                              |
| ---------- | ----------------------------------------------------------- |
| `postgres` | Primary datastore.                                           |
| `redis`    | Celery broker + result backend.                              |
| `api`      | FastAPI app. Runs Alembic migrations on startup (see below). |
| `worker`   | Celery worker — background tasks (e.g. exchange rate refresh, once enabled). |
| `beat`     | Celery beat — schedules periodic tasks for `worker` to pick up. |
| `web`      | nginx serving the built Angular SPA, proxying `/api/` to `api`. |
| `agents`   | Optional, behind the `agents` Compose profile. Not yet implemented — see README.md. |

`api`, `worker`, and `beat` all build from the same backend image
(`backend/Dockerfile`) with different `command`s — they share one codebase,
so there's no drift between what the API validates and what a background
task assumes.

## Request flow

```
Browser → web (nginx, :8080) ─┬─→ static files (Angular SPA)
                               └─→ /api/* → api (FastAPI, :8000) → postgres / redis
```

Only `web`'s port is published to the host in production
(`docker-compose.yml`); `api`, `postgres`, and `redis` are reachable only on
the internal Compose network. `docker-compose.override.yml` (applied
automatically in dev) additionally exposes `postgres`/`redis` on the host
for local `psql`/`redis-cli` access.

## Migrations

Only `api` runs `alembic upgrade head` on startup (`RUN_MIGRATIONS=true`,
set only on that service — see `backend/docker-entrypoint.sh`). `worker`
and `beat` wait on `api`'s healthcheck (`depends_on: condition:
service_healthy`) rather than each running migrations themselves, which
would race against each other on a fresh install.

## Backend layout

```
backend/app/
├── main.py              # FastAPI app factory
├── core/                 # config, db engines (async + sync), logging, errors
├── api/v1/                # routers — health, meta (currencies/settings)
├── models/                # SQLAlchemy models; types.py holds the MoneyAmount
│                           # column type every money-bearing model should reuse
├── schemas/                # Pydantic DTOs
├── services/               # empty — no domain logic yet (see below)
└── workers/                # Celery app + tasks
```

`app/core/db.py` (async engine, used by FastAPI) and `app/core/db_sync.py`
(sync engine, used by Celery workers) are separate on purpose — Celery's
worker model isn't async-native, and sharing an async engine across the two
would be fragile.

## Frontend layout

```
frontend/src/app/
├── core/                  # HTTP client, error interceptor, Transloco setup
├── layout/                 # app shell — nav + language switcher
├── features/dashboard/      # the one placeholder route
└── shared/pipes/             # MoneyPipe
```

Angular 22, zoneless, standalone components, signals. See
[`i18n.md`](i18n.md) for the Transloco setup and
[`money-and-currency.md`](money-and-currency.md) for `MoneyPipe`.

## What's not here yet

No domain models — no accounts, transactions, categories, or budgets. This
scaffold is deliberately just the skeleton: tooling, Docker topology,
migration baseline (`currencies` + `exchange_rates` only), i18n wiring, and
CI. The domain schema is a separate, future piece of work.
