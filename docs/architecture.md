# Architecture

## Services

| Service | What it does |
| --- | --- |
| `postgres` | Primary datastore. |
| `redis` | Celery broker + result backend. |
| `api` | FastAPI app. Runs Alembic migrations on startup (see below). |
| `worker` | Celery worker for background tasks. The scheduled exchange-rate refresh is currently disabled. |
| `beat` | Celery beat - schedules periodic tasks for `worker` to pick up. |
| `web` | nginx serving the built Angular SPA and proxying `/api/` to `api`. |
| `agents` | Optional, behind the `agents` Compose profile. Not yet implemented; see README.md. |

`api`, `worker`, and `beat` all build from the same backend image
(`backend/Dockerfile`) with different `command`s. They share one codebase, so
there's no drift between what the API validates and what a background task
assumes.

## Request flow

```txt
Browser → web (nginx, :8080) ─┬─> static files (Angular SPA)
                               └─> /api/* → api (FastAPI, :8000) → postgres / redis
```

When the base file is used for a homelab deployment
(`docker compose -f docker-compose.yml`), only `web`'s port is published to the
host; `api`, `postgres`, and `redis` are reachable only on the internal Compose
network. Plain `docker compose` also loads `docker-compose.override.yml`, which
is development-oriented and exposes `postgres`/`redis` on the host for local
`psql`/`redis-cli` access.

## Migrations

Only `api` runs `alembic upgrade head` on startup (`RUN_MIGRATIONS=true`, set
only on that service - see `backend/docker-entrypoint.sh`). `worker` and `beat`
wait on `api`'s healthcheck (`depends_on: condition: service_healthy`) rather
than each running migrations themselves, which would race against each other
on a fresh install.

## Backend layout

```text
backend/app/
├── main.py                 # FastAPI app factory
├── dev.py                  # local dev-server entrypoint (task backend:dev) - see "Windows dev server" below
├── core/                   # config, db engines (async + sync), logging, errors, security, cookies
├── api/
│   ├── deps.py              # DbSession, CurrentUser, AdminUser, CurrentSession
│   └── v1/                  # one router module per resource - see docs/backend-api.md
├── models/                 # SQLAlchemy models; types.py holds MoneyAmount/CurrencyCode/
│                            # ExchangeRateValue/PercentageValue; base.py's UserOwnedModel is
│                            # what every user-owned table subclasses
├── schemas/                # Pydantic DTOs (snake_case wire format, Decimals as strings)
├── services/                # business logic - one module per domain, plus ownership.py
│                            # (the single query-scoping helper every domain service uses)
└── workers/                 # Celery app + tasks
```

`app/core/db.py` (async engine, used by FastAPI) and `app/core/db_sync.py` (sync engine, used by Celery workers) are separate on purpose, Celery's worker model isn't async-native, and sharing an async engine across the two would be fragile.

### Windows dev server

`task backend:dev` runs `app/dev.py`, not the `uvicorn` CLI directly. On native
Windows, `uvicorn app.main:app` creates its event loop (Proactor, the asyncio
default) *before* importing the ASGI app string, so a Windows-selector-loop
patch inside `app/main.py` itself would run too late for psycopg's async
driver. `app/dev.py` sets the loop policy first, then calls `uvicorn.run()`
in-process, so the ordering is correct. This only matters for the native
host-run dev server; Docker/production run plain Linux containers, where
there's no Proactor/Selector distinction at all.

## Identity and ownership

Every table except `currencies`, `exchange_rates` (the provider rate cache),
and the identity tables themselves (`users`, `sessions`, `invitations`)
belongs to exactly one user. `app/models/base.py`'s `UserOwnedModel` declares
the `user_id` foreign key once, for every subclass, rather than repeating it
per model; `app/services/ownership.py` is the one place a `user_id` filter is
applied to a query (`get_owned`/`list_owned`/`get_many_owned`), and every
domain service goes through it. A cross-user id resolves to `404`, never
`403` - a `403` would confirm the id exists at all, which is an enumeration
oracle across other users' data.

Registration is invite-only (see `docs/backend-api.md` for the full flow),
except the very first user on an instance: while the `users` table is empty,
registering with no invitation token creates that user as the administrator.
Only an existing admin can invite anyone after that. Sessions are opaque HttpOnly
cookies (not JWTs); a per-session double-submit CSRF token is folded into the
same `CurrentUser` dependency that resolves the session, so no route can
forget to check it.

## Frontend layout

```text
frontend/src/app/
├── core/                     # HTTP client, auth/session, preferences, Transloco setup
├── data/                     # repository contracts plus HTTP and in-memory adapters
├── domain/                   # models and pure money, balance, budget, and report calculations
├── features/                 # route-level feature modules
│   ├── auth/ admin/ settings/
│   ├── dashboard/ accounts/ transactions/
│   └── categories/ budgets/ goals/ reports/ exchange/
├── layout/                   # app shell - nav + language switcher
└── shared/                   # reusable pipes, charts, forms, and UI components
```

Angular 22, zoneless, standalone components, signals.
See [`i18n.md`](i18n.md) for the Transloco setup and [`money-and-currency.md`](money-and-currency.md) for `MoneyPipe`.

## Frontend integration status

The application uses HTTP-backed repositories in
`frontend/src/app/app.config.ts`. The HTTP layer maps the frontend's camelCase
domain models to the backend's snake_case wire format. In-memory mock
repositories remain available as test doubles and are not the providers used by
the application configuration.

The backend domain schema and API are documented in
[`backend-api.md`](backend-api.md).

Recurring rules are projections only: there is no posting workflow that
turns a rule into real transactions, so occurrences are computed client-side
(`domain/calc/recurrence.ts`) and never affect balances, budgets, or reports.

The AI Agents feature (`AGENTS_ENABLED` + the `agents` Compose profile) is
still an unimplemented placeholder.
