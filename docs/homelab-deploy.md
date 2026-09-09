# Homelab deployment

LealFinance runs as one Docker Compose project. The core stack does not need
cloud services: PostgreSQL stores application data, Redis handles background
work, and the web container serves the UI and proxies API requests.

## Requirements

- A machine that can run Docker with the Compose plugin.
- [Task](https://taskfile.dev/) if using the repository shortcuts below.
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

Edit `.env`:

- set `ENVIRONMENT=production`;
- replace `POSTGRES_PASSWORD` and `API_SECRET_KEY` with strong random values;
- set `TAG` to a released version, for example `TAG=v1.2.3`;
- set `LF_SITE_ADDRESS` and `APP_BASE_URL` to the HTTPS URL the app will be
  reached at (see [HTTPS](#https) below);
- set `WEB_PORT=127.0.0.1:8081` so the plain-HTTP port stays on the host and
  only the TLS proxy is reachable from other devices.

`ENVIRONMENT=production` makes the session and CSRF cookies `Secure` and
enables the guard that refuses the placeholder secrets above. Browsers only
send a `Secure` cookie back over HTTPS - with one exception, `http://localhost`
on the host itself. So reaching the app from any other device needs HTTPS.
This is not optional for real use: over plain HTTP to `http://<host-ip>:8081`
a production instance accepts your login and then drops the session on the
next request.

### HTTPS

The bundled `web` container serves plain HTTP only. `docker-compose.tls.yml`
adds a [Caddy](https://caddyserver.com/) container that terminates TLS in
front of it.

1. Point a DNS name at the host - a public record, or a LAN DNS / hosts entry.
2. Set `LF_SITE_ADDRESS` and `APP_BASE_URL` in `.env` to that name
   (`APP_BASE_URL` with the `https://` scheme, `LF_SITE_ADDRESS` without).
3. If the name is publicly resolvable with port 443 reachable, Caddy obtains
   and renews a Let's Encrypt certificate automatically. For a LAN-only name,
   uncomment `tls internal` in `docker/caddy/Caddyfile` and trust Caddy's
   local CA root on every device that will open the app (the path is in that
   file's comments).

Start the stack with the TLS overlay:

```bash
task install:tls
```

which is:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  -f docker-compose.tls.yml up -d
```

Open `https://<LF_SITE_ADDRESS>`. The first account created on an empty
instance becomes the administrator; after that an administrator invites
everyone else.

Passkey sign-in (Settings -> Passkeys) needs a secure context and starts
working as soon as the app is served over HTTPS - no extra configuration.

### Without HTTPS (same host only)

For a quick trial you can skip the proxy: keep `WEB_PORT=8081`, set
`ENVIRONMENT=development`, run `task install`, and open
`http://localhost:8081` **from the host itself**. Another device on
`http://<host-ip>:8081` will not stay logged in. `development` also disables
the placeholder-secret guard, so do not keep real financial data in this
configuration.

## Develop / customize

To develop or customize the application, build from source with the base
Compose file explicitly:

```bash
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml ps
```

## Task shortcuts

From a checkout with a configured `.env`, `task install` pulls and starts the
published production images using the `TAG` value; `task install:tls` does the
same with the Caddy TLS proxy in front (see [HTTPS](#https)). To stop and
remove the containers while preserving data, run:

```bash
task uninstall
```

To also delete the persistent PostgreSQL, Redis, and Ollama volumes, run:

```bash
task uninstall:purge
```

Task asks for confirmation before the purge. Do not use `--yes` unless the
volume deletion is intentional.

The explicit base file is important: plain `docker compose up` also loads
`docker-compose.override.yml`, which is intended for development and publishes
PostgreSQL and Redis ports on the host.

## Local machine settings

Only the `web` service is published by the homelab stack. The API, PostgreSQL,
and Redis services use the internal Compose network:

| Use | Address |
| --- | --- |
| Browser on the host | `http://localhost:${WEB_PORT}` |
| Browser on another device | `https://<LF_SITE_ADDRESS>` (via the TLS proxy) |
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

PostgreSQL is the source of truth. Redis is a task broker and result cache and
needs no backup.

This is instance recovery. The per-user export in the app (Settings -> Backup)
is a different thing - a user's own data, not the instance.

### Take a backup

```bash
task backup
```

`scripts/backup.sh` writes a compressed dump to `./backups`
(override with `BACKUP_DIR`), prunes dumps older than `BACKUP_RETENTION_DAYS`
(default 14), and updates `backups/last-backup.txt` with the result and
timestamp. It exits non-zero on failure.

Run it from cron. Decide first how much data loss you can tolerate (how old a
backup is acceptable) and how quickly you need to be back up - those set the
frequency and retention, not the other way round. Point the homelab's
existing monitoring at `backups/last-backup.txt`: a stale mtime, or a line
starting `FAILED`, means backups have stopped.

Copy `BACKUP_DIR` off this host. A dump on the same disk as the database does
not survive that disk failing.

### Keep more than the database

A dump alone does not restore the instance. Store, separately and securely:

- `.env`, above all `API_SECRET_KEY`. It is the key the app's stored secrets
  are encrypted with; a database restored with a different key has unusable
  sessions, invitations, stored provider credentials, and MCP tokens.
- `docker/caddy/Caddyfile` and any compose overrides you added.

Never print or commit these values.

### Verify a backup

```bash
task backup:verify
```

`scripts/restore-verify.sh` restores the newest dump into a disposable
database, checks the schema version, row counts, and per-account balances
against the running instance, then drops it. Schedule this too - an unverified
backup is a guess. CI runs it on every change.

### Restore

Restore `.env` to its backed-up contents, then, with only the database
running:

```bash
docker compose -f docker-compose.yml stop api worker beat web
docker compose -f docker-compose.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < backups/lealfinance-<timestamp>.dump
docker compose -f docker-compose.yml up -d
```

Add the `-f docker-compose.prod.yml` (and `-f docker-compose.tls.yml`) flags
you deployed with.

### Before an update

Take a backup before pulling new images. A migration that fails part-way
leaves the database changed; setting `TAG` back to the previous version does
not undo it. Recovery is: restore the pre-update dump into an empty database,
then start the previous image.

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

If you deployed behind the TLS proxy, add `-f docker-compose.tls.yml` to both
commands, or just run `task install:tls`.

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

## Bring your own proxy

`docker-compose.tls.yml` (see [HTTPS](#https)) is the supported path. If you
already run Traefik, nginx, or your own Caddy, skip that overlay and point
your proxy at the published `web` port instead - terminate TLS there, forward
to `web:8080` (or the host's `WEB_PORT`), and keep `LF_SITE_ADDRESS` /
`APP_BASE_URL` set to the HTTPS origin so cookies and passkeys work.

## Optional AI providers

AI agents are disabled by default. They run in the API container; the
`agents` Compose profile only starts the optional Ollama container. See
[`ai-agents.md`](ai-agents.md) for provider settings and security caveats.
