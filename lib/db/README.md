# @workspace/db

PostgreSQL persistence layer, built on `drizzle-orm`. This package currently
holds the Package 2, Phase 1 schema — ICP profiles/versions, activation
history, account snapshots, evaluations, and decisions. See
`docs/icp-rule-discovery.md` for the Phase 0 discovery this was built on and
`ROADMAP.md` (Package 2) for the phase plan.

## Schema layout

One table per file under `src/schema/`, re-exported from `src/schema/index.ts`.
Every table also exports a `drizzle-zod` insert schema and inferred
`Insert*`/`*` types, following the convention already documented in that
barrel file.

Tables are heavily constrained at the database level (not just in
application code) — CHECK constraints, partial unique indexes, and, for
rules no CHECK can express (immutability, cross-table reference integrity),
hand-authored triggers. See the comment block at the top of each schema file
for what it enforces and why.

## Two ways to apply schema changes

- **`pnpm run push`** (and `push-force`) — `drizzle-kit push`, diffs the TS
  schema directly against a live database and applies it. Fast, no history,
  good for local iteration on a throwaway database. **Does not apply the
  hand-authored trigger migration** (`drizzle/0001_integrity_triggers.sql`)
  — push only knows about what's expressible in the TS schema.
- **`pnpm run generate` + `pnpm run migrate`** — `drizzle-kit generate`
  produces tracked SQL files under `drizzle/`; `migrate` (a thin wrapper
  around `drizzle-orm`'s migrator, `src/migrate.ts`) applies them in order
  against `DATABASE_URL`. This is the real, reviewable path — the one CI
  uses — and it's the only path that includes the trigger migration.

Both need `DATABASE_URL` set. `generate` (unlike `push`/`migrate`) doesn't
need it to point at a reachable database — it only diffs against the local
migration history in `drizzle/meta/`. `drizzle.config.ts` still requires the
env var to be _set_ (even to a placeholder value) before it will load at
all.

## Running tests

```
pnpm run test        # structural + integration
pnpm run test:unit    # structural only, no database needed
```

- **`src/schema/schema.test.ts`** — structural tests. Assert on the shape of
  the Drizzle table objects and Zod insert schemas directly; never touch a
  database. Always run.
- **`src/schema/integrity.integration.test.ts`** — real-database tests for
  every CHECK constraint and trigger. Requires `DATABASE_URL` pointing at a
  **migrated** database (run `pnpm run migrate` first). **Explicitly skips
  itself (not fails) when `DATABASE_URL` is unset** — this is the expected
  state of local dev today, since no Postgres instance ships with this repo.
  CI provisions one and sets `DATABASE_URL` specifically so this file is
  never skipped there — see `.github/workflows/pr-checks.yml`.

### Running the integration tests locally

No Postgres service is checked into this repo's `docker-compose.yml` (kept
out of scope for this slice deliberately). To run the full suite locally:

```
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/db run test
```

## Design notes worth knowing before extending this schema

- **`icp_profile_versions.status`** is `draft | published` only — no
  `active`/`archived` value. Whether a published version is currently active
  is `icp_profiles.active_version_id` (a pointer), never a property of the
  version row. Publishing is one-way and the row becomes fully immutable
  afterward (trigger-enforced).
- **`icp_profile_activation_events`** is the append-only activation/
  deactivation audit trail — separate from both of the above so changing
  what's active never requires rewriting history. The application service
  that performs activation/deactivation is responsible for writing the
  `icp_profiles.active_version_id` update and the corresponding event
  atomically (one transaction); this schema only guarantees each side is
  individually well-formed.
- **`account_evaluations` vs. `account_decisions`** are deliberately
  separate tables. Evaluations own only what a canonical evaluator (Package
  2, Phase 2 — not yet built) produces: fit, intent, identity,
  actionability, eligibility, and structured explanations. Decisions own
  routing output, per-channel action availability, and the decision-time
  operational context (Package 2, Phase 3 — not yet built). An account can
  get a new decision without its evaluation being rewritten or recomputed.
- **`account_evaluations.evaluation_mode`** (`preview | production`)
  distinguishes impact-preview evaluations from real ones. Only
  `production` evaluations may reference a _published_ profile version
  (trigger-enforced), and `account_decisions` may only ever reference a
  `completed` `production` evaluation (also trigger-enforced) — a decision
  can never be built on a preview or a failed evaluation.
- **`overall_decision_gate`** on `account_decisions` is a deliberately new
  name and vocabulary (`actionable | restricted | blocked`), not the legacy
  `passed/warning/failed` `gate_status` carried by either legacy n8n
  scoring engine. See `docs/icp-rule-discovery.md` §2A.6, CONFLICT-01/04 —
  that legacy field meant different things on different paths; this schema
  does not inherit that ambiguity.
- **No table here computes anything.** This slice is persistence only. The
  canonical evaluator (Phase 2) and decision/routing policy (Phase 3) are
  separate, not-yet-built pieces of application logic that will read from
  and write to these tables — nothing in this schema encodes scoring
  formulas, weights, or routing rules from the legacy n8n workflows.
