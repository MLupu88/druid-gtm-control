# PostgreSQL Operational Ledger

This document describes the durable operational ledger added alongside the
existing Google Sheets–backed GTM Mission Control. **Google Sheets remains the
system of record for every existing route.** The ledger is additive: no
current route reads from or writes to PostgreSQL yet. It exists so future
units can adopt it one write path at a time.

## What this is for

A durable, queryable, append-friendly history of accounts, signals, scores,
queue state, operator decisions, and action attempts/events — the kind of
operational audit trail that's awkward to reconstruct from Sheets alone.

## Service

`docker-compose.yml` defines `gtm-postgres` (Postgres 16):

- Persistent named volume (`gtm_postgres_data`) — data survives container recreation.
- Attached only to the internal `n8n_network`. **No host port is published** —
  it is not reachable from outside the docker network.
- Credentials come from `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`
  environment variables — never hardcoded.
- `pg_isready` healthcheck; `gtm-control` waits for `gtm-postgres` to report
  healthy before starting (`depends_on: condition: service_healthy`).

## Environment variables

Set these in `.env` (never commit real values — `.env.example` only has
placeholders):

| Variable | Purpose |
|---|---|
| `POSTGRES_DB` | Database name |
| `POSTGRES_USER` | Database user |
| `POSTGRES_PASSWORD` | Database password |
| `DATABASE_URL` | Full connection string. Must use hostname `gtm-postgres` (the compose service name), not `localhost`, when running via `docker compose`. |

## Schema

Defined in `lib/db/src/schema/*.ts` (Drizzle ORM). Nine tables, all with UUID
primary keys, `timestamptz` timestamps, `jsonb` for structured/free-form data,
foreign keys with `ON DELETE NO ACTION` (no cascading deletes — history is
never silently destroyed by deleting a parent row), and no Postgres enums
(state values are free text; see "Capability maturity" below for the agreed
vocabulary used in `action_attempts.capability_maturity`).

| Table | Shape | Notes |
|---|---|---|
| `accounts` | current-state snapshot | one row per `account_key` (upsert) |
| `signal_events` | append-only | idempotent on `event_id` |
| `score_runs` | append-only | one row per scoring pass; `risk_state` is a free-text gate state, not a graduated score |
| `queue_items` | current-state | one row per queue entry; full history lives in `operator_decisions` |
| `operator_decisions` | append-only | every human decision, never overwritten |
| `action_attempts` | current-state (updatable over time) | idempotent on `idempotency_key` |
| `action_events` | append-only | full state-transition history for an `action_attempts` row |
| `suppressions` | append-only, revocable | never deleted — revoke via `active=false` + `revoked_at` (not implemented as a store method in this unit) |
| `connector_states` | current-state | one row per `connector_key` |

### Capability maturity

`action_attempts.capability_maturity` records where a capability sits on the
maturity ladder at the time of the attempt, using this fixed vocabulary:

`connected`, `decision_only`, `outbox_only`, `manual_export`,
`contract_ready`, `awaiting_credentials`, `not_configured`, `planned`

This is what lets a genuine external execution be told apart from an
internal marker later, without re-deriving it from workflow state after the
fact.

## Migrations

Migration SQL lives in `lib/db/drizzle/`, generated from the schema — this is
the only supported way to change production schema.

Run from the repo root:

```sh
pnpm db:generate   # regenerate SQL migrations from lib/db/src/schema
pnpm db:migrate    # apply pending migrations to DATABASE_URL
pnpm db:check      # validate migration history consistency
pnpm db:smoke      # confirm the database is reachable (no schema changes)
```

Each delegates to `@workspace/db`'s own scripts
(`pnpm --filter @workspace/db run db:*`).

**`drizzle-kit push` is development-only** (`lib/db/package.json`'s
`push:dev-only` / `push:dev-only-force` scripts, and the `post-merge.sh`
convenience hook). It mutates the schema directly without a reviewable SQL
file and must never be used against a production database — production
schema changes always go through `db:generate` + `db:migrate`.

## Database module (`@workspace/db`)

`lib/db/src/index.ts` connects lazily — importing the package never opens a
connection. The pool is created on first use, bounded (`max: 10`), and has
connection/idle timeouts so an unreachable database fails fast instead of
hanging requests.

- `getDb()` — the Drizzle client (creates the pool on first call).
- `checkDatabaseConnection()` — runs `SELECT 1`; returns `{ ok: true }` or
  `{ ok: false, error }` and never throws, never includes the connection
  string or a raw driver error.
- `closeDatabaseConnection()` — closes the pool; safe to call multiple times.
- Missing `DATABASE_URL` produces one clear error the first time the
  database is actually used, not at import time.

## API health

- `GET /api/healthz` — liveness. Database-independent; if the process is up,
  this responds. Unchanged by this unit.
- `GET /api/readyz` — readiness. Runs `checkDatabaseConnection()`; returns
  `200 {"status":"ok"}` when reachable, `503 {"status":"unavailable"}`
  otherwise. Never exposes the connection string or a stack trace.
- `GET /api/health` — general status. `status` is `"ok"` when the database is
  reachable and `"degraded"` when it isn't; `database` is `"ok"` or
  `"unavailable"`.

## Storage boundary

`artifacts/api-server/src/storage/operational-store.ts` defines the
`OperationalStore` interface; `postgres-operational-store.ts` implements it
against PostgreSQL. **No route uses this yet.** Adopting it for a given write
path is a separate, later unit.

## Backup and restore

Backups are written to the gitignored `backups/` directory by default.

```sh
# Backup (compressed, timestamped; requires gtm-postgres running via docker compose)
./scripts/db-backup.sh
# -> backups/gtm-postgres-<UTC timestamp>.sql.gz

# Restore — DESTRUCTIVE. Requires both an explicit filename and explicit confirmation.
CONFIRM_RESTORE=yes ./scripts/db-restore.sh backups/gtm-postgres-<timestamp>.sql.gz
```

`db-restore.sh` fails closed: it refuses to run without a backup filename
argument, and refuses again without `CONFIRM_RESTORE=yes`. Neither script
ever prints `POSTGRES_PASSWORD` or any other secret.
