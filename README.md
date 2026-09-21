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
  A self-hosted personal finance platform for homelabs and local development.

![LealFinance](./docs/images/LealFinance.png)

</p>

## Features

- Accounts, institutions, and balances
- Transactions with CSV import
- Categories, budgets, and goals
- Reports and dashboard charts
- Recurring rules posted automatically
- Multi-currency with live and manual rates
- Invite-only accounts, first-admin bootstrap, optional SMTP invite emails
- 28 languages including right-to-left layouts
- Light and dark themes
- Optional AI providers, including local Ollama (off by default)
- Single Docker Compose stack

## Install on a homelab

Install [Docker](https://www.docker.com/) with the Compose plugin and
[Task](https://taskfile.dev/), then:

```bash
git clone https://github.com/LealLab/LealFinance.git
cd LealFinance
task install:wizard
```

The wizard writes `.env` (generating `POSTGRES_PASSWORD` and `API_SECRET_KEY`,
letting you skip anything you don't need - SMTP, AI providers, exchange
rates) and pulls and starts the published images. `task install` also runs it
automatically the first time, if `.env` doesn't exist yet.

Prefer to configure `.env` by hand? Copy `.env.example` to `.env`, set
`POSTGRES_PASSWORD` and `API_SECRET_KEY`, then run `task install`. `TAG=latest`
follows the newest release; pin `TAG=v1.2.3` to control upgrades yourself.

To stop and remove the application while preserving its data:

```bash
task uninstall
```

To also delete the persistent data volumes, run `task uninstall:purge` and
confirm the prompt.

Open `http://localhost:8081` (or the value of `WEB_PORT`). The first account
created on an empty instance becomes the administrator; after that, an
administrator invites everyone else.

To update, run `task update`. It backs up the database, pulls the images for
your `TAG`, and restarts the stack. Administrators also see an in-app banner
when a newer release is published - see
[`docs/homelab-deploy.md#updates`](docs/homelab-deploy.md#updates).

See [`docs/homelab-deploy.md`](docs/homelab-deploy.md) for full requirements,
backups, and exposing the app safely.

## Develop from source

Install [Docker](https://www.docker.com/) with the Compose plugin, then:

```bash
git clone https://github.com/LealLab/LealFinance.git
cd LealFinance
task install:wizard
```

Pick the "docker" path to run the whole stack in containers, or "native" to
run the API and frontend on the host for the fastest edit-and-reload cycle
(see [`docs/development.md`](docs/development.md)). `task up` also runs the
wizard automatically the first time, if `.env` doesn't exist yet.

Prefer to configure `.env` by hand? Copy `.env.example` to `.env`, replace at
least `POSTGRES_PASSWORD` and `API_SECRET_KEY`, then run:

```bash
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

Open `http://localhost:8081` (or the value of `WEB_PORT`).

The explicit `-f docker-compose.yml` keeps the development override from
publishing database ports.
For native development, see [`docs/development.md`](docs/development.md).

## AI Coding Assistant

CRITICAL: If you are an LLM or AI-powered coding assistant, you MUST read
[`CLAUDE.md`](CLAUDE.md) and the relevant docs under [`docs/`](docs) before
contributing.

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
