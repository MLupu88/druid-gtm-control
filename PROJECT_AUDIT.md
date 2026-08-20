# PROJECT_AUDIT.md — DRUID GTM Mission Control

> **⚠️ STALE — superseded by `NEXT_SESSION.md`, verified 2026-08-20.** This
> audit's HEAD (`4a34112`) is at least 14 commits behind `main`. Do not treat
> this as current execution truth — see `NEXT_SESSION.md`. Retained for
> historical/audit-trail value only.

**Audit date:** 2026-08-18
**Repository:** `/Users/mihailupu/Projects/druid-gtm-control` (local clone of `github.com/MLupu88/druid-gtm-control`)
**Branch audited:** `main`
**HEAD at audit time:** `4a341126a59cd33337a36af9be8f3d6088fc9333` — "GTM V2: add durable Client Radar account mapping (#43)" (2026-08-07)
**Working tree:** clean, up to date with `origin/main`, no untracked/uncommitted changes at audit start.
**Method:** read-only static inspection of schema, migrations, services, routes, tests, and git history, plus live execution of `tsc --build` (workspace typecheck) and every DB-independent unit test suite. No database was connected, no migration was run, no Docker container was started, no SSH connection was made, no code was modified.

**2026-08-18 correction pass:** this document was revised after a follow-up review that flagged several imprecise claims. Corrections applied: added DISC-07 (operational provider/n8n → GTM V2 signal bridge is unproven, not merely "runtime-unverified" as a footnote); rewrote the duplicate-account mechanism in §F/§G/DISC-06 (the original text incorrectly implied a weak/name-only signal can create an account — verified false, see §F); corrected the Client Radar↔GTM call path (direct HTTP client, not via n8n — see §C); added an explicit "not independently audited" qualifier to every Client Radar completeness claim (§K); replaced "Stage 5 complete" phrasing with unit-level precision; re-ran (not merely re-cited) the test suites live during this pass — see §B. Every changed claim below is the corrected version; no silent inference was added — anything not provable from the repository is now explicitly tagged **UNKNOWN / REQUIRES RUNTIME VERIFICATION**.

**Status tags used throughout, in decreasing order of certainty — used consistently, never interchangeably:**
- **VERIFIED IN CODE** — the behavior is directly readable in source (a function, a schema constraint, a DB trigger).
- **VERIFIED BY COMPLETED LOCAL TEST** — a unit test exercising the behavior was executed live during this audit and passed (exact command + result cited).
- **VERIFIED IN GIT HISTORY** — confirmed via `git log`/`git diff`/commit content, not current working-tree state alone.
- **DOCUMENTED BUT NOT INDEPENDENTLY VERIFIED** — another file in this repo asserts it, but this audit did not re-derive it from first principles (e.g. `docs/icp-rule-discovery.md`'s n8n workflow inspection).
- **PARTIAL** — some but not all of a capability is implemented.
- **SCHEMA-ONLY** — a column/table/enum exists but no code path currently populates or reads it meaningfully.
- **NOT BUILT** — no code found.
- **UNKNOWN / REQUIRES RUNTIME VERIFICATION** — cannot be determined from static repository inspection at all; requires connecting to a running system (a database, a live env var, a deployed server) that this audit was constrained not to touch.

A few equivalences this document deliberately never asserts, because the evidence does not support them: **"a real HTTP client exists" ≠ "the external service is currently reachable"; "merged to `main`" ≠ "deployed"; "a route is implemented" ≠ "a live workflow currently calls it"; "the schema supports X" ≠ "runtime data of shape X exists."**

---

## A. Executive summary

1. **At audit start, the repository's own `ROADMAP.md` was stale relative to `main` by 16 merged PRs — this has since been corrected as part of this audit's documentation deliverables, and the finding is preserved here for history.** Before this audit, `ROADMAP.md` stated it described "Current Product State (as of PR #27)" and had been last substantively edited at commit `5f866b0` ("docs: update roadmap after canonical account workflow"), while `main` had since merged PR #28 through PR #43 — including 10 PRs (`#34`–`#43`) implementing an entirely separate architecture track internally referred to in code comments as **"GTM V2"** (signal ingestion, identity resolution, attention items, evaluation staleness/resolution, and Client Radar account mapping) that, at audit start, **no markdown file in the repository mentioned anywhere**. Its stage/unit structure had to be reconstructed from code comments (see §Q). `ROADMAP.md` now (as of this audit's documentation pass) has a "Current Verified State — 2026-08-18" section, a "GTM V2" section, and a "Roadmap Corrections / Reclassified Work" section reflecting all of the above — this finding describes the condition this audit discovered and fixed, not the document's current state.

2. **Signal ingestion → identity resolution → canonical account binding is real, DB-enforced, and unit-tested — but it is completely disconnected from ICP evaluation.** `evaluateAndPersist` (`lib/evaluator-persistence/src/evaluateAndPersist.ts`) only ever reads `account_snapshots`. The only production producer of `account_snapshots`, `createCurrentAccountSnapshot` (`artifacts/api-server/src/services/icpEvaluationResolvers.ts:229-269`), builds its `normalizedInput` from the bare `accounts` row plus `account_facts` — and `account_facts.source` is DB-CHECK-locked to the single literal `'manual-operator-v1'` (`lib/db/drizzle/0006_add_account_facts.sql:13`, unaltered through migration `0011`). `buildNormalizedAccountInputFromAccount` (`icpEvaluationResolvers.ts:106-150`) unconditionally hardcodes `engagement: { sources: [], pagesVisited: [], distinctSourceCount: 0, repeatVisit: false, lastSeenAt: null }` and `contact: null`, with the code comment *"No engagement source exists to surface contact evidence from."* The evaluator's own `NormalizedEngagementV1Schema` (`lib/evaluator/src/types.ts:68-83`) and `intent` rule dimension (`lib/evaluator/src/rules/intent.ts`) are fully built to consume exactly this data — it is simply never wired. See §F for the full EXPECTED/ACTUAL/CAUSE/IMPACT/FIX trace. This finding and finding 3 above (DISC-07) are the two most important findings in this audit, and they are logically ordered: finding 3 asks whether real signals reach the resolver at all; this finding asks whether resolved data reaches evaluation. Both must be true for the end-to-end signal→Intent story to hold, and neither is proven today.

3. **Whether real operational signals (RB2B, Dealfront, legacy n8n, or any other live source) actually reach the GTM V2 ingestion/resolution path is unproven — this is separate from, and logically prior to, finding 2 above.** The repository proves the *contract*: a correctly-shaped `NormalizedSignalV1` payload posted to `POST /internal/signals` will be persisted and, on resolution, correctly bound to a canonical account (§F, §I below). It does **not** prove any *live* signal source currently does this. A repo-wide search for any caller of `/internal/signals` outside the route's own definition, tests, and comments returns **zero matches** — no frontend code, no script, nothing in this repository calls it. No RB2B/Dealfront/Cognism/Salesforge/Dripify/Retell adapter code exists beyond isolated comments contrasting them with what's *not* built. See DISC-07. **This means the user-observed concern that motivated this audit — "signals are stored but don't reliably resolve to companies" — is not disproved by this audit.** What is proved is narrower: *if* a signal reaches the resolver in the correct shape, the resolver itself is correct. Whether any signal currently reaches it that way is a separate, unverified question.

4. **The GTM V2 attention/signal backend has zero frontend consumption.** `artifacts/druid-gtm/src/components/needs-attention-view.tsx` — the live "Needs Attention" UI — is built entirely on the pre-GTM-V2 model (Sheet-backed queue rows filtered by `accountDecisions.routingOutput`, per its own header comment at line 40 and the `latestDecision` logic at lines 188-230). A repo-wide search of `artifacts/druid-gtm/src` for `attentionItems`, `attention-items`, `needsAttention`, `AccountAttentionSummary`, `signals`, or `identityResolution` returns **zero matches**. The `needsAttention` query-param + `AccountAttentionSummary` read model that PR #40 built into `GET /internal/accounts` (`artifacts/api-server/src/services/accounts.ts:332-536`) is fully implemented, DB-verified, and unused by any consumer in this repository.

5. **528 of 528 DB-independent unit tests pass, and the full workspace typechecks cleanly — VERIFIED BY COMPLETED LOCAL TEST, re-executed live during this correction pass** (`pnpm exec tsc --build` — zero output/errors; `tsx --test` across all 23 `artifacts/api-server` unit-suite files — `528 tests, 528 pass, 0 fail`, wall time **8.87s** per `time`; `pnpm --filter @workspace/identity test` — `42 tests, 42 pass, 0 fail`, wall time **1.18s**). Both runs completed well inside any timeout and produced a full, unambiguous `node:test` summary block ending `ℹ fail 0` — this is not an inference from a partial or timed-out run. DB-backed `.integration.test.ts` suites were **not** executed (would require a live Postgres instance, out of scope per this audit's constraints) — their pass/fail status is unverified by this audit and must not be assumed from the unit-test result above.

6. **Client Radar's built-out lifecycle, on the Mission Control (this repository's) side, stops at evidence display; there is no candidate-fact/accept-reject layer at all.** `syncClientRadarResearchResult` / `persistCompletedClientRadarResult` (`artifacts/api-server/src/services/clientRadarResearchRuns.ts`) persist `accountPayload`/`evidencePayload` as raw JSON and link the Client Radar account via `account_aliases`, but the code's own comment states this path *"never touches accountFacts"* (`clientRadarResearchRuns.ts:612-613`). There is no `candidate` vs `accepted` state anywhere in the schema; `account_facts` accepts only `source = 'manual-operator-v1'` (see finding 2). ROADMAP.md's Package 6 ("Evidence-Backed Client Radar Composer Enrichment") and this audit's §K items 8–13 are **NOT BUILT on the Mission Control side**, not merely incomplete. **This audit only inspected this repository** (`druid-gtm-control`) — the separate Client Radar repository/deployment's own internal implementation and runtime state were not audited; see §K's header note and correction #7 below.

---

## B. Verified repository baseline

- Repo path: `/Users/mihailupu/Projects/druid-gtm-control`
- Branch: `main`, HEAD `4a34112` = `origin/main` HEAD (fast-forward, no divergence)
- Working tree: clean at audit start; no changes made to application code, migrations, or dependencies during this audit
- Remote: `origin` = `https://github.com/MLupu88/druid-gtm-control.git`
- **No unmerged GTM work exists on any branch.** Every local/remote `feat/*`, `fix/*`, `hotfix/*` branch was checked with `git rev-list --count main..origin/<branch>` / `origin/<branch>..main`. Sampled branches (`feat/gtm-v2-client-radar-integration`, `feat/account-detail-ux-pass`) that showed a nonzero "ahead" count were confirmed to be the exact pre-squash-merge source branches of already-merged PRs (`#43`, `#29` respectively) — stale duplicates, not new work. No branch contains a commit absent from `main`'s merged history.
- Package manager: pnpm workspaces (`pnpm-workspace.yaml`), Node 24, TypeScript 5.9 (`replit.md`)
- `pnpm exec tsc --build` (full workspace typecheck): **clean, zero errors** (executed live during this audit)
- `artifacts/api-server` unit test suite (23 files, no `DATABASE_URL` set): **528/528 pass**, 0 fail, 0 skipped (executed live)
- `@workspace/identity` unit tests: **42/42 pass** (executed live)
- Existing documentation found: `ROADMAP.md` (root, 37KB, stale — see §A.1), `docs/icp-rule-discovery.md` (Phase 0 discovery doc, predates GTM V2 entirely — see §Q), `DEPLOYMENT.md` (production deploy runbook, current), `replit.md` (original Replit scaffold brief — stale: states "DB: PostgreSQL + Drizzle ORM (lib/db) — not yet used," which is false as of GTM V2), `REPLIT_PROMPT_v3.md` and `design-system-extract.md` (original build-brief artifacts, historical, not living documentation). No `CLAUDE.md`, no `PROJECT_HANDOFF.md`, no `NEXT_SESSION.md`, no `PROJECT_AUDIT.md` existed before this audit.

---

## C. Architecture map

**Two runtime applications in one pnpm workspace, not a monolith:**

| Package | Role | Status |
|---|---|---|
| `artifacts/druid-gtm` | React 19 + Vite + Tailwind + shadcn/ui frontend | **VERIFIED IMPLEMENTED**, live product surface. Consumes only the `requireAuth`-gated (session) `/api/internal/*` routes: accounts, account-decisions, account-facts, icp-evaluations, icp-profiles, n8n proxy, sheets. Does **not** consume any GTM V2 service-auth route. |
| `artifacts/api-server` | Express 5 backend | **VERIFIED IMPLEMENTED**. Two auth boundaries: `requireAuth` (browser session, `lib/operators.ts`) for the older/product-facing `/internal/*` routes, and `requireServiceAuth` (shared-secret header, `artifacts/api-server/src/middlewares/requireServiceAuth.ts`) for the GTM V2 service-to-service routes (`/internal/signals`, `/internal/accounts/:accountId/attention-items`, `/internal/attention-items`). |
| `artifacts/gtm-action-web` | Separate static landing page, own Docker image/deploy (`gtm-action-web-image.yml`, `actionweb.aiexperiments.eu`) | Present, out of this audit's functional scope (marketing page, not GTM logic). |
| `artifacts/mockup-sandbox` | Design sandbox | Present, not part of the production surface — not audited further. |
| `lib/db` | Drizzle ORM schema + migrations (Postgres) | **VERIFIED IMPLEMENTED** — see §D. |
| `lib/evaluator` | Pure, DB-free deterministic ICP evaluator | **VERIFIED IMPLEMENTED** — see §I. |
| `lib/evaluator-persistence` | The only adapter that loads DB records, calls `lib/evaluator`, and writes `account_evaluations` | **VERIFIED IMPLEMENTED** — see §F. |
| `lib/identity` | Normalized signal contract types (`NormalizedSignalV1`) shared by ingestion | **VERIFIED IMPLEMENTED**, DB-free, unit-tested (42 tests, executed live). |
| `lib/gtm-shared` | Legacy shared contract/mock data (`gtmContract.js`) used by the n8n proxy and composer/action-modal truthful-lifecycle logic | **VERIFIED IMPLEMENTED**, still live (see §L). |
| `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | OpenAPI-driven codegen for typed frontend API hooks (Orval) | Present; not deeply audited — tooling, not product logic. |
| `lib/reference` | `server_n8n.js` reference/legacy script | Small (62 lines), not a live import anywhere in the workspace per `pnpm-workspace.yaml`/`docs/icp-rule-discovery.md:76`. |

**External integration boundary — n8n:** `artifacts/api-server/src/routes/n8n.ts` is a real, live-code proxy: `postToN8n` (`n8n.ts:70-117`) does an actual `fetch()` against `process.env.N8N_BASE_URL` with shared-secret headers and a 12s timeout, throwing rather than silently succeeding if the env var is unset. This is the **outbound** direction (GTM → n8n, activation/decision/action requests). The GTM V2 `requireServiceAuth`-gated routes are the **inbound** direction (a producer — intended to be n8n or another service — calling GTM). Whether `N8N_BASE_URL` currently points at a reachable, live n8n instance is **UNKNOWN / REQUIRES RUNTIME VERIFICATION** — this audit did not (and per its constraints, must not) execute that call.

**Client Radar boundary — call path corrected in this pass.** `artifacts/api-server/src/lib/clientRadarClient.ts` is a real HTTP client (not a mock/stub), config-driven via `CLIENT_RADAR_BASE_URL` / `CLIENT_RADAR_API_TOKEN`, with strict response-shape parsing (`parseSubmitResponse`, `parseStatusResponse`, `parseResultResponse` all throw `ClientRadarApiError` on malformed/unexpected shapes). **The actual call path is a direct, authenticated HTTP call from this repository's own API server to Client Radar's API — it does not pass through n8n.** Verified by import-level inspection: `artifacts/api-server/src/services/clientRadarResearchRuns.ts` and `clientRadarAccountAlias.ts` contain zero imports of, or calls into, `routes/n8n.ts` or any n8n client; the two "n8n" substring hits in those files are an analogy in a comment ("mirrors start-scan.ts's n8n dispatch") and a description of where `account_key` historically originated ("n8n-derived string"), not a description of the Client Radar call path itself. `ROADMAP.md`'s original opening summary line — "connected via an n8n orchestration boundary and a handoff contract" — describes the two-*product* relationship at a level that does not hold for the *implemented* GTM↔Client Radar call path specifically; that line has been corrected. Whether `CLIENT_RADAR_BASE_URL`/`CLIENT_RADAR_API_TOKEN` are currently configured with a value pointing at a live, reachable Client Radar deployment is **UNKNOWN / REQUIRES RUNTIME VERIFICATION**.

**Deployment model (from `DEPLOYMENT.md`, not independently verified by SSH per this audit's constraints):** manual Docker Compose on a single Hetzner host, production builds from its own local git checkout (not yet pull-based from the GHCR image CI publishes), production URL `https://gtm.aiexperiments.eu`. `gtm-action-web` is deployed separately and does pull from GHCR. This audit did not SSH to production and cannot confirm what commit is actually running there.

---

## D. Database / storage inventory

All tables below are read directly from `lib/db/src/schema/*.ts` and cross-checked against the raw SQL in `lib/db/drizzle/0000`–`0011`.

| Table | Lifecycle | Key constraints | Nullable resolution FK? | Provenance field |
|---|---|---|---|---|
| `accounts` | **Mutable** identity anchor (only non-versioned, non-audit table besides `account_aliases`/`account_people`/`people`) | `account_key` unique, not-blank CHECK | n/a | none (thin identity anchor only — `lib/db/src/schema/accounts.ts:1-11`) |
| `account_snapshots` | **Insert-only** (trigger `account_snapshots_immutable`, `0001_integrity_triggers.sql`) | `account_id` FK NOT NULL | not null | `source` text field |
| `icp_profiles` | Mutable pointer row (`active_version_id`) | trigger `icp_profiles_active_version_must_be_published` (`0001`) ensures the pointer only ever references a published version of the same profile | n/a | `created_by` |
| `icp_profile_versions` | **Immutable after publish** (trigger `icp_profile_versions_immutable_after_publish`, `0001`) | ≤1 draft per profile (partial unique index); `published_at` present iff status='published' | n/a | `created_by` |
| `icp_profile_activation_events` | Append-only audit trail | — | n/a | — |
| `evaluator_versions` | Registry row per implemented evaluator version | unique `version` | n/a | — |
| `account_evaluations` | **Insert-only**, two terminal statuses only (`completed`/`failed` — no "pending" persisted state) | trigger `account_evaluations_production_requires_published_version` (`0001`) — a `production`-mode row's `profile_version_id` must reference a published version | n/a | `profile_config_snapshot` freezes the exact config used |
| `decision_policy_versions` | Versioned policy config for Phase 3 decision layer | — | n/a | — |
| `account_decisions` | **Insert-only** (trigger `account_decisions_immutable`) | trigger `account_decisions_requires_completed_production_evaluation` (`0001`) — must reference a `completed`+`production` evaluation | n/a | `created_by` |
| `account_facts` | **Insert-only**, immutable (trigger `account_facts_immutable`, `0007`) | `source` CHECK-locked to exactly `'manual-operator-v1'` (`0006_add_account_facts.sql:13`, never altered through `0011`); `correction_reason` present iff `supersedes_fact_id` present | n/a | `source`, `recorded_by` |
| `account_fact_current` | Mutable pointer table (no immutability trigger — deliberately rebuildable) | composite FK ties `(account_id, field)` to the correct `account_facts` row | n/a | — |
| `signals` | **Append-only** (trigger `signals_immutable`, `0009`) | unique `(source, source_event_id)` — dedup guarantee; domain-shape CHECK | **carries no `account_id`/`person_id` at all, by design** (`signals.ts:1-8`) | `source` |
| `identity_resolution_events` | **Append-only** (trigger `identity_resolution_events_immutable`, `0009`) | every row is a complete binding snapshot (CHECKs enforce `account_id`/`person_id` presence exactly matches `outcome`); `person_id` requires `resolution_level IN ('contact','known_crm_contact')` — DB-enforced "never manufacture a contact" | **`account_id`/`person_id` nullable** — null exactly when `outcome='unresolved'` | `resolution_method`, `resolver_version` |
| `account_aliases` | **Mutable** (no immutability trigger — "alias reassignment is a future operation," `accountAliases.ts:22-25`) | strong aliases (`is_strong=true`) globally unique per `(alias_type, normalized_value)`; weak aliases may collide across accounts | n/a | `source` (also reused for Client Radar mapping, `source='client_radar'`, `alias_type='client_radar_account_id'`) |
| `account_people` | **Mutable**, single row per `(account_id, person_id)` (not an append-only ledger) | unique `(account_id, person_id)`; `last_seen_at >= first_seen_at` | n/a | `source` |
| `people` | **Mutable** canonical person record | must carry ≥1 real identity attribute (CHECK `people_has_identity_attribute`); unique `work_email` (partial), unique `(external_id_source, external_id)` (partial) | n/a | none — identity attributes only |
| `attention_items` | **One-way lifecycle**: `open → resolved` exactly once, DELETE rejected unconditionally (bespoke trigger, `0011_attention_items_lifecycle.sql`) | two partial unique indexes split on `source_ref` null-ness — the idempotency/dedup mechanism | `account_id` NOT NULL | `source` (closed enum: `manual, identity_resolution, evaluation, enrichment, client_radar, action` — corrected 2026-08-18: exactly two values are hardcoded by dedicated application-code producers, per `grep -rn "createAttentionItem({"` — `evaluation` (`accountEvaluations.ts:281,313`, `accountFacts.ts:322` via `EVALUATION_ATTENTION_SOURCE`) and `client_radar` (`clientRadarResearchRuns.ts:469-474`, the identity-conflict path — see §K). `manual` is accepted (not hardcoded) by the generic service-auth-gated create route (`routes/attentionItems.ts`, validated against the full enum, caller supplies `source`); `identity_resolution`, `enrichment`, and `action` have no producer — dedicated or generic-route — found anywhere in this codebase) |
| `client_radar_research_runs` | One row per research attempt, mutable within its own lifecycle until terminal | unique `client_radar_run_id`; partial unique index limits ≤1 concurrently active (submitting/queued/running) run per account | `account_id` FK NOT NULL, `ON DELETE CASCADE` | `account_payload`/`evidence_payload` raw JSON from the provider |

**No standalone "Client Radar account mapping" table exists.** It deliberately reuses `account_aliases` with `alias_type = 'client_radar_account_id'`, `source = 'client_radar'`, `is_strong = true` (`artifacts/api-server/src/services/clientRadarAccountAlias.ts:1-8, 46-47`).

**No "shadow account" table or module exists anywhere in this repository's code.** The term "shadow" appears only in `docs/icp-rule-discovery.md`, describing a live **n8n** workflow (`ICP Account Shadow (Phase B — resolver/accumulator/scorer)`) that predates GTM V2 entirely (see §Q) and is out of this repository's own codebase.

**Runtime data verification:** This audit did **not** connect to any database, so it cannot state how many rows exist in any of the tables above, or whether the production database has been migrated through `0011`. Confirming actual row counts or migration state requires a read-only query against the production/staging `DATABASE_URL`, which was intentionally not attempted — see §T for the exact queries that would be needed if approved in a later session.

---

## E. Signal / provider ingestion inventory

| Producer | Classification | Evidence |
|---|---|---|
| Generic signal ingestion API (`POST /internal/signals`) | **VERIFIED IMPLEMENTED**, service-auth-gated, idempotent (unique `(source, source_event_id)`) | `artifacts/api-server/src/routes/signals.ts`, `services/signals.ts`, comment "GTM V2 Unit 2" |
| RB2B, Dealfront, HubSpot, Cognism, Salesforge, Dripify, Retell, ad platforms | **NOT BUILT / NO CODE** | Zero references anywhere under `artifacts/api-server/src`; mentioned only as future Package 8–9 scope in `ROADMAP.md` prose |
| n8n (outbound: GTM → n8n activate/decision/action/config) | **PARTIAL / WIRED** — real HTTP client with shared-secret auth; live reachability of the configured `N8N_BASE_URL` unverified | `artifacts/api-server/src/routes/n8n.ts:70-117, 210-419` |
| n8n (inbound: signal ingestion meant to be called by n8n or another service) | **WIRED** at the code level; whether any live n8n workflow actually calls it is **UNKNOWN / REQUIRES RUNTIME VERIFICATION** | `middlewares/requireServiceAuth.ts`, `routes/signals.ts` |
| CSV / manual import | **NOT FOUND** in `artifacts/api-server/src` or `artifacts/druid-gtm/src` during this audit | — |
| Client Radar (research submission/status/result) | **PARTIAL / WIRED** — real client, real persistence, no candidate-fact bridge (see §K) | `artifacts/api-server/src/lib/clientRadarClient.ts` |
| Historical n8n ICP pipeline (`ICP 01/02v2/03v2`, `ICP Account Shadow`, `GTM Config`) | **LIVE per `docs/icp-rule-discovery.md`'s 2026-vintage n8n API inspection** (not re-verified by this audit) — this is the pre-GTM-V2 production scoring path this repository's `ROADMAP.md` describes migrating away from (Next Delivery Sequence #3) | `docs/icp-rule-discovery.md:20-24, 94-98` |

---

## F. Signal → canonical company resolution trace — EXPECTED vs ACTUAL

**Pipeline as actually implemented (verified from `identityResolution.ts`'s exported functions, its 30-test unit suite executed live during this audit, and the schema it writes to):**

```
POST /internal/signals (signals.ts)
  → validate + normalize against lib/identity's NormalizedSignalV1Schema
  → INSERT signals row (no account_id/person_id — append-only evidence)
      ↓
POST /internal/signals/:signalId/resolve (signalResolution.ts, identityResolution.ts)
  → buildCompanyIdentifierPairs: domain, then external_id pairs, deterministic order
  → match against account_aliases (strong aliases only, per normalization strategy)
      - match found  → account_resolved (existing account)
      - no match, but company evidence present → creates a new account + strong alias
      - no company evidence at all → unresolved, no account created
      - domain and external-id aliases point to DIFFERENT existing accounts → unresolved,
        classified as "account_identifier_conflict" (never silently picks one)
  → if account resolved, additionally attempt person matching (email, then external id)
      - match/create a `people` row only when resolution_level IN ('contact','known_crm_contact')
        (DB-CHECK-enforced — "company intelligence never manufactures a contact")
      - INSERT/UPDATE account_people (upsert on (account_id, person_id))
  → INSERT identity_resolution_events row (complete binding snapshot; replay of an
    identical binding performs NO write at all — verified by the passing test
    "exact replay ignoring created-vs-matched: performs NO write query at all")
```

**Identifier classification (per audit instructions):**

| Identifier | Status |
|---|---|
| Company domain | **Implemented and actively used** — `account_aliases`, `normalization_strategy='domain'`, strong |
| Provider/external company ID | **Implemented and actively used** — `account_aliases`, `normalization_strategy` case-sensitive or case-insensitive per row, strong |
| Company name only | **Implemented but explicitly non-resolving** — weak alias only, never creates a strong match; a company-name-only signal remains `unresolved` (verified by passing test "company-name-only: unresolved, no account created") |
| Work email domain | **Implemented and actively used** — same domain-alias path as company domain |
| Person work email | **Implemented and actively used** — strong person match key (`people.work_email` unique) |
| Person external/provider ID | **Implemented and actively used** — `people.external_id`/`external_id_source` composite unique |
| LinkedIn URL | **Schema-only** — `people.linkedin_url` column exists; no test or resolution-path evidence found that any producer currently populates or matches on it during resolution |
| CRM company ID (HubSpot) | **Schema-only in the evaluator's input contract** (`NormalizedCrmV1Schema`) — not found wired into `identityResolution.ts`'s matching logic itself |

**Duplicate-account risk — corrected in this pass.** The original version of this document stated the risk as "a company first seen by weak name, later by strong domain, may become two accounts." **That is incorrect and has been retracted:** `buildCompanyIdentifierPairs` (`identityResolution.ts:192-208`) only ever builds match/create pairs from `company.domain` and `company.externalIds` — a company **name** is never included. `planAccountResolution` (`identityResolution.ts:557-627`) returns `unresolved` immediately, before any account lookup or creation, whenever `pairs.length === 0` (line 563-565) — i.e. whenever the signal carries no domain and no external ID. **A company-name-only (weak-identifier-only) signal can never create an account in the GTM V2 resolver, full stop** — verified directly by the passing unit test `"company-name-only: unresolved, no account created, no alias/account queries at all"` (re-run live in this pass, see §B).

The real, verified duplicate-account mechanisms are two, both requiring **two different strong identifiers**, never a weak one:

1. **A pre-existing account created outside the GTM V2 resolver (e.g. `bootstrapProductionData.ts`) has no matching `account_aliases` row for a later signal's strong identifier.** `bootstrapProductionData.ts` (lines 160-166) inserts directly into `accounts` (`accountKey`, `companyDomain`, `companyName`) but creates **no `account_aliases` row at all**. `planAccountResolution`'s only non-alias fallback (`identityResolution.ts:582-588`) matches a bare `accounts` row by `accountKey`/`companyDomain` — but **only when the incoming signal itself carries a `company.domain`** (`if (company.domain) { ... }`, line 582). So: a bootstrap-created account *with* a `companyDomain` set is correctly found by a later domain-carrying signal (confirmed by the passing test `"legacy dom:<domain> account with no alias is reused"`) — but if that same company is later identified only by a non-domain strong identifier (a provider `external_id`, e.g. a HubSpot company ID), there is no domain in the incoming signal to trigger the fallback, no alias row to match against, and `planAccountResolution` falls through to `distinctAccountIds.size === 0` → **creates a second account** (line 614-626).
2. **Two different strong identifier types for the same real company, with no signal ever carrying both together.** If a company is first seen via a domain-only signal (creating Account A + a `domain` alias) and later via an external-ID-only signal from a different source with no domain (e.g. only a CRM ID, no site-visit domain), `planAccountResolution` finds no alias overlap with Account A and creates Account B. No code anywhere cross-links a `domain` alias and an `external_id` alias for the same real-world company after the fact.

In both cases, **the trigger is two strong identifiers never being linked** — not a weak identifier being treated as sufficient for creation. No automatic account-merge mechanism exists anywhere in this codebase to reconcile either case after the fact (`identity_resolution_events.ts`'s own comment: "does NOT model alias reassignment or account-merge auditing," lines 21-24). This is a real, citable, deliberate scope boundary (confirmed in code comments as intentional, not an oversight), but it is a narrower and different mechanism than originally stated.

---

### A. IMPLEMENTED CONTRACT vs. B. UNVERIFIED LIVE BRIDGE

The sections above (and §I) prove **A — the implemented contract**: *"if a correctly-shaped `NormalizedSignalV1` payload reaches `POST /internal/signals` and is then resolved, the canonical account/person-binding logic is correct — verified by 30+ passing unit tests covering domain/external-id matching, conflict detection, person matching, and idempotent replay."*

They do **not** prove **B — a live bridge**: *whether any current operational signal source (RB2B, Dealfront, a legacy n8n workflow, or anything else) is actually normalized into that shape and delivered to that endpoint today.* See DISC-07 immediately below — this is a distinct, unresolved question, and this audit's evidence for A must not be read as evidence for B.

### EXPECTED / ACTUAL / CAUSE / IMPACT / FIX — signals do not reach evaluation

**EXPECTED** (per `ROADMAP.md`'s architecture and the evaluator's own `NormalizedEngagementV1Schema`/`intent` rule dimension): resolved signals and identified people associated with a canonical account should be able to influence that account's Intent score.

**ACTUAL:** `evaluateAndPersist` (`lib/evaluator-persistence/src/evaluateAndPersist.ts:90-95`) reads only `account_snapshots`, `icp_profile_versions`, `evaluator_versions`. The only production writer of `account_snapshots`, `createCurrentAccountSnapshot` (`artifacts/api-server/src/services/icpEvaluationResolvers.ts:229-269`), builds its `normalizedInput` via `buildNormalizedAccountInputFromAccountAndFacts` (lines 164-194), which spreads a `base` object from `buildNormalizedAccountInputFromAccount` (lines 106-150) that **hardcodes** `engagement: { sources: [], pagesVisited: [], distinctSourceCount: 0, repeatVisit: false, lastSeenAt: null }` and `contact: null`, with the comment *"No engagement source exists to surface contact evidence from."* Only `company.*` fields are ever overridden, and only from `account_facts`.

**CAUSE:** No code path anywhere in `artifacts/api-server/src` or `lib/evaluator-persistence` queries `signals`, `identity_resolution_events`, `account_people`, or `account_aliases` when building evaluation input. This is confirmed as a known, explicit scope boundary, not an oversight: the calling route's own header comment states plainly *"deriving its input entirely from the account's own current state (no signals, contact, or CRM data exists yet...)"* (`artifacts/api-server/src/routes/accountIcpEvaluations.ts:4-6`). Separately, even a future writer could not simply insert signal-derived facts into `account_facts` — the `account_facts_source_is_manual_operator_v1` DB CHECK (`0006_add_account_facts.sql:13`) blocks any `source` value other than `'manual-operator-v1'`.

**IMPACT:** All of GTM V2 Stages 1–3 (signal ingestion, identity resolution, attention items) currently have **zero effect** on ICP fit/intent scoring. An account can have any number of resolved signals, associated people, and open attention items and still evaluate identically to an account with none. Intent scoring today is entirely a function of the evaluator's config against a snapshot whose only real input is manually-entered company facts (industry/country/region/employee range/revenue range) — none of which are behavioral/intent signals by nature.

**FIX (smallest correct architectural fix, not attempted by this audit):** This requires a product decision before implementation, not just code: is Intent meant to be derived from aggregated `signals`/`account_people`/`identity_resolution_events` activity (matching the schema's evident intent, given `NormalizedEngagementV1Schema`'s exact shape), or from a to-be-built separate aggregation/enrichment layer? Once decided, the smallest correct fix is a new snapshot-input builder (parallel to `buildNormalizedAccountInputFromAccountAndFacts`) that queries `signals`/`identity_resolution_events` for the account and populates `engagement`/`contact` accordingly — `account_facts`'s manual-only CHECK does not need to change for this, since engagement/contact are separate `NormalizedAccountInputV1` fields, not `account_facts` fields.

**FILES:** `artifacts/api-server/src/services/icpEvaluationResolvers.ts:106-269`, `artifacts/api-server/src/routes/accountIcpEvaluations.ts:1-30`, `lib/evaluator-persistence/src/evaluateAndPersist.ts`, `lib/evaluator/src/types.ts:68-83` (target schema), `lib/evaluator/src/rules/intent.ts` (consumer).

---

## G. Shadow / multi-person aggregation trace

- **Multiple people per account:** `account_people` supports this natively (many rows per `account_id`, unique per `(account_id, person_id)`). Write path confirmed directly in `identityResolution.ts:873-876` (`insert(accountPeople)...onConflictDoUpdate`). **VERIFIED IMPLEMENTED.**
- **Anonymous/company-level signals associated with an account:** every resolved `signals` row produces an `identity_resolution_events` row whose `account_id` is set even when no person is identified (`outcome='account_resolved'`, `resolution_level='company'`). **VERIFIED IMPLEMENTED** as an association mechanism (the signal row itself still carries no `account_id` — the association lives only in `identity_resolution_events`).
- **Duplicate accounts:** possible, not prevented — see §F.
- **Orphaned/unresolved signals reattached later:** **NOT BUILT.** `signals` rows carry no FK to fix later; a new `identity_resolution_events` row can be appended for the *same* `signal_id` in principle (nothing schema-level prevents re-resolving), but no service/route in this codebase was found that re-runs resolution for a previously-unresolved signal — `POST /internal/signals/:signalId/resolve` is only exercised once per signal in the code paths audited.
- **Parent/subsidiary company relationships:** **NOT BUILT.** No column, table, or code reference found.
- **Aggregation timing:** write-time only (each resolution event is computed and persisted as signals arrive); there is no query-time aggregation layer, and — per §F — no consumer reads the aggregate at evaluation time either.
- **Does aggregated activity feed evaluation?** **NO — see §F.** This is the single most important negative finding of this audit. Classify GTM V2's signal/identity/aggregation work as **PARTIAL / NEEDS FIX** relative to its evident architectural intent: the ingestion→resolution half is complete and correct; the resolution→evaluation half does not exist.

---

## H. ICP / multi-ICP implementation matrix

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Storing multiple ICP profiles | **COMPLETE** | `icp_profiles` has no cardinality constraint; nothing in schema or service limits row count |
| 2 | Editing/configuring profiles | **COMPLETE** | Draft version CRUD via `icpProfiles` service/routes; frontend `settings-icp-profiles.tsx`, `icp-profile-detail.tsx` |
| 3 | Publishing/versioning profiles | **COMPLETE** | `icp_profile_versions.status` draft→published one-way, DB trigger-enforced |
| 4 | Immutable profile versions | **COMPLETE** | `icp_profile_versions_immutable_after_publish` trigger, `0001_integrity_triggers.sql` |
| 5 | Selecting one profile for evaluation | **COMPLETE** | `POST /accounts/:accountId/icp-evaluations{,/official}` body is `{ profileId }` only, `.strict()` — `accountIcpEvaluations.ts:60-63` |
| 6 | Evaluating an account against one selected profile | **COMPLETE** | `runPreviewIcpEvaluationForAccount` / `runOfficialIcpEvaluationForAccount`, `accountEvaluations.ts` |
| 7 | Assigning relevant ICPs automatically to an account | **NOT BUILT** | No account-to-profile assignment table or logic found |
| 8 | Evaluating one account automatically against multiple profiles | **NOT BUILT** | No code path triggers more than one profile evaluation per request |
| 9 | Retaining multiple concurrent ICP evaluations | **COMPLETE (as data)** — `account_evaluations` is insert-only and unrestricted in count per account, so history naturally accumulates across profiles if evaluated against more than one | `account_evaluations` schema |
| 10 | Comparing profile results | **NOT BUILT** | No "compare" functionality found in `artifacts/druid-gtm/src` (grepped `icp-profile-detail.tsx`, `settings-icp-profiles.tsx`) |
| 11 | Selecting/recommending a primary/best ICP | **NOT BUILT** | No "recommend"/"best profile" logic found anywhere |
| 12 | ICP-specific Intent interpretation | **NOT BUILT** (moot — see §F: no profile currently receives real intent input at all) | — |
| 13 | ICP-specific persona/actionability | **PARTIAL** — an `actionability` rule dimension exists in the evaluator (`lib/evaluator/src/rules/actionability.ts`) and is profile-config-driven, but nothing ties it to a specific "persona" concept beyond the single selected profile's own rules | `lib/evaluator/src/rules/actionability.ts` |
| 14 | ICP-specific routing | **NOT BUILT** (Phase 3 routing logic itself is not built at all — see §I) | `account_decisions.ts` comment: "Phase 3 — not yet built as logic" |
| 15 | Re-evaluation by profile when facts/signals change | **PARTIAL** — re-evaluation is signaled (via `evaluation_stale` attention items, §I) for `account_facts` changes only; not for signal/identity changes (which don't feed evaluation at all, per §F), and re-evaluation itself is still an explicit operator action, not automatic | `artifacts/api-server/src/services/accountFacts.ts:304-332` |

**Summary:** single-profile authoring, versioning, and evaluation is solid and complete. Everything describable as "multi-profile orchestration" (items 7, 8, 10, 11, 12, 14) is **NOT BUILT** — exactly matching `ROADMAP.md`'s own framing of this as future Package 7 / Next Delivery Sequence #5, "activating the forward-compatible schema already in place." That framing is accurate: the schema does not prevent multi-profile orchestration, but zero orchestration logic exists yet.

---

## I. Actual scoring / evaluation / routing behavior

**Evaluator dimensions found in `lib/evaluator/src/rules/*.ts`:** `fit.ts`, `intent.ts`, `identity.ts`, `eligibility.ts`, `actionability.ts`. Fit and intent are weighted/tiered rule sets (`scoring.ts`'s `evaluateScoredRuleSet`); eligibility is a separate gate (hard disqualifiers sit outside weighted scoring, matching `ROADMAP.md`'s stated architectural decision). One canonical, pure evaluator — no duplicated scoring logic found in the frontend or elsewhere (`icpEvaluationResolvers.ts` and `evaluateAndPersist.ts` are the only callers of `getEvaluatorImplementation`).

**INPUT → RULE → SCORE/STATE → DECISION, as actually wired:**

```
accounts + account_facts (manual-operator-v1 only)
  → createCurrentAccountSnapshot → account_snapshots (immutable)
      → evaluateAndPersist: NormalizedAccountInputV1 × IcpProfileConfigV1
          → lib/evaluator (fit/intent/eligibility/actionability rules)
              → account_evaluations row (fitScore/Tier, intentScore/Tier,
                eligibilityOutcome, matchedRules, missingInputs,
                scoreComponents, identityResolutionLevel/Confidence) — INSERT-ONLY
                  → [Phase 3 — account_decisions] NOT YET COMPUTED except MQL/Dismiss
                      (routing_output enum has 8 values: mql, sales_review,
                      pipeline_assist, owner_alert, retarget, nurture,
                      suppressed, dismissed — enums.ts comment explicitly:
                      "this table does not yet compute those values")
```

**MQL decision-readiness gate** (`lib/evaluator/src/mqlDecisionReadiness.ts`): a distinct, narrower check from fit/intent tiering — determines whether an *already-completed* production evaluation has enough evidence-backed rule resolution (only rules with `points > 0`) to support a "Promote to MQL" operator action. Never asserts a positive outcome itself; only whether the relevant conditions were resolvable from evidence-backed values.

**After evaluation completes — what actually happens automatically:**
- **VERIFIED IMPLEMENTED:** a completed *production* evaluation causally resolves any open `evaluation_stale`/`evaluation_failed`/`evaluation_missing_inputs` attention items for that account, via `applyProductionEvaluationLifecycleEffects` (`accountEvaluations.ts:272-331`) — comparison is causal (accountFactId identity, not timestamps), row-locked (`FOR UPDATE`) to close a genuine check-then-act race against a concurrent fact write.
- **NOT AUTOMATIC:** no evaluation automatically creates an MQL decision, recommends an action, or triggers any external execution. `createAccountEvaluation`/`runOfficialIcpEvaluationForAccount` are both explicit operator-triggered HTTP calls (`POST .../icp-evaluations/official`), never a background job.
- **Promote to MQL / Dismiss** are explicit, separately-called, persisted `account_decisions` writes (`accountDecisions.ts` service), gated by the DB trigger requiring a `completed`+`production` evaluation to exist first.

**Evaluation staleness lifecycle (GTM V2 Stage 4, Unit 1 — PR #41):** `recordAccountFact` (`accountFacts.ts:355-469`) raises an `evaluation_stale` attention item, sourced `"evaluation"`, whenever an accepted fact write touches a field the account's latest completed production evaluation's *frozen* `profileConfigSnapshot` actually references (`isAccountFactFieldReferencedInProfileConfig`, walks the fit-rule condition tree). No same-value suppression — every accepted write to a referenced field triggers, by design (fact *identity*, not just value, is meaningful elsewhere). **VERIFIED IMPLEMENTED**, well-tested.

---

## J. Attention / account workspace status

- **`attention_items` lifecycle:** **VERIFIED IMPLEMENTED**, DB-enforced. Creation is insert-first with `23505`-conflict reclassification into `duplicate`/`conflict` (`createAttentionItem`, `attentionItems.ts:309-370`) — genuinely race-safe, not check-then-insert. Resolution is a single conditional `UPDATE ... WHERE status='open'` (`resolveAttentionItem`, lines 476-504); no DELETE path exists anywhere, and the DB trigger additionally rejects DELETE unconditionally and any UPDATE shape other than the one well-formed `open→resolved` transition.
- **All Accounts vs Needs Attention:** **VERIFIED IMPLEMENTED as the same store, not parallel stores**, at the API layer. `listAccounts` (`accounts.ts:332-536`) takes a `needsAttention: boolean` argument that adds a correlated `EXISTS (SELECT 1 FROM attention_items WHERE account_id = accounts.id AND status='open')` filter to the exact same base query used for "All Accounts," applied identically to count and page queries. A batched `AccountAttentionSummary` (open count, oldest open item, reason codes) is attached per account via one GROUP BY query — no N+1.
- **Resolving attention never deletes account/evaluation/history** — confirmed both by the DB trigger (§D) and by `resolveAttentionItem`'s single-column `UPDATE`.
- **Product-surface gap:** as stated in §A, this entire read model is unconsumed by `artifacts/druid-gtm`. The live "Needs Attention" UI is built on the older Sheet+`accountDecisions.routingOutput` model (`needs-attention-view.tsx`). **Classify: backend VERIFIED IMPLEMENTED; frontend integration NOT BUILT.**
- **MQL/Dismiss decisions do NOT resolve attention items — verified, not assumed.** A repo-wide grep of `artifacts/api-server/src/services/accountDecisions.ts` for `attentionItem`/`attention_item` returns **zero matches**, and the file's own header comment states it explicitly: *"No automated routing/scoring policy engine, no outbound dispatch, no HubSpot/n8n/email/voice/Client Radar calls — every row this module writes represents exactly one already-made human decision."* Creating an `account_decisions` row (MQL or Dismiss) has no effect whatsoever on any open `attention_items` row. **Consequence for frontend wiring:** the old frontend's local-state rule ("hide a row once its latest decision is `mql`/`dismissed`," `needs-attention-view.tsx:210-230`) is incompatible with the canonical model once wired — an account can be MQL'd/Dismissed while still carrying an open, unrelated attention item (e.g. `evaluation_stale`), and the canonical model says it still needs attention. This is not resolved by any code found in this audit; see DISC-08 and `NEXT_SESSION.md`.
- **The attention-item *resolve* endpoint cannot currently be called by the browser-session frontend at all.** `POST /internal/attention-items/:attentionItemId/resolve` is mounted behind `requireServiceAuth` (shared-secret header), not `requireAuth` (browser session) — confirmed in `routes/index.ts:43-52`. Only the *read* side (`GET /internal/accounts?needsAttention=true`, `requireAuth`-gated) is reachable from the product frontend today. An operator-facing "resolve this attention item" UI control cannot be added without either a new `requireAuth`-gated resolve route or another mechanism — this is a real, citable backend gap, not a frontend implementation detail.

---

## K. Client Radar full lifecycle status

**Scope note:** this audit inspected only `druid-gtm-control` (this repository). Client Radar is confirmed to be a genuinely separate repository and deployment (`ROADMAP.md`'s own framing, not contradicted by anything found here). **Every status below describes the Mission-Control (this repo's) side of the integration only** — the GTM-side handoff contract, HTTP client, status/result handling, persistence, evidence rendering, and account-alias mapping. **None of it certifies the separate Client Radar repository's own internal implementation, code quality, or currently-deployed runtime behavior** — that was not audited and is **UNKNOWN / REQUIRES RUNTIME VERIFICATION** (or a separate audit of that repository) throughout this section.

| # | Item | Status (Mission Control side only) | Evidence |
|---|---|---|---|
| 1 | API client/scaffolding | **VERIFIED IMPLEMENTED** — real HTTP client, config-driven, strict parsing, not a mock | `artifacts/api-server/src/lib/clientRadarClient.ts` |
| 2 | Research-run persistence | **VERIFIED IMPLEMENTED** | `client_radar_research_runs` table, `clientRadarResearchRuns.ts` |
| 3 | Durable Client Radar account mapping | **VERIFIED IMPLEMENTED** (newest work, PR #43) — reuses `account_aliases`, race-safe insert-first with re-read classification | `clientRadarAccountAlias.ts:92-147` |
| 4 | Strong external alias handling | **VERIFIED IMPLEMENTED** | same file, `isStrong: true` |
| 5 | Identity-conflict handling | **VERIFIED IMPLEMENTED** — never remaps; reports `conflict` with the existing owner's account id; caller raises a `client_radar_identity_conflict` attention item | `clientRadarAccountAlias.ts:82-90`, `clientRadarResearchRuns.ts:443-490` |
| 6 | Research result persistence | **VERIFIED IMPLEMENTED** | `accountPayload`/`evidencePayload` jsonb columns |
| 7 | Evidence storage/view | **VERIFIED IMPLEMENTED**, including a live frontend panel | `client-radar-research-panel.tsx` (477 lines), mounted on `account-detail.tsx:178` |
| 8 | Candidate facts | **NOT BUILT** — no candidate/accepted distinction exists anywhere in `account_facts` | `accountFacts.ts` — `source` is unconditionally `MANUAL_OPERATOR_FACT_SOURCE` |
| 9 | Read-only candidate fact UI/API | **NOT BUILT** | — |
| 10 | Accept/reject candidate facts | **NOT BUILT** | — |
| 11 | Accepted fact provenance | **NOT BUILT** (moot — no accepted-fact concept exists) | — |
| 12 | Account-fact write path (from Client Radar) | **NOT BUILT** — explicitly confirmed by code comment: *"never accountFacts (this function never touches accountFacts)"* | `clientRadarResearchRuns.ts:612-613` |
| 13 | Stale-evaluation interaction (from Client Radar) | **NOT BUILT** (moot — no fact write path exists to trigger it) | — |
| 14 | Client Radar attention lifecycle | **PARTIAL** — only the identity-conflict case raises an attention item; nothing else about Client Radar (e.g. "research completed") does | `clientRadarResearchRuns.ts:443-490` |
| 15 | Re-research/refresh behavior | **PARTIAL** — `refreshClientRadarResearchRun` polls status for a non-terminal run; a partial unique index prevents starting a second concurrently-active run per account, but there's no explicit "refresh a completed/stale result" flow found | `clientRadarResearchRuns.ts:308-329` |
| 16 | Account/entity/country scoping | **PARTIAL** — `country`/`industry` are passed as submission hints (`SubmitClientRadarResearchInput`); no broader entity/multi-country scoping model found | `clientRadarClient.ts:178-183` |
| 17 | Frontend integration | **PARTIAL** — research trigger, status, and evidence display exist (`client-radar-research-panel.tsx`); no accept/reject or candidate-fact UI exists (moot, since the backend concept doesn't exist either) | — |

**Guardrail verification (code-level, not just prose):**
- **No silent identity remapping:** VERIFIED — `linkClientRadarAccountAlias` never updates an existing strong alias; conflicts are reported, never auto-resolved (`clientRadarAccountAlias.ts:82-90`).
- **No auto-accept facts:** VERIFIED (vacuously — no fact-write path exists at all from Client Radar).
- **No auto-MQL:** VERIFIED — MQL is only ever written via the explicit `account_decisions` write path, which is DB-trigger-gated on a completed production evaluation; nothing in the Client Radar code path touches `account_decisions`.
- **No auto-send outreach:** VERIFIED — no code in the Client Radar path calls `n8n.ts`'s activation routes.

---

## L. Actions / messages / provider execution status

The **older** `druid-gtm` frontend composer/action-modal stack (ROADMAP.md Package 1) is still live and wired to a real integration, not dead code:

- `message-composer.tsx` (336 lines): local, deterministic, non-LLM. No external AI-generation call.
- `action-modal.tsx` (598 lines) → `POST /api/n8n/activate` (`n8n.ts:70-117`): a real outbound HTTP call to `N8N_BASE_URL` with shared-secret auth. **Whether that URL is currently live/reachable is UNKNOWN / REQUIRES RUNTIME VERIFICATION.**
- **Truthful lifecycle distinction is real, enforced code, not just prose:** `lib/gtm-shared/src/gtmContract.js`'s `extractLifecycleProof` (line 724) and `buildLifecycleEnvelope` (line 815) are a strict allowlist over n8n's response — never trusting `provider_status`/`call_id`/arbitrary text directly. `action-modal.tsx:339-357` consumes this via `resolveLifecycleEvidence`, explicitly commented as sourcing "Server-confirmed artifact... ONLY from the whitelisted lifecycle." The system genuinely can and does distinguish accepted/forwarded from provider-confirmed — but the actual provider (SMTP/LinkedIn/dialer) call happens **inside n8n**, outside this repository's visibility, so "provider-confirmed" here means "n8n confirmed," not independently verifiable proof of an actual email/call/LinkedIn send.
- **No durable action/draft/outbox table exists in `lib/db/src/schema`.** Action/message state currently lives only in the n8n request/response cycle and frontend local state — a real, citable gap relative to `ROADMAP.md`'s Package 3 acceptance criteria ("Activation requests create durable records... Outbox state is separate from execution confirmation").

**Distinguish:** architecture/contracts = real and enforced (allowlist pattern); actual provider (email/LinkedIn/voice) execution = entirely outside this repository, unverifiable from code alone.

---

## M. n8n / integration boundary status

See §C and §E. Summary classification:

| Surface | Classification |
|---|---|
| n8n outbound (activate/decision/action/config) | PARTIAL/WIRED — real client, live reachability unverified |
| n8n inbound (GTM V2 signal ingestion, meant for n8n or another service) | WIRED at code level — no live caller confirmed |
| Legacy n8n ICP scoring pipeline (`ICP 01/02v2/03v2`, `ICP Account Shadow`, `GTM Config`) | LIVE per `docs/icp-rule-discovery.md` (2026-vintage inspection, not re-verified here) — this is the production scoring authority `ROADMAP.md` still describes as not yet migrated into the application (Next Delivery Sequence #3) |
| RB2B / Dealfront / HubSpot / Cognism / Salesforge / Dripify / Retell / ad platforms | NOT BUILT / NO CODE |
| CSV/manual import | NOT FOUND |

**No literal n8n workflow JSON file exists in this repository.** `lib/reference/server_n8n.js` is a small (62-line), unimported reference script, not a workflow export.

---

## N. Test / CI status

- **CI (`​.github/workflows/pr-checks.yml`) genuinely provisions a real `postgres:16` service container and runs migrations before tests** — DB-backed integration tests are not silently skipped in CI (comment in the workflow explicitly notes `DATABASE_URL` is set for this reason).
- **CI coverage gap, confirmed by cross-referencing `pr-checks.yml`'s test steps against `artifacts/api-server/package.json`'s full `test` script:** CI runs `test:signals`, `test:attention-items`, `test:accounts`, `test:evaluation-decision-lifecycle` — it does **not** run any Client Radar or ICP-profile test file (`clientRadarAccountAlias.*.test.ts`, `clientRadarResearchRuns.*.test.ts`, `icpProfiles*.test.ts`). PR #43 added ~1,300 lines including two integration test files and did not add a corresponding CI step. **These tests may pass locally but are not verified on every PR merge to `main`** — a real, citable CI-coverage gap.
- **This audit independently re-ran every DB-independent unit suite live** (see §B): 528/528 + 42/42 pass, zero failures, as of this audit's HEAD. DB-backed `.integration.test.ts` suites were not run (would require Postgres) — their current pass/fail status is unverified.
- **TODO/FIXME backlog:** a repo-wide grep found exactly one hit (`lib/api-client-react/src/custom-fetch.ts`, generated scaffolding, not architecturally significant). This codebase substitutes extensive "why" comments for TODO markers — a real strength, not a gap.
- **`tsc --build` (full workspace typecheck) is clean** as of this audit's HEAD (verified live).

---

## O. Discrepancy register

**DISC-01**
AREA: Roadmap documentation currency
SEVERITY: High (process risk, not a code defect)
EXPECTED: `ROADMAP.md` reflects `main`'s actual merged state.
ACTUAL: Explicitly scoped "as of PR #27" (`ROADMAP.md:31`); 16 more PRs merged since, including an entire undocumented "GTM V2" track.
EVIDENCE: `git log`, `ROADMAP.md:19-27, 31`, absence of "GTM V2" in any `.md` file.
IMPACT: Any planning done from `ROADMAP.md` alone silently ignores 10 already-shipped PRs and their actual current limitations.
RECOMMENDED FIX: This audit's roadmap update (see the canonical roadmap document) reconciles the two tracks.
ROADMAP EFFECT: Roadmap updated as part of this audit's deliverables.
STATUS: Addressed by this audit's documentation deliverables.

**DISC-02**
AREA: Signal/identity resolution → evaluation input
SEVERITY: Critical
EXPECTED: Resolved signals/people should be able to influence Intent scoring (per the evaluator's own `NormalizedEngagementV1Schema`/`intent` dimension).
ACTUAL: Evaluation input is built exclusively from `accounts` + manual-operator-only `account_facts`; `engagement`/`contact` are unconditionally hardcoded to empty defaults.
EVIDENCE: See §F in full — `icpEvaluationResolvers.ts:106-269`, `accountIcpEvaluations.ts:4-6`, `0006_add_account_facts.sql:13`.
IMPACT: All GTM V2 signal/identity/attention work has zero effect on scoring today.
RECOMMENDED FIX: See §F FIX — requires a product decision first, then a new snapshot-input builder.
ROADMAP EFFECT: Should become an explicit, named unit in the roadmap (currently invisible — not mentioned anywhere).
STATUS: Open, unaddressed in code as of this audit.

**DISC-03**
AREA: GTM V2 backend → frontend product surface
SEVERITY: Critical (four already-merged, tested PRs currently produce zero user-visible effect)
EXPECTED: `Needs Attention` reflects the canonical `attention_items` read model built in Stage 3.
ACTUAL: The live frontend view runs entirely on the pre-GTM-V2 Sheet+`accountDecisions` model; zero references to the new read model anywhere in `artifacts/druid-gtm/src`.
EVIDENCE: `needs-attention-view.tsx:40, 147-230`; grep for `needsAttention`/`AccountAttentionSummary`/`attentionItems` in `artifacts/druid-gtm/src` returns nothing.
IMPACT: Operators do not see any GTM V2 Stage 3/4 attention signal (evaluation staleness, identity-resolution attention, Client Radar identity conflicts) in the product today, even though the backend fully computes and persists it.
RECOMMENDED FIX: Wire the frontend "Needs Attention" view to `GET /internal/accounts?needsAttention=true` and `AccountAttentionSummary`. This is this audit's recommended single next implementation unit — see §S.
ROADMAP EFFECT: Should be the immediate next item under "Next Delivery Sequence #1" (canonical operational workspace migration).
STATUS: Open.

**DISC-04**
AREA: Client Radar → account facts
SEVERITY: Medium (matches `ROADMAP.md`'s own "not yet started" framing for Package 6 — not a surprise, but worth making explicit and precise)
EXPECTED (per `ROADMAP.md` Package 6 scope): Client Radar findings should eventually enrich `message_context`/account facts with provenance.
ACTUAL: Zero code path connects Client Radar evidence to `account_facts`; the write function is explicitly commented as never touching it.
EVIDENCE: `clientRadarResearchRuns.ts:612-613`.
IMPACT: None yet — this is future, not-yet-started scope, correctly labeled as such by `ROADMAP.md`. Recorded here for precision, not as a surprise finding.
RECOMMENDED FIX: N/A — correctly scoped as future work already.
ROADMAP EFFECT: None — matches existing roadmap framing.
STATUS: Confirmed as accurately NOT-yet-started (not a discrepancy from the roadmap's own claims).

**DISC-05**
AREA: CI coverage
SEVERITY: Medium
EXPECTED: Every test file added by a merged PR is exercised by CI on every subsequent PR.
ACTUAL: Client Radar and ICP-profile test files are never invoked by `pr-checks.yml`.
EVIDENCE: §N.
IMPACT: Regressions in Client Radar/ICP-profile code could merge to `main` undetected by CI.
RECOMMENDED FIX: Add a `test:client-radar` / `test:icp-profiles` script and a corresponding CI step, mirroring the existing `test:signals`/`test:attention-items` pattern.
ROADMAP EFFECT: Small, cross-cutting fix; not a roadmap stage.
STATUS: Open.

**DISC-06** *(corrected in the 2026-08-18 pass — mechanism was previously misstated; see §F)*
AREA: Duplicate canonical accounts
SEVERITY: Medium
EXPECTED: One real company maps to one canonical account.
ACTUAL: A weak identifier (company name alone) can never create an account (verified — see §F); however, (1) a pre-existing account created outside the resolver (e.g. bootstrap) with no matching `account_aliases` row, or (2) two different strong identifiers for the same company that never co-occur on one signal, can each independently cause a second account to be created. No merge mechanism exists for either case.
EVIDENCE: `identityResolution.ts:192-208` (`buildCompanyIdentifierPairs`, domain/externalIds only), `identityResolution.ts:557-627` (`planAccountResolution`), `bootstrapProductionData.ts:160-166` (no alias row created), `identityResolutionEvents.ts:21-24` (no merge/reassignment modeled).
IMPACT: Fragmented signal/evaluation history for a subset of accounts; not observable without production data (see §T).
RECOMMENDED FIX: An explicit account-merge operation — deliberately deferred per the schema's own comments, not a bug.
ROADMAP EFFECT: Should be named explicitly as a known limitation, not silently absent from planning.
STATUS: Open, by design (deferred), not yet named in any roadmap document before this audit.

**DISC-07**
AREA: Operational provider/n8n → GTM V2 normalized signal bridge
SEVERITY: Critical — this is prior to, and arguably more consequential than, DISC-02: DISC-02 assumes signals reach the resolver and asks whether resolved data reaches evaluation; DISC-07 asks whether any real signal reaches the resolver at all today. If it does not, DISC-02 is moot for current operations, and the specific concern that motivated this audit ("signals are stored but don't resolve to companies") remains genuinely open rather than disproved.
EXPECTED: Operational signals (from RB2B, Dealfront, a legacy n8n workflow, or any other current source) reach `POST /internal/signals` in the `NormalizedSignalV1` shape and are resolved to canonical accounts.
ACTUAL: The repository contains the generic ingestion/resolution contract (§F, verified correct by 30+ passing tests) but zero provider-specific adapters (RB2B/Dealfront/Cognism/Salesforge/Dripify/Retell — confirmed absent, see §E), and a repo-wide search for any caller of `/internal/signals` outside the route's own definition, its own tests, and its own comments returns zero matches. No live n8n workflow execution or runtime `signals` table rows were inspected (out of this audit's constraints).
EVIDENCE: `grep -rn "'/internal/signals'\|\"/internal/signals\"\|/api/internal/signals"` across the repository (excluding the route definitions and their own tests/comments) returns no caller; `grep -rli "RB2B\|Dealfront\|Cognism\|Salesforge\|Dripify\|Retell"` matches only comments, mock/sample data, and evaluator-contract vocabulary, never adapter code; `docs/icp-rule-discovery.md`'s live n8n workflow inventory (a prior, separate inspection, not re-verified by this audit) describes the *legacy* scoring pipeline, not any caller of the GTM V2 signal API.
IMPACT: The user-observed concern that motivated this audit — "people/signals are not resolving to companies" — has **not been disproved**. The canonical resolver may be entirely correct while the live upstream bridge into it is absent, partial, or miswired. Any planning that assumes "GTM V2 signal ingestion is live" is currently unsupported by repository evidence.
RECOMMENDED FIX: Do not implement a bridge yet. First perform an explicitly-approved runtime/integration verification: trace one real signal end-to-end — provider/n8n source → payload normalization → `POST /internal/signals` → stored `signals` row → `identity_resolution_events` row → canonical account/person binding — against a named, approved environment. Only after that verification should any bridge-building or bridge-fixing work be scoped.
ROADMAP EFFECT: Must become an explicit verification unit, sequenced before any further signal-architecture work is assumed complete. See §R/§S and `NEXT_SESSION.md`.
STATUS: UNKNOWN / REQUIRES RUNTIME VERIFICATION — no live caller is proven by this repository.

**DISC-08**
AREA: Needs Attention membership vs. MQL/Dismiss decisions
SEVERITY: High
EXPECTED: An account's presence in "Needs Attention" is determined solely by whether it has an open `attention_items` row; an operator action should never independently override that in frontend-local state.
ACTUAL: `accountDecisions.ts` (the MQL/Dismiss write path) never touches `attention_items` (verified — zero matches, see §J); the *old* frontend's now-superseded local rule hid a row once its latest decision was `mql`/`dismissed`, regardless of open attention items. Additionally, the attention-item resolve endpoint (`POST /internal/attention-items/:id/resolve`) is `requireServiceAuth`-gated, not `requireAuth` — the browser-session frontend cannot call it at all today.
EVIDENCE: `accountDecisions.ts` (no attention-item reference, header comment), `needs-attention-view.tsx:210-230` (old local-state rule), `routes/index.ts:43-52` (resolve endpoint auth boundary).
IMPACT: If the old local-state hiding rule were carried forward unchanged onto the new canonical read model, an account with an open, unresolved attention item (e.g. `evaluation_stale`) that gets MQL'd would silently disappear from "Needs Attention" in the frontend while the backend still considers it open — a real, product-visible correctness regression, not merely stale wording.
RECOMMENDED FIX: The frontend must treat canonical open `attention_items` (via `needsAttention`/`AccountAttentionSummary`) as the sole source of truth for membership, refetching after any account-decision action rather than applying independent local-state removal logic. Whether operators additionally need a way to *resolve* an attention item from the product UI (requiring a `requireAuth`-gated resolve route that doesn't yet exist) is a separate, narrower follow-up decision — not required to satisfy the membership invariant itself.
ROADMAP EFFECT: Narrows and corrects the scope of the previously-recommended "Needs Attention" frontend-wiring unit — see `NEXT_SESSION.md`.
STATUS: Open — not yet implemented in code as of this audit; the correction is documentation-only pending decision.

---

## P. Technical debt / temporary scaffolding

- No significant `TODO`/`FIXME` backlog (§N).
- `lib/reference/server_n8n.js` — small, unimported legacy script; harmless but should eventually be deleted or documented as intentionally retained reference material.
- `replit.md` is actively misleading if read today (states DB "not yet used") — should be corrected or retired now that this audit's documents exist.
- No dead V1 code was found actively influencing V2 logic — the older `druid-gtm` composer/action-modal/n8n-proxy stack (§L) is legacy relative to GTM V2's naming but is still the **only** live action-execution path in the product; it is not dead code.

---

## Q. Roadmap verification / reclassification

The GTM V2 stage/unit structure below was reconstructed entirely from code/migration comments (`grep -rn "GTM V2 Stage\|GTM V2 Unit"`) — **it exists nowhere in any markdown file** prior to this audit.

| Stage.Unit | PR | Title (from code comments) | This audit's verified status |
|---|---|---|---|
| Unit 1 | #34 (`2b924ba`) | Operational identity and signal foundation (schema: `signals`, `identity_resolution_events`, `account_aliases`, `account_people`, `people`) | **VERIFIED IMPLEMENTED** |
| Unit 2 | #35 (`59fd6d0`) | Idempotent signal ingestion API | **VERIFIED IMPLEMENTED** |
| Unit 3 | #36 (`5c1e49e`) | Deterministic runtime identity resolution | **VERIFIED IMPLEMENTED** (30/30 relevant unit tests pass live) |
| Stage 2, Unit 4 | #37 (`55ee394`) | Current identity binding read model | **VERIFIED IMPLEMENTED** |
| Stage 3, Unit 1 | #38 (`2223679`) | Attention item lifecycle model (schema) | **VERIFIED IMPLEMENTED** |
| Stage 3, Unit 2 | #39 (`1cee0a8`) | Attention item service API (create/resolve write paths) | **VERIFIED IMPLEMENTED** |
| Stage 3, Unit 3 | #40 (`17d8b2a`) | Account attention read models | **VERIFIED IMPLEMENTED (backend)**; **NOT BUILT (frontend)** — DISC-03 |
| Stage 4, Unit 1 | #41 (`cb20f1c`) | Evaluation staleness lifecycle | **VERIFIED IMPLEMENTED** |
| Stage 4, Unit 2 | #42 (`7e01db5`) | Evaluation resolution lifecycle | **VERIFIED IMPLEMENTED** |
| Stage 5, Unit 1 | #43 (`4a34112`) | Durable Client Radar account mapping | **VERIFIED IMPLEMENTED** — see §K |

**`ROADMAP.md`'s existing stages/packages, re-verified against current `main`:**

| Package | ROADMAP.md's claimed status | This audit's verification | Reclassified? |
|---|---|---|---|
| 1. Business Truth & Activation Composer Foundation | ✅ Completed | **CONFIRMED** — `action-modal.tsx`/`message-composer.tsx`/`gtmContract.js` truthful-lifecycle logic verified live in §L | No change |
| 2. Canonical Account Evaluation & Configurable ICP Profiles (Phases 0-2, account-level UI) | ✅ Substantially delivered | **CONFIRMED for single-profile authoring/evaluation** (§H items 1-6); Phase 3 routing confirmed partial (MQL/Dismiss only, per the schema's own comment) exactly as claimed | No change, but see DISC-02 — the roadmap does not mention that Intent input itself is currently disconnected from any real signal |
| 3. Persistent Canonical Records and Leads Workspace | ▶️ Next (canonical-records foundation delivered) | **CONFIRMED** foundation delivered; full queue/views breakdown still open, and additionally now needs to account for wiring the already-built attention_items backend (DISC-03) | Should be re-scoped to include DISC-03 explicitly |
| 4. Client Radar Handoff & Opportunity Intake | ✅ Completed | **CONFIRMED**, plus significant additional GTM V2 Stage 5 work (account mapping) not reflected in the roadmap at all | Roadmap should be updated to reflect Stage 5 |
| 5. Server-to-Server Client Radar API and Status Synchronization | ✅ Completed | **CONFIRMED** | No change |
| 6. Evidence-Backed Client Radar Composer Enrichment | ▶️ Next, not started | **CONFIRMED not started** — DISC-04 | No change (roadmap already accurate here) |
| 7. Multi-Profile Assignment & Comparative Evaluation | Not started | **CONFIRMED not started** — §H items 7,8,10,11 | No change |
| 8-15 | Title/position only | Not independently re-verified beyond confirming no code exists for any of them | No change |

**Cross-cutting fixes surfaced by this audit that do not belong to any single package above (do not let them disappear because their nominal package is "complete"):** DISC-02 (signals→evaluation), DISC-03 (attention backend→frontend), DISC-05 (CI coverage), DISC-06 (duplicate accounts, mechanism corrected in this pass), DISC-07 (operational signal bridge unproven), DISC-08 (Needs Attention membership vs. MQL/Dismiss).

---

## R. Recommended implementation order

Sequenced by product correctness, not merely smallest engineering effort — three distinct kinds of next step, run largely in parallel rather than strictly serially:

**A. Next implementation unit (safe to build now, engineering-only):**
1. **Wire the frontend "Needs Attention" *membership/read* path** to `GET /internal/accounts?needsAttention=true` + `AccountAttentionSummary` (DISC-03), scoped per DISC-08's correction (canonical open-attention-items membership only; do not carry forward the old MQL/Dismiss local-state hiding rule). See §S.

**B. Next verification gate (must happen before trusting the signal architecture, not an implementation task):**
2. **Runtime-verify the operational provider/n8n → GTM V2 signal bridge** (DISC-07) — trace one real signal end-to-end against a named, approved environment. This does not block unit A (A is frontend-only and independent of where signals come from), but it must happen before anyone assumes GTM V2 signal ingestion is operationally live.

**C. Next product decision (requires a human decision, not scoping work):**
3. **Decide what should feed Intent scoring** (DISC-02) — architecturally the most consequential open question, but cannot be scoped as an implementation unit until a human decides what "Intent" should be derived from. Should happen after, or in light of, gate B — there is little value deciding what signal data should feed Intent before confirming any signal data reliably arrives at all.

**D. Small, mechanical, unordered relative to the above:**
4. **CI coverage fix** (DISC-05) — add the missing Client Radar/ICP-profile test steps.

**E. Then:** continue `ROADMAP.md`'s "Next Delivery Sequence" from #1 (remaining operational queues) onward, now informed by DISC-02/03/06/07/08.

---

## S. Single next implementation unit (recommended)

**Wire the frontend "Needs Attention" *membership* view to the already-built GTM V2 attention read model — read-only, per DISC-08's corrected scope.**

- Replace `needs-attention-view.tsx`'s Sheet+`accountDecisions`-derived filtering with a call to `GET /internal/accounts?needsAttention=true`, consuming the existing `AccountAttentionSummary` (open count, oldest open item, reason codes) already returned by `accounts.ts:332-536`.
- No backend or schema change required for this narrowed scope — read-only consumption of an existing, tested, DB-verified contract.
- **Do not** carry forward the old frontend's "hide once MQL'd/Dismissed" local-state rule (DISC-08) — canonical open `attention_items` is the sole membership signal; refetch after any account-decision action rather than judging locally.
- **Explicitly out of scope for this unit:** any "resolve this attention item" UI control — the resolve endpoint is `requireServiceAuth`-gated and unreachable from the browser session today (DISC-08); adding one is a separate, later backend decision.
- Concrete acceptance bar: an account with an open `attention_items` row (any `source`/`reason_code`) appears in "Needs Attention," including one that was just MQL'd/Dismissed while an unrelated attention item remains open; resolving the underlying attention item (by whatever mechanism — not built by this unit) removes the account from the view without deleting any history; an account with only a resolved/no attention item does not appear.
- **In parallel, not as a prerequisite:** DISC-07's runtime verification (§R) should happen around the same time, since it bears on whether the attention data this unit displays reflects real operational signals yet.
- Full detail in `NEXT_SESSION.md`.

---

## T. Evidence index

**Key files (schema):** `lib/db/src/schema/{accounts,accountSnapshots,accountEvaluations,accountDecisions,accountFacts,accountFactCurrent,accountAliases,accountPeople,people,signals,identityResolutionEvents,attentionItems,clientRadarResearchRuns,icpProfiles,icpProfileVersions,enums}.ts`

**Key migrations:** `lib/db/drizzle/0001_integrity_triggers.sql` (all core immutability/pointer triggers), `0006_add_account_facts.sql` (manual-only source CHECK), `0009_signals_identity_resolution_immutability.sql`, `0011_attention_items_lifecycle.sql`

**Key services:** `artifacts/api-server/src/services/{identityResolution,accountEvaluations,accountFacts,accounts,attentionItems,clientRadarAccountAlias,clientRadarResearchRuns}.ts`, `artifacts/api-server/src/services/icpEvaluationResolvers.ts` (the central discrepancy's exact location), `lib/evaluator-persistence/src/evaluateAndPersist.ts`

**Key routes:** `artifacts/api-server/src/routes/index.ts` (full route/auth-boundary map — also the exact citation for DISC-08's resolve-endpoint auth boundary), `routes/accountIcpEvaluations.ts` (contains the self-documenting comment confirming DISC-02)

**Key files for DISC-06/07/08:** `artifacts/api-server/src/services/identityResolution.ts:192-208, 557-627` (`buildCompanyIdentifierPairs`, `planAccountResolution` — the corrected duplicate-account mechanism), `artifacts/api-server/src/scripts/bootstrapProductionData.ts:160-166` (no alias row created at bootstrap), `artifacts/api-server/src/services/accountDecisions.ts` (zero attention-item interaction)

**Key evaluator files:** `lib/evaluator/src/types.ts` (`NormalizedEngagementV1Schema`), `lib/evaluator/src/rules/intent.ts`, `lib/evaluator/src/mqlDecisionReadiness.ts`

**Key tests executed live during this audit:** `artifacts/api-server`'s full unit suite (528 tests), `@workspace/identity` (42 tests) — see §B for exact commands.

**Key docs:** `ROADMAP.md`, `docs/icp-rule-discovery.md` (n8n "shadow" workflow reference, predates GTM V2), `DEPLOYMENT.md`

**Key commits:** `5f866b0` (ROADMAP.md last substantive update), `2b924ba`..`4a34112` (GTM V2 track, PRs #34-#43), `511e418`/`cb28581` (ICP rule discovery docs, pre-GTM-V2)
