# Homelab Deployment

LealFinance is designed to run as a single Docker Compose stack on a homelab
box, with no cloud dependencies or external services required.

## Basic deploy

```bash
git clone https://github.com/LealLab/LealFinance.git && cd LealFinance
cp .env.example .env
# Edit .env: at minimum change POSTGRES_PASSWORD and API_SECRET_KEY.
docker compose -f docker-compose.yml up -d --build
```

The web UI is served on `http://<host>:${WEB_PORT}`. The copied
`.env.example` sets `WEB_PORT=8081`; Compose falls back to `8080` only when the
variable is unset.

Use the explicit base file for homelab operation. Plain `docker compose up`
automatically merges `docker-compose.override.yml`, which is a development
override that enables API reload and publishes Postgres/Redis ports on the
host.

## Deploy from published images

By default `docker compose build` compiles the images locally from source.
Alternatively, pull pre-built images from GHCR - published manually via the
repo's [Release workflow](../.github/workflows/release.yml)
(`workflow_dispatch`, run from the Actions tab with a tag such as `1.2.3`).

The repository is **private**, so pulling requires authentication even for
read access. Create a [personal access token](https://github.com/settings/tokens)
with `read:packages` scope, then on the deploy host:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <your-github-username> --password-stdin
```

Then layer `docker-compose.prod.yml` on top of the base file, which swaps
`build:` for `image:` on every built service:

```bash
cp .env.example .env
# Edit .env: set TAG to the release you want (defaults to "latest").
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`docker-compose.yml`'s own `build:` keys are left in place, so nothing
about the base file needs to change to support this - `pull` only touches
what has an `image:`, and `up` only builds what doesn't.

## Running multiple Compose projects on one host

If you run more than one LealFinance checkout, or another Compose project that happens to reuse service names like `db`/`api`, set an explicit project name to keep them fully isolated:

```bash
docker compose -f docker-compose.yml -p lealfinance-prod up -d
# or: export COMPOSE_PROJECT_NAME=lealfinance-prod
```

Without this, two projects sharing a name can end up sharing a network and, worse,
a service defined under the same name in both files can be adopted or replaced
by whichever Compose command runs last. If you're ever unsure what a
`docker compose down -v` in a given directory would actually remove, run
`docker compose -f docker-compose.yml config` first; the resolved project,
volume, and network names are shown up front.

## Ports

If `${WEB_PORT}` collides with something else already running, change it in
`.env`. When using the development override, also change
`${POSTGRES_HOST_PORT}` or `${REDIS_HOST_PORT}` as needed. The base homelab
stack does not publish those database ports.

## Reverse proxy / TLS

`web` serves plain HTTP on its published port. For anything beyond local network access, put a reverse proxy (Caddy, Traefik, nginx-proxy-manager, whatever you already run) in front of it for TLS.
LealFinance doesn't bundle one, to stay agnostic about what homelab users already have.

## Backups

All state lives in two named volumes: the Postgres data directory and the Redis
data directory (`docker compose -f docker-compose.yml config` shows their
resolved names, see above).
Only Postgres needs backing up; Redis here is only a Celery broker/result cache, not a source of truth.

```bash
# Backup
docker compose -f docker-compose.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql

# Restore (into a fresh, empty database)
docker compose -f docker-compose.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < backup.sql
```

Automate this with cron + the above, or your homelab's existing backup tooling pointed at the named volume directly.

## Updating

Building from source:

```bash
git pull
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d
```

From published images (see above):

```bash
# Edit .env: bump TAG to the new release.
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The `api` container runs `alembic upgrade head` on startup before serving traffic (see [`architecture.md`](architecture.md#migrations)), so schema migrations apply automatically, no manual migration step needed on upgrade, either way.

## AI Agents (Planned, not implemented yet)

The `agents` service is gated behind the `agents` Compose profile and is off by
default. The current profile contains only a placeholder service; enabling it
does not provide an AI runtime yet.
