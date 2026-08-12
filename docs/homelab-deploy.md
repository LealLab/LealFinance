# Homelab Deployment

LealFinance is designed to run as a single `docker compose up -d` on a
homelab box — no cloud dependencies, no external services required.

## Basic deploy

```bash
git clone <this repo> lealfinance && cd lealfinance
cp .env.example .env
# Edit .env: at minimum change POSTGRES_PASSWORD and API_SECRET_KEY.
docker compose up -d --build
```

The web UI is served on `http://<host>:${WEB_PORT}` (default `8080`).

## Running multiple Compose projects on one host

Compose namespaces containers, networks, and volumes by **project name**
(the directory name by default, or an explicit `name:` in the compose
file). If you run more than one LealFinance checkout, or another Compose
project that happens to reuse service names like `db`/`api`, set an
explicit project name to keep them fully isolated:

```bash
docker compose -p lealfinance-prod up -d
# or: export COMPOSE_PROJECT_NAME=lealfinance-prod
```

Without this, two projects sharing a name can end up sharing a network and,
worse, a service defined under the same name in both files can be adopted
or replaced by whichever `docker compose up` runs last. If you're ever
unsure what a `docker compose down -v` in a given directory would actually
remove, run `docker compose config` first — the `name:`, resolved volume
names, and resolved network name are all shown up front.

## Ports

If `${WEB_PORT}` (or, in dev, `${POSTGRES_HOST_PORT}` / `${REDIS_HOST_PORT}`
from `docker-compose.override.yml`) collides with something else already
running, change it in `.env` — nothing else needs to change.

## Reverse proxy / TLS

`web` serves plain HTTP on its published port. For anything beyond local
network access, put a reverse proxy (Caddy, Traefik, nginx-proxy-manager —
whatever you already run) in front of it for TLS. LealFinance doesn't
bundle one, to stay agnostic about what homelab users already have.

## Backups

All state lives in two named volumes: the Postgres data directory and the
Redis data directory (`docker compose config` shows their resolved names —
see above). Only Postgres needs backing up; Redis here is only a Celery
broker/result cache, not a source of truth.

```bash
# Backup
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql

# Restore (into a fresh, empty database)
docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" < backup.sql
```

Automate this with cron + the above, or your homelab's existing backup
tooling pointed at the named volume directly.

## Updating

```bash
git pull
docker compose build
docker compose up -d
```

The `api` container runs `alembic upgrade head` on startup before serving
traffic (see [`architecture.md`](architecture.md#migrations)), so schema
migrations apply automatically — no manual migration step needed on
upgrade.

## AI Agents

Off by default, zero cost when off (the `agents` service is gated behind
the `agents` Compose profile — it isn't even created unless you opt in):

```bash
# in .env
AGENTS_ENABLED=true
COMPOSE_PROFILES=agents
```

```bash
docker compose up -d
```

Not yet implemented in this scaffold — see the root `README.md`.
