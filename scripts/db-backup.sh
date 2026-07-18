#!/bin/bash
# Backs up the gtm-postgres operational ledger to a compressed, timestamped
# file. Runs pg_dump inside the running gtm-postgres container via
# `docker compose exec` — never prints POSTGRES_PASSWORD or any other secret.
#
# Usage:
#   ./scripts/db-backup.sh [output-directory]
#
# Requires POSTGRES_USER and POSTGRES_DB to be set in the environment (e.g.
# via `.env`, which docker compose already loads for gtm-postgres).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER must be set (e.g. in .env)}"
: "${POSTGRES_DB:?POSTGRES_DB must be set (e.g. in .env)}"

OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/gtm-postgres-${TIMESTAMP}.sql.gz"

echo "Backing up database '${POSTGRES_DB}' to ${OUT_FILE} ..."

# -T disables pseudo-TTY allocation so the dump stream isn't corrupted.
docker compose exec -T gtm-postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-password \
  | gzip > "$OUT_FILE"

echo "Backup complete: ${OUT_FILE}"
