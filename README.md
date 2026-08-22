<!-- markdownlint-disable-file MD033 MD041 -->
<p align="center">
  <img src="docs/images/logo.svg" width="200" alt="LealFinance" />
</p>
<h1 align="center">LealFinance</h1>
<p align="center">
  <a href="https://github.com/LealLab/LealFinance/actions/workflows/ci.yml"><img src="https://github.com/LealLab/LealFinance/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="docs/badges/coverage-backend.svg" alt="Backend coverage" />
  <img src="docs/badges/coverage-frontend.svg" alt="Frontend coverage" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0-only" /></a>
</p>

<p align="center">
  A self-hosted personal finance platform for homelabs and local development.
</p>

## Features

- Docker Compose deployment.
- Invite-only accounts with a first-admin bootstrap.
- Multi-currency support.
- AI providers and local Ollama support.

## Run it locally

Install [Docker](https://www.docker.com/) with the Compose plugin, then:

```bash
git clone https://github.com/LealLab/LealFinance.git
cd LealFinance
cp .env.example .env
```

Edit `.env` and replace at least `POSTGRES_PASSWORD` and `API_SECRET_KEY`.
Then start the homelab-style stack:

```bash
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

Open `http://localhost:8081` (or the value of `WEB_PORT`). The first account
created on an empty instance becomes the administrator.

The explicit `-f docker-compose.yml` keeps the development override from
publishing database ports. For native development, see
[`docs/development.md`](docs/development.md).

## Documentation

- [`docs/homelab-deploy.md`](docs/homelab-deploy.md) - deploy, update, back up, and expose the app safely
- [`docs/development.md`](docs/development.md) - local development and validation
- [`docs/architecture.md`](docs/architecture.md) - services and project layout
- [`docs/backend-api.md`](docs/backend-api.md) - API endpoints and contracts
- [`docs/ai-agents.md`](docs/ai-agents.md) - optional AI provider setup
- [`docs/i18n.md`](docs/i18n.md) - translation workflow
- [`docs/money-and-currency.md`](docs/money-and-currency.md) - money and exchange-rate rules

## Project policies

- [`CONTRIBUTING.md`](CONTRIBUTING.md) - contribution workflow and checks
- [`SECURITY.md`](SECURITY.md) - vulnerability reporting
- [`SUPPORT.md`](SUPPORT.md) - questions, bugs, and feature requests
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) - community expectations

## LICENSE

GNU Affero General Public License, version 3.
See [`LICENSE`](LICENSE) for more details
