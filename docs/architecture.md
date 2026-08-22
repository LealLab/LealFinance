# Architecture

## Services

| Service | Responsibility |
| --- | --- |
| `postgres` | Primary data store. |
| `redis` | Celery broker and result backend. |
| `api` | FastAPI application and database migrations. |
| `worker` | Background jobs, including recurring-rule posting. |
| `beat` | Schedules periodic jobs for `worker`. |
| `web` | Serves the Angular app and proxies `/api/` to `api`. |
| `ollama` | Optional local model runner behind the `agents` profile. |

`api`, `worker`, and `beat` use the same backend image with different commands.
The AI feature runs inside `api`; `ollama` is only the optional local provider.

## Request flow

```text
Browser -> web (:8080) -> static Angular files
                      -> /api/* -> api (:8000) -> postgres / redis
```

The homelab Compose file publishes only `web`. The development override also
publishes PostgreSQL and Redis so native tools can reach them through the host
ports in `.env`.

## Migrations

Only `api` runs `alembic upgrade head` on startup. `worker` and `beat` wait for
the API health check instead of racing to run migrations themselves. Native
development uses `task backend:migrate`; see
[`development.md`](development.md#migrations).

## Backend layout

```text
backend/app/
├── main.py                 # FastAPI app
├── dev.py                  # native dev entrypoint
├── core/                   # config, database, errors, security, crypto
├── api/                    # dependencies and HTTP routers
├── agents/                 # optional AI provider integration
├── models/                 # SQLAlchemy models and reusable money types
├── schemas/                # Pydantic request/response models
├── services/               # domain logic and ownership scoping
└── workers/                # Celery app and tasks
```

`app/core/db.py` provides the async FastAPI engine. Workers use their own
connection strategy so the worker process does not share the API's async pool.

On native Windows, use `task backend:dev`. Its entrypoint sets the required
asyncio policy before starting Uvicorn. Docker runs the standard Linux
container command.

## Identity and ownership

User-owned records carry one `user_id`. The shared `UserOwnedModel` and
`app/services/ownership.py` keep ownership filters consistent across services.
An id belonging to another user returns the same resource-specific `404` as an
unknown id, avoiding a cross-user enumeration signal.

Registration is invite-only after the first user. The first registration on an
empty database creates the administrator; admins then create one-time
invitations. Sessions use opaque cookies and a CSRF token, not JWTs.

## Frontend layout

```text
frontend/src/app/
├── core/         # HTTP client, auth, preferences, and Transloco
├── data/         # repository contracts and adapters
├── domain/       # models and pure calculations
├── features/     # route-level features
├── layout/       # navigation and language switching
└── shared/       # reusable UI, forms, pipes, and charts
```

The application uses HTTP-backed repositories. In-memory repositories remain
available as test doubles. The frontend maps camelCase domain models to the
backend's snake_case wire format.

Recurring rules are posted by the daily Celery task as real transactions. The
frontend's recurrence calculation only projects upcoming occurrences for
display; it is not the posting mechanism.

See [`backend-api.md`](backend-api.md), [`money-and-currency.md`](money-and-currency.md),
[`i18n.md`](i18n.md), and [`ai-agents.md`](ai-agents.md) for the detailed
contracts behind each area.
