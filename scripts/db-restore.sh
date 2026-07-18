#!/bin/bash
# Restores the gtm-postgres operational ledger from a backup produced by
# scripts/db-backup.sh.
#
# THIS IS DESTRUCTIVE. It replays SQL directly into the running database and
# can overwrite or conflict with existing data. There is no automatic undo.
#
# Usage:
#   CONFIRM_RESTORE=yes ./scripts/db-restore.sh backups/gtm-postgres-<ts>.sql.gz
#
# Fails closed: refuses to run without both an explicit backup file argument
# and CONFIRM_RESTORE=yes set. Never prints POSTGRES_PASSWORD.
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: CONFIRM_RESTORE=yes $0 <backup-file>" >&2
  echo "Refusing to run without an explicit backup filename." >&2
  exit 1
fi

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Refusing to restore: this is destructive and can overwrite existing data." >&2
  echo "Set CONFIRM_RESTORE=yes to proceed, e.g.:" >&2
  echo "  CONFIRM_RESTORE=yes $0 \"$BACKUP_FILE\"" >&2
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER must be set (e.g. in .env)}"
: "${POSTGRES_DB:?POSTGRES_DB must be set (e.g. in .env)}"

echo "Restoring '${POSTGRES_DB}' from ${BACKUP_FILE} ..."
echo "This will apply SQL directly into the running database. This cannot be undone automatically."

gunzip -c "$BACKUP_FILE" | docker compose exec -T gtm-postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-password

echo "Restore complete from: ${BACKUP_FILE}"
