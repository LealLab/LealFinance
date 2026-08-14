<!-- markdownlint-disable-file MD033 MD041 -->
<p align="center">
  <img src="docs/images/logo.svg" width="200" alt="LealFinance" />
</p>
<h1 align="center">LealFinance</h1>
<p align="center">
  <a href="https://github.com/LealLab/LealFinance/actions/workflows/ci.yml"><img src="https://github.com/LealLab/LealFinance/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
</p>

<p align="center">
  A self-hosted personal finance platform built with homelabs in mind.
  The current scaffold includes a Docker Compose stack, an English-first UI
  with Portuguese support, and multi-currency money handling.
</p>

## Quick Start

1. Install [Docker](https://www.docker.com).

2. Clone the repository and start the stack:

    ```bash
    git clone https://github.com/LealLab/LealFinance.git && cd LealFinance
    cp .env.example .env
    # Edit .env: at minimum change POSTGRES_PASSWORD and API_SECRET_KEY.
    docker compose up -d --build
    ```

3. Open `http://localhost:${WEB_PORT}` (default `8080`). The web container serves the UI and proxies the API under `/api`.

## Current status and roadmap

- [x] Docker Compose stack with FastAPI, Angular, PostgreSQL, and Redis
- [x] English (`en-US`) and Portuguese (`pt-BR`) UI with locale-aware formatting
- [x] Multi-currency-aware money and exchange-rate scaffolding
- [ ] Persist account, transaction, budget, and goal data through the backend API
- [ ] Replace the AI-agent Compose placeholder with a working runtime

## Stack

- **Backend** - FastAPI, SQLAlchemy 2, Alembic, Celery
- **Frontend** - Angular, TypeScript, Tailwind CSS, Transloco
- **Database** - PostgreSQL
- **Queue** - Redis + Celery

## Documentation

- [`docs/architecture.md`](docs/architecture.md) - services, data flow, project layout
- [`docs/development.md`](docs/development.md) - local dev workflow
- [`docs/homelab-deploy.md`](docs/homelab-deploy.md) - self-hosting notes, backups
- [`docs/i18n.md`](docs/i18n.md) - translation workflow
- [`docs/money-and-currency.md`](docs/money-and-currency.md) - monetary data rules
