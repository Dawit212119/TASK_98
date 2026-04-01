#!/bin/sh
set -eu

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_USERNAME="${DB_USERNAME:-carereserve}"
DB_NAME="${DB_NAME:-carereserve}"
export PGPASSWORD="${DB_PASSWORD:-carereserve}"

echo "Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
max_attempts=60
attempt=1
while ! pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USERNAME}" -d "${DB_NAME}" >/dev/null 2>&1; do
  if [ "${attempt}" -ge "${max_attempts}" ]; then
    echo "PostgreSQL did not become ready in time."
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 2
done

echo "PostgreSQL is ready. Running migrations..."
npm run migration:run:prod

echo "Migrations complete. Starting application..."
exec "$@"
