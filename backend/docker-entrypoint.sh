#!/bin/sh
# Shared entrypoint for api/worker/beat. Migrations only run when
# RUN_MIGRATIONS=true (set on the api service only, in docker-compose.yml)
# — running `alembic upgrade head` from all three containers concurrently
# on a fresh homelab install would race against each other. worker/beat
# instead wait on api's healthcheck (depends_on: condition: service_healthy)
# before they start, so migrations are always done by the time they run.
set -eu

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
    echo "Running database migrations..."
    alembic upgrade head
fi

exec "$@"
