#!/bin/sh
# Instance backup: a compressed pg_dump of the LealFinance database, plus a
# marker file the homelab's own monitoring can watch for a stale or failed run.
#
# This is instance recovery, not the per-user export in the app (Settings ->
# Backup). Run it from a checkout with a configured .env, against a running
# stack.
#
#   ./scripts/backup.sh
#
# Environment:
#   BACKUP_DIR             where dumps and the marker live (default ./backups)
#   BACKUP_RETENTION_DAYS  delete dumps older than this many days (default 14)
#   COMPOSE_FILE           compose file selecting the postgres service
#                          (default docker-compose.yml)
#
# Schedule it from cron and copy BACKUP_DIR off this host. Recover .env
# alongside the database: without the original API_SECRET_KEY a restored
# database has unusable sessions, invitations, stored provider credentials and
# MCP tokens. See docs/homelab-deploy.md#backups.
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
marker="${BACKUP_DIR}/last-backup.txt"
dump="${BACKUP_DIR}/lealfinance-${stamp}.dump"
tmp="${dump}.partial"

mkdir -p "$BACKUP_DIR"

fail() {
  printf 'FAILED %s %s\n' "$stamp" "$1" > "$marker"
  rm -f "$tmp"
  echo "backup failed: $1" >&2
  exit 1
}

# No pipeline: the exit status is pg_dump's, propagated through compose exec.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$tmp" \
  || fail "pg_dump returned non-zero"

[ -s "$tmp" ] || fail "dump file is empty"
mv "$tmp" "$dump"

find "$BACKUP_DIR" -name 'lealfinance-*.dump' -type f \
  -mtime "+${BACKUP_RETENTION_DAYS}" -delete

printf 'OK %s %s\n' "$stamp" "$dump" > "$marker"
echo "backup written: $dump"
