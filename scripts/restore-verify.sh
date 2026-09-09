#!/bin/sh
# Restore an instance backup into a disposable database and check the restored
# data matches the running instance. Proves a dump is actually recoverable
# instead of assuming it.
#
#   ./scripts/restore-verify.sh [dump-file]
#
# With no argument it uses the newest dump in BACKUP_DIR. The disposable
# database is dropped on exit. Run this against an instance that has data - CI
# runs it right after the browser smoke test, which creates some.
#
# Environment:
#   BACKUP_DIR    where backup.sh writes dumps (default ./backups)
#   COMPOSE_FILE  compose file selecting the postgres service
#                 (default docker-compose.yml)
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

dump="${1:-}"
if [ -z "$dump" ]; then
  dump="$(ls -1t "${BACKUP_DIR}"/lealfinance-*.dump 2>/dev/null | head -n 1 || true)"
fi
[ -n "$dump" ] && [ -f "$dump" ] || { echo "no dump file found (looked in ${BACKUP_DIR})" >&2; exit 1; }

VERIFY_DB="lealfinance_verify_$(date -u +%Y%m%d%H%M%S)"

dc() {  # dc <sql-or-empty> -- run a container command with $Q_DB / $Q_SQL set
  docker compose -f "$COMPOSE_FILE" exec -T -e "Q_DB=$1" -e "Q_SQL=${2:-}" postgres sh -c "$3"
}

# Query a database and print unaligned, tuples-only rows. Empty first arg =
# the live instance database ($POSTGRES_DB inside the container).
q() {
  dc "$1" "$2" 'psql -Atq -U "$POSTGRES_USER" -d "${Q_DB:-$POSTGRES_DB}" -c "$Q_SQL"'
}

cleanup() {
  dc "$VERIFY_DB" "" 'dropdb --if-exists -U "$POSTGRES_USER" "$Q_DB"' >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "restoring $dump into $VERIFY_DB"
dc "$VERIFY_DB" "" 'createdb -U "$POSTGRES_USER" "$Q_DB"'
docker compose -f "$COMPOSE_FILE" exec -T -e "Q_DB=$VERIFY_DB" postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$Q_DB" --no-owner --no-privileges' < "$dump" \
  || echo "note: pg_restore exited non-zero (often ignorable warnings); the checks below decide" >&2

mismatch=0
compare() {  # compare <label> <sql>
  _live="$(q '' "$2")"
  _restored="$(q "$VERIFY_DB" "$2")"
  if [ "$_live" != "$_restored" ]; then
    echo "MISMATCH [$1]:" >&2
    echo "  live:     $(echo "$_live" | tr '\n' ' ')" >&2
    echo "  restored: $(echo "$_restored" | tr '\n' ' ')" >&2
    mismatch=1
  else
    echo "ok [$1]: $(echo "$_live" | tr '\n' ' ')"
  fi
}

require_positive() {  # require_positive <label> <sql>
  _n="$(q "$VERIFY_DB" "$2")"
  case "$_n" in
    ''|0|*[!0-9]*) echo "EMPTY [$1]: restored value is '$_n', expected > 0" >&2; mismatch=1 ;;
    *) echo "ok [$1]: $_n rows restored" ;;
  esac
}

compare "schema version" "SELECT version_num FROM alembic_version"
compare "user count"        "SELECT count(*) FROM users"
compare "transaction count" "SELECT count(*) FROM transactions"
compare "per-account balances" \
  "SELECT account_id::text, sum(amount)::text FROM transactions GROUP BY account_id ORDER BY 1"

require_positive "users present"        "SELECT count(*) FROM users"
require_positive "transactions present" "SELECT count(*) FROM transactions"

if [ "$mismatch" -ne 0 ]; then
  echo "restore verification FAILED" >&2
  exit 1
fi
echo "restore verification passed"
