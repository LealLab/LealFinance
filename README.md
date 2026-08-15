<!-- markdownlint-disable-file MD033 MD041 -->
<p align="center">
  <img src="docs/images/logo.svg" width="200" alt="LealFinance" />
</p>
<h1 align="center">LealFinance</h1>
<p align="center">
  <a href="https://github.com/LealLab/LealFinance/actions/workflows/ci.yml"><img src="https://github.com/LealLab/LealFinance/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0-only" /></a>
</p>

<p align="center">
  A self-hosted personal finance platform built with homelabs in mind.
  It includes a Docker Compose stack, an English-first UI with Portuguese
  support, and multi-currency money handling.
</p>

## What it includes

- A FastAPI backend backed by PostgreSQL, Redis, Celery, and Alembic.
- An Angular frontend served by nginx in the containerized stack.
- Invite-only registration with a one-time first-admin bootstrap command.
- HTTP-backed frontend repositories with snake_case-to-camelCase mapping; the
  in-memory repositories remain available as test doubles.
- Exact decimal money storage and JSON-string serialization for monetary values.

## Quick Start

1. Install [Docker](https://www.docker.com).

2. Clone the repository

    ```bash
    git clone https://github.com/LealLab/LealFinance.git && cd LealFinance
    ```

3. Copy the .env.example to .env

    ```bash
    cp .env.example .env
    ```

    > Make sure to change `POSTGRES_PASSWORD` and `API_SECRET_KEY`.

4. Build and start the homelab stack

    ```bash
    docker compose -f docker-compose.yml up -d --build
    docker compose -f docker-compose.yml ps
    ```

    > Wait until api, web, postgres, and redis are healthy.

5. Create the first administrator account

    ```bash
    docker compose -f docker-compose.yml exec api python -m app.cli create-admin --email email@example.com --display-name "Your Name"
    ```

    > Enter a password of at least 12 characters when prompted. Never pass the password as a command argument.

6. Open <http://localhost:8081>. The copied `.env.example` sets `WEB_PORT=8081`;
   use the value in `.env` if you changed it.

> `docker compose up` automatically merges `docker-compose.override.yml`, which
> is intended for development and exposes Postgres/Redis on the host. Use the
> explicit base file above for a homelab deployment.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) - services, data flow, project layout
- [`docs/backend-api.md`](docs/backend-api.md) - endpoints, ownership, error codes, bootstrap
- [`docs/development.md`](docs/development.md) - local dev workflow
- [`docs/homelab-deploy.md`](docs/homelab-deploy.md) - self-hosting notes, backups
- [`docs/i18n.md`](docs/i18n.md) - translation workflow
- [`docs/money-and-currency.md`](docs/money-and-currency.md) - monetary data rules

## Project policies

- [`CONTRIBUTING.md`](CONTRIBUTING.md) - development checks and contribution flow
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) - community expectations
- [`SECURITY.md`](SECURITY.md) - vulnerability reporting
- [`SUPPORT.md`](SUPPORT.md) - questions, bugs, and feature requests
- [`LICENSE`](LICENSE) - GNU Affero General Public License, version 3 only
