# LealFinance

LealFinance is a self-hosted financial management platform, built with homelabs in mind.

## Stack

| Layer    | Stack                                            |
| -------- | ------------------------------------------------- |
| Backend  | FastAPI, SQLAlchemy 2, Alembic, Celery             |
| Frontend | Angular, TypeScript, Tailwind CSS, Transloco       |
| Database | PostgreSQL                                         |
| Queue    | Redis + Celery                                     |

## Localization

The UI ships in Brazilian Portuguese (`pt-BR`) first, built on Transloco so
additional languages are a config change, not a rewrite. See
[`docs/i18n.md`](docs/i18n.md).

## Currency

All monetary values are stored as `NUMERIC(19,4)` alongside an ISO 4217
currency code — see [`docs/money-and-currency.md`](docs/money-and-currency.md).
The platform starts with BRL only; multi-currency support (live exchange
rates, per-account currencies) is designed for but not yet enabled.

### Automatic currency conversion (optional)

For automatic currency conversion, add a free [Open Exchange
Rates](https://openexchangerates.org/signup/free) key to `.env`:

```bash
OPENEXCHANGERATES_APP_ID=your-app-id
```

Rates are fetched on-demand and cached for the day. Without a key, or if
the provider call fails, cross-currency amounts fall back to a 1:1 rate,
flagged so the UI can show a warning rather than use it silently.

## AI Agents (optional)

Self-hosted AI assistants over your LealFinance data — multi-provider
(OpenAI, Anthropic, Ollama, OpenAI-compatible), tool-use via MCP, per-agent
RAG knowledge base. Off by default; zero cost when off.

```bash
# in .env
AGENTS_ENABLED=true
COMPOSE_PROFILES=agents
```

```bash
docker compose up -d
```

Then configure a provider under Settings → AI Agents.

## Getting started

See [`docs/development.md`](docs/development.md) for local setup (backend,
frontend, and full-stack via Docker Compose) and
[`docs/homelab-deploy.md`](docs/homelab-deploy.md) for running this in a
homelab.

```bash
cp .env.example .env
docker compose up -d --build
```

The web UI is served on `http://localhost:${WEB_PORT}` (default `8080`),
proxying the API under `/api`.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — services, data flow, project layout
- [`docs/development.md`](docs/development.md) — local dev workflow
- [`docs/homelab-deploy.md`](docs/homelab-deploy.md) — self-hosting notes, backups
- [`docs/i18n.md`](docs/i18n.md) — translation workflow
- [`docs/money-and-currency.md`](docs/money-and-currency.md) — monetary data rules
