# CLAUDE.md — LealFinance

Project-specific conventions. Global instructions (pnpm, Angular
templateUrl/styleUrl siblings, commit/PR rules) still apply on top of this.

## Stack & pinned versions

- Backend: Python **3.13** (not 3.14 — Celery doesn't support 3.14 yet),
  FastAPI, SQLAlchemy 2, Alembic, Celery. Managed with **uv**, not poetry.
- Frontend: Angular 22, **TypeScript ~6.0.3** (pinned — `@angular/build`
  requires `>=6.0 <6.1`; do not let this drift to npm `latest`). Zoneless,
  standalone components, Vitest (not Karma/Jasmine). 2025 file-naming style
  guide: no `.component` suffix (`dashboard.ts` / `.html` / `.scss`, class
  `Dashboard`), but templateUrl/styleUrl always point at sibling files per
  the global Angular rule.
- Tailwind CSS 4, Transloco 8 for i18n.
- Database: PostgreSQL. Queue: Redis + Celery.

## Money

- Every monetary column is `NUMERIC(19,4)` paired with an ISO 4217 currency
  code column — never a bare amount. See `docs/money-and-currency.md`.
- Python side uses `Decimal` end-to-end. No floats for money, anywhere.
- The API serializes amounts as **JSON strings**, not numbers.
- Display rounding uses the currency's `decimal_digits`, never a hardcoded 2.

## i18n

- Backend returns machine-readable error codes (`account.insufficient_balance`),
  never translated strings. Translation happens only in the frontend.
- New user-facing strings always go through Transloco — no hardcoded text in
  templates. Run `task i18n:validate` before committing frontend changes.
- pt-BR strings run ~20-30% longer than English; don't build fixed-width UI.

## AI Agents

- Entire feature lives behind `AGENTS_ENABLED` + the `agents` Docker Compose
  profile. It must cost nothing when off — don't add code paths that touch
  the agents service unconditionally.

## Currency conversion

- `app/services/exchange_rates.py` (`get_exchange_rate`) is **on-demand**,
  not scheduled — called at request time, caches into `exchange_rates` for
  the day. The disabled Celery task in `app/workers/tasks/rates.py` is a
  separate, unrelated (and still unimplemented) idea; don't conflate them.
- No `OPENEXCHANGERATES_APP_ID` configured → 1:1 fallback, `is_fallback=True`.
  Never let a missing key or a provider failure raise — always fall back.
- Not yet called from anywhere real: there's no transaction-creation flow
  in this scaffold yet. It's called directly from
  `GET /api/v1/meta/exchange-rate` today, only as a way to exercise/expose
  it; wire it into transaction creation once that domain exists.

## Workflow

- Task runner: `Taskfile.yml` (`task backend:test`, `task frontend:lint`,
  etc.) — check it before reaching for raw `uv`/`pnpm`/`docker compose`
  invocations.
- Alembic migrations must round-trip: `alembic upgrade head` then
  `alembic downgrade base` then `alembic upgrade head` again, cleanly.
- No domain models (accounts, transactions, budgets, categories) exist yet
  as of the initial scaffold — only `currencies` and `exchange_rates`
  reference tables. Confirm with the user before assuming a schema.
