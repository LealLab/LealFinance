# Homelab deployment

LealFinance runs as one Docker Compose project. The core stack does not need
cloud services: PostgreSQL stores application data, Redis handles background
work, and the web container serves the UI and proxies API requests.

## Requirements

- A machine that can run Docker with the Compose plugin.
- A free host port for the web UI. The example configuration uses `8081`.
- Persistent storage for the PostgreSQL volume.

The commands below work from any checkout directory. Do not copy a host path
or container hostname into another machine's `.env` file.

## First deployment

```bash
git clone https://github.com/LealLab/LealFinance.git
cd LealFinance
cp .env.example .env
```

Edit `.env` and replace `POSTGRES_PASSWORD` and `API_SECRET_KEY`. Then use the
base Compose file explicitly:

```bash
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

Open `http://localhost:8081` from the same machine, or
`http://<host-ip>:8081` from another device on the LAN. If you change
`WEB_PORT`, use that port in the URL.

The first account created on an empty instance becomes the administrator.
After that, an administrator must invite other users.

The explicit base file is important: plain `docker compose up` also loads
`docker-compose.override.yml`, which is intended for development and publishes
PostgreSQL and Redis ports on the host.

## Local machine settings

Only the `web` service is published by the homelab stack. The API, PostgreSQL,
and Redis services use the internal Compose network:

| Use | Address |
| --- | --- |
| Browser on the host | `http://localhost:${WEB_PORT}` |
| Browser on another device | `http://<host-ip>:${WEB_PORT}` |
| API from another Compose service | `http://api:8000` |
| PostgreSQL from another Compose service | `postgres:5432` |
| Redis from another Compose service | `redis:6379` |

If the web port is already used, change `WEB_PORT` in `.env`. Database host
ports are only needed for native development; change `POSTGRES_HOST_PORT` or
`REDIS_HOST_PORT` when using the development override.

To keep multiple checkouts isolated, give each one a different Compose project
name:

```bash
docker compose -f docker-compose.yml -p lealfinance-prod up -d
```

## Status and logs

```bash
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs -f api
docker compose -f docker-compose.yml down
```

Do not use `down -v` unless you intend to remove the database volume.

## Backups

PostgreSQL is the source of truth. Redis is a task broker and result cache, so
it does not need a database backup.

```bash
# Backup
docker compose -f docker-compose.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql

# Restore into a fresh, empty database
docker compose -f docker-compose.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < backup.sql
```

Store `backup.sql` using the same backup system as the rest of the homelab.
Test restores before relying on them.

## Updates

Release tags are `v`-prefixed (`v1.2.3`, ...). Pinning an explicit tag in
`.env` is preferred over `TAG=latest` for a homelab that wants predictable,
deliberate updates.

Administrators see an in-app banner when a newer release than the running
instance is available, with a link to the exact update commands below - there
is no need to watch the repository for new tags. The check can be disabled
entirely, including for air-gapped or otherwise offline deployments that
don't want any outbound network calls, by setting `UPDATE_CHECK_ENABLED=false`
in `.env`.

Published images, once a release is available:

```bash
# Set TAG=<release>, e.g. TAG=v1.2.3, in .env first.
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The published-image workflow requires access to the project's container
registry. If it requires authentication, log in with a token that can read
packages before running `pull`:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin
```

See the [release workflow](../.github/workflows/release.yml) for the image
source.

When building from source instead:

```bash
git pull
docker compose -f docker-compose.yml up -d --build
```

The API container applies pending Alembic migrations on startup. Do not delete
the PostgreSQL volume during an update.

## Reverse proxy and TLS

The bundled `web` service provides HTTP only. For access beyond a trusted
local network, put an existing Caddy, Traefik, or nginx proxy in front of the
published web port and terminate TLS there.

## Optional AI providers

AI agents are disabled by default. They run in the API container; the
`agents` Compose profile only starts the optional Ollama container. See
[`ai-agents.md`](ai-agents.md) for provider settings and security caveats.
