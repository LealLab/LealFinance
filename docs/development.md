# Development

LealFinance has a Docker Compose stack and native development commands. Use
Docker for PostgreSQL and Redis, then run the API and frontend on the host for
the fastest edit-and-reload cycle.

## Requirements

- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- Node 24 and pnpm 11.22.0
- Docker with the Compose plugin
- [Task](https://taskfile.dev/) for the repository shortcuts

Run commands from the repository root. Copy the example environment file once:

```bash
cp .env.example .env
```

The values `POSTGRES_HOST_PORT` and `REDIS_HOST_PORT` control host access to
the development containers. Taskfile backend commands use those ports
automatically; no URL overrides are needed for the normal workflow.

## Native development

Start the infrastructure:

```bash
docker compose up -d postgres redis
```

In one terminal, install and start the backend:

```bash
task backend:sync
task backend:migrate
task backend:dev
```

The API listens on `http://127.0.0.1:8000`.

In another terminal, install and start the frontend:

```bash
task frontend:install
task frontend:dev
```

The frontend listens on `http://localhost:4200` and proxies `/api` to the
local API. The proxy target is `frontend/proxy.conf.json`; change it only when
the API runs somewhere else.

For raw `uv` commands outside the Taskfile, use host addresses rather than
Compose service names:

```dotenv
DATABASE_URL=postgresql+psycopg://lealfinance:change-me@localhost:55433/lealfinance
REDIS_URL=redis://localhost:6379/0
```

Change the ports if they conflict with another service on the machine.

## Full stack in Docker

To run the same containerized shape used for integration checks:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

The development override is loaded automatically. It enables API reload and
publishes PostgreSQL and Redis for host tools. The web UI is at
`http://localhost:${WEB_PORT}`; the example file uses `8081`.

Stop the stack with:

```bash
docker compose down
```

Use `docker compose down -v` only when you intentionally want a fresh database.

## Common tasks

| What | Command |
| --- | --- |
| Backend lint and format check | `task backend:lint` |
| Backend type check | `task backend:typecheck` |
| Backend tests | `task backend:test` |
| New migration | `task backend:migration -- "add accounts table"` |
| Seed demo data | `task backend:seed` |
| Frontend lint | `task frontend:lint` |
| Frontend tests | `task frontend:test` |
| Frontend production build | `task frontend:build` |
| Translation validation | `task i18n:validate` |
| Dependency security audit | `task security:audit` |

## Browser smoke test

The Playwright smoke test covers registration or login, account and category
creation, and adding a transaction. Run it against a disposable instance:

```bash
cd frontend
pnpm install
pnpm exec playwright install chromium
pnpm run e2e
```

By default it uses the native frontend at `http://127.0.0.1:4200` and its
proxied API. For the full Docker stack, use the published web port instead:

```bash
E2E_BASE_URL=http://127.0.0.1:8081 pnpm run e2e
```

Set `E2E_EMAIL` and `E2E_PASSWORD` when the instance already has a user. An
empty instance gets a generated smoke-test admin. The test leaves data behind,
so never run it against a shared or production database.

## Backend tests

Backend tests require real PostgreSQL and Redis. They build the test schema
from the ORM metadata and roll back test data after each test; there is no
SQLite fallback. The test command also enforces the 80% coverage threshold.

Do not run `task backend:migrate` and `task backend:test` against the same
database without a reset between them. Migrations leave committed seed data,
while the test fixture creates its own schema.

## First admin and demo data

On an empty database, register through the frontend without an invitation. The
first account becomes the administrator. Later users must be invited by an
administrator; invitations are delivered manually because there is no email
provider in v1. See [`backend-api.md`](backend-api.md) for the full flow.

To create local demo data:

```bash
task backend:seed
```

The task applies migrations and prompts for sensible defaults. The underlying
script also supports `uv run python -m scripts.seed -y` for non-interactive
setup. It recreates the demo user's data when run again.

## Migrations

Migration changes must round-trip cleanly:

```bash
uv run alembic upgrade head
uv run alembic downgrade base
uv run alembic upgrade head
```

CI runs this check. The API container applies pending migrations automatically
at startup; native development uses `task backend:migrate`.

## Money and translations

Read [`money-and-currency.md`](money-and-currency.md) before changing money or
exchange-rate behavior. Read [`i18n.md`](i18n.md) before adding user-facing
text. Both documents describe rules enforced by tests and CI.
