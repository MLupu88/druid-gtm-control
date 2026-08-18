# PROJECT_HANDOFF.md — DRUID GTM Mission Control

Durable, self-contained implementation-state reference. A fresh ChatGPT,
Claude Code, or Codex session should be able to read this file (plus
`ROADMAP.md` and `PROJECT_AUDIT.md`) and understand the project without any
prior conversation history. Generated from a full read-only repository audit
on 2026-08-18 — see `PROJECT_AUDIT.md` for full evidence and citations behind
every claim below.

**2026-08-18 correction pass applied.** A follow-up review flagged several imprecise claims in the original version of this document; all are corrected below (Client Radar↔GTM call path, the duplicate-account mechanism, "Stage 5 complete" wording, an added distinction between the implemented signal-resolution *contract* and the unverified live *bridge* into it, and a corrected "Needs Attention next unit" scope). See `PROJECT_AUDIT.md`'s own correction-pass note and DISC-07/DISC-08 for full evidence — this document only summarizes; it does not re-derive.

---

## Project identity

- **Repo path:** `/Users/mihailupu/Projects/druid-gtm-control`
- **Branch:** `main`
- **HEAD at generation time:** `4a341126a59cd33337a36af9be8f3d6088fc9333` ("GTM V2: add durable Client Radar account mapping (#43)", 2026-08-07)
- **Remote:** `origin` = `https://github.com/MLupu88/druid-gtm-control.git`, `main` = `origin/main` (no divergence)
- **Stack:** pnpm workspaces, Node 24, TypeScript 5.9; frontend React 19 + Vite + Tailwind + shadcn/ui (`artifacts/druid-gtm`); backend Express 5 (`artifacts/api-server`); PostgreSQL + Drizzle ORM (`lib/db`); Zod validation; Orval-generated typed API client.
- **Deployment model (per `DEPLOYMENT.md`, not independently re-verified by SSH during this audit):** manual Docker Compose on a single Hetzner host at `gtm.aiexperiments.eu`; production builds from its own local git checkout, not yet pull-based from the CI-published GHCR image. A separate static site, `gtm-action-web`, deploys independently to `actionweb.aiexperiments.eu` and does pull from GHCR.

---

## Product purpose

An internal review cockpit ("Mission Control") for a GTM signal engine: operators review canonically-resolved accounts, evaluate them against configurable ICP profiles, promote/dismiss them, and hand qualified accounts off to a separate research/enrichment product, **Client Radar** (separate repository and deployment). n8n is a broader GTM orchestration boundary used for other functions (legacy signal intake/scoring, outbound activation dispatch — see "Architecture" below) — it is **not** the call path to Client Radar, which is a direct, authenticated HTTP integration (corrected in this pass; see `PROJECT_AUDIT.md` §C). Legacy scoring/routing historically lived in Google Sheets + n8n workflows; this repository's multi-year roadmap is migrating that authority into the application.

---

## Current verified project state

Two architecture tracks coexist on `main` today, connected by shared schema but **not** by shared runtime data flow:

1. **The product-facing track** (`ROADMAP.md`'s "Historical Product State — Snapshot after PR #27" section, through PR #27, plus Package 2 Phase 3 MQL/Dismiss work through PR #33): canonical accounts, ICP profile authoring/versioning/single-profile evaluation, MQL/Dismiss decisions, Client Radar handoff/evidence display — all live in the `artifacts/druid-gtm` frontend against `requireAuth`-gated (browser session) `/internal/*` API routes.
2. **The "GTM V2" track** (PRs #34-#43, undocumented in any markdown file before this audit): signal ingestion, deterministic identity resolution, canonical attention items, evaluation staleness/resolution, and Client Radar account mapping. Its *code* is implemented at the API/service layer, service-auth-gated (`requireServiceAuth`, shared-secret header — meant for a service caller, not a browser), and **VERIFIED IN CODE to be disconnected from the frontend and from ICP evaluation input**. A separate, more fundamental question — **whether any real operational signal currently reaches this track's ingestion endpoint at all** — is **UNKNOWN / REQUIRES RUNTIME VERIFICATION**: no caller of `POST /internal/signals` was found anywhere in this repository (no frontend code, no script), and no provider-specific adapter (RB2B, Dealfront, etc.) exists. See "Signal → account resolution" and "Known bugs" below.

Every DB-independent unit test suite in the repository (`artifacts/api-server`: 528 tests; `@workspace/identity`: 42 tests) was executed live — most recently re-run during the 2026-08-18 correction pass, `528/528` in 8.87s and `42/42` in 1.18s wall time, both completing to a full `node:test` summary with `fail 0`. The full workspace typechecks cleanly (`pnpm exec tsc --build`, zero errors). DB-backed integration tests were not executed (would require a live Postgres instance).

---

## Roadmap status summary

See `ROADMAP.md` for the full canonical roadmap (now updated with a GTM V2 section and a corrections section) and `PROJECT_AUDIT.md` §Q for the package-by-package reverification. Short version:

- Package 1 (Business Truth & Activation Composer Foundation): ✅ confirmed complete.
- Package 2 (Canonical Evaluation & ICP Profiles): ✅ confirmed substantially delivered for single-profile authoring/evaluation; Phase 3 routing confirmed partial (MQL/Dismiss only, exactly as the roadmap already says); **Intent input is disconnected from any real signal — not previously documented**.
- Package 3 (Leads Workspace / operational queues): ▶️ next, foundation delivered; **should now also include wiring the already-built GTM V2 attention backend into the frontend**.
- Packages 4-5 (Client Radar handoff/API): ✅ confirmed complete for their original scope; substantial additional Client Radar work (Stage 5 account mapping) has landed under GTM V2, undocumented until this audit.
- Package 6 (Client Radar composer enrichment): confirmed genuinely not started — matches the roadmap's own label.
- Package 7 (Multi-profile orchestration): confirmed genuinely not started.
- Packages 8-15: title/position only, not independently re-verified beyond confirming no code exists.
- **The GTM V2 units built through Stage 5 Unit 1** (signal ingestion, identity resolution, attention items, evaluation staleness/resolution, Client Radar account mapping — the specific 10 units listed in `PROJECT_AUDIT.md` §Q, not "Stage 5" as a whole, which is not complete) are each individually **VERIFIED IMPLEMENTED IN CODE** at the backend/schema level. The three biggest open items are: (a) whether real operational signals currently reach this backend at all (**UNKNOWN / REQUIRES RUNTIME VERIFICATION** — see "Signal → account resolution" below), (b) Stage 3's zero frontend consumption, and (c) the signal→evaluation wiring gap.

---

## Architecture

- **Frontend** (`artifacts/druid-gtm`): React 19 + Vite + Tailwind + shadcn/ui. Consumes only session-authenticated (`requireAuth`) `/api/internal/*` routes: accounts, account-decisions, account-facts, icp-evaluations, icp-profiles, plus the `n8n`/`sheets` proxy routes. Does not consume any GTM V2 service-auth route.
- **API** (`artifacts/api-server`): Express 5. Two auth boundaries in `routes/index.ts`: `requireAuth` (browser session, `lib/operators.ts`) for the product-facing routes; `requireServiceAuth` (shared-secret header) for the GTM V2 service-to-service routes (`/internal/signals`, `/internal/accounts/:accountId/attention-items`, `/internal/attention-items`).
- **Postgres** (`lib/db`): Drizzle ORM schema + migrations, 12 migrations (`0000`-`0011`) as of this audit's HEAD. See "Canonical data model" below.
- **n8n**: outbound integration only from this repo's perspective — `artifacts/api-server/src/routes/n8n.ts` makes real, authenticated `fetch()` calls to `N8N_BASE_URL` for activation/decision/action/config requests (a real HTTP client exists; whether it currently reaches a live n8n instance is **UNKNOWN / REQUIRES RUNTIME VERIFICATION**). GTM V2's signal-ingestion routes are the inbound direction, meant to be called *by* n8n or another service — **no caller of them was found anywhere in this repository** (see DISC-07). A separate, older, live n8n pipeline (`ICP 01/02v2/03v2`, `ICP Account Shadow`, `GTM Config` workflows — **DOCUMENTED BUT NOT INDEPENDENTLY VERIFIED**, per `docs/icp-rule-discovery.md`'s own prior, separate inspection) still holds the legacy production scoring authority this roadmap describes migrating away from. **n8n does not sit between GTM and Client Radar** — see below.
- **External providers:** Client Radar is a real, config-driven HTTP integration (`artifacts/api-server/src/lib/clientRadarClient.ts`, env vars `CLIENT_RADAR_BASE_URL`/`CLIENT_RADAR_API_TOKEN`), called **directly** from this API server — zero n8n imports/calls found in the Client Radar service files. RB2B, Dealfront, HubSpot, Cognism, Salesforge, Dripify, Retell, and ad platforms have zero code in this repository — future scope only.
- **Client Radar boundary:** a genuinely separate repository/deployment, **not independently audited by this document** — only this repo's own client/persistence/mapping/display code was inspected. This repo only holds a client, research-run persistence, account-alias-based identity mapping, and evidence display — never fact acceptance, never MQL/activation triggering (verified guardrails, see `PROJECT_AUDIT.md` §K).

---

## Canonical data model

Full table-by-table detail with constraints in `PROJECT_AUDIT.md` §D. Summary:

- **accounts** — thin, mutable canonical identity anchor (`account_key`, `company_domain`, `company_name`).
- **account_snapshots** — immutable, insert-only input snapshot fed to the evaluator. **This is the only thing the evaluator ever reads** — see "Signal → account resolution" below for why that matters.
- **icp_profiles / icp_profile_versions / icp_profile_activation_events** — versioned ICP config; a version is immutable once published (DB trigger-enforced); a profile's `active_version_id` must point at a published version of itself (DB trigger-enforced).
- **evaluator_versions / account_evaluations** — insert-only evaluation history; a `production`-mode evaluation must reference a published profile version (DB trigger-enforced).
- **decision_policy_versions / account_decisions** — insert-only decision/routing history; `routing_output` has 8 possible values but only `mql`/`dismissed` are actually computed today (schema comment explicitly says Phase 3 routing logic "not yet built").
- **account_facts / account_fact_current** — immutable fact ledger + mutable current-value pointer. **`account_facts.source` is DB-CHECK-locked to exactly `'manual-operator-v1'`** — no automated producer (including Client Radar) can write here without a schema change.
- **signals** — append-only raw/normalized evidence, deliberately carries no `account_id`/`person_id`.
- **identity_resolution_events** — append-only, complete-snapshot-per-row binding history; this is where a signal's account/person resolution actually lives.
- **account_aliases** — mutable strong/weak identifier index; also reused (without a dedicated table) for Client Radar account mapping (`alias_type='client_radar_account_id'`).
- **account_people** — mutable many-to-many account↔person relationship rows.
- **people** — mutable canonical person identity; DB-CHECK-enforced to always carry at least one real identity attribute (never a "ghost" contact).
- **attention_items** — one-way `open→resolved` lifecycle, DB-trigger-enforced, DELETE rejected unconditionally, dedup via partial unique indexes. `AccountAttentionSummary` (via `GET /internal/accounts?needsAttention=true`) is the canonical "Needs Attention" read model — **not yet consumed by the frontend**.
- **client_radar_research_runs** — one row per research attempt; `accountPayload`/`evidencePayload` raw JSON; no candidate/accepted-fact concept exists anywhere.

---

## Signal → account resolution

Two separate questions, both essential, must not be conflated (this distinction was added in the 2026-08-18 correction pass):

**A. The implemented contract (VERIFIED IN CODE + VERIFIED BY COMPLETED LOCAL TEST):** *if* a correctly-shaped `NormalizedSignalV1` payload reaches `POST /internal/signals` and is resolved, the resolution logic itself is correct — domain/external-id matching, conflict detection, person matching, and idempotent replay are all covered by 30+ passing unit tests. This is real and solid.

**B. The unverified live bridge (UNKNOWN / REQUIRES RUNTIME VERIFICATION):** whether any current real signal source — RB2B, Dealfront, a legacy n8n workflow, or anything else — actually delivers a signal to that endpoint today. **No caller of `POST /internal/signals` exists anywhere in this repository.** This is not proof that no such caller exists in production (it could live entirely in a live n8n workflow this repo can't see), but it means this audit provides **no evidence either way** that real signals currently reach GTM V2. See `PROJECT_AUDIT.md` DISC-07 — this is a distinct, and arguably prior, question to the one below.

**Once (A) a signal reaches the resolver, the flow is (verified from code, `PROJECT_AUDIT.md` §F):**

```
signal ingested → normalized → identity resolution (domain/external-id/email
  matching) → account_aliases / account_people / identity_resolution_events
  written → [DEAD END — nothing downstream ever reads these tables]

accounts + account_facts (manual-operator-v1 only) → account_snapshots
  → evaluator → account_evaluations
```

**Known discrepancy:** the resolution half of this pipeline is complete, DB-enforced, and well-tested. The evaluation-input half never reads `signals`, `identity_resolution_events`, or `account_people` — confirmed by the route layer's own comment (`accountIcpEvaluations.ts:4-6`): *"deriving its input entirely from the account's own current state (no signals, contact, or CRM data exists yet...)"*. The evaluator's `NormalizedEngagementV1Schema` and `intent` rule dimension are fully built to receive exactly this data and are simply never populated (`icpEvaluationResolvers.ts:106-150` hardcodes empty defaults). Fixing this requires a **product decision** first (what should Intent be derived from) — and that decision should wait for (B) above to be resolved, since deciding what signal data should feed Intent is premature if no signal data reliably arrives yet. See `PROJECT_AUDIT.md` §F FIX / DISC-02.

---

## Shadow / account aggregation

No "shadow account" table or module exists in this codebase's code. The term
appears only in `docs/icp-rule-discovery.md`, describing a live **n8n**
workflow (`ICP Account Shadow (Phase B)`) that predates GTM V2 entirely and
is outside this repository. Within this repository: multiple people per
account (`account_people`) and anonymous company-level signal association
(`identity_resolution_events`) are both real and implemented.

**Duplicate-account mechanism — corrected in this pass.** A company-name-only
(weak-identifier-only) signal **can never create an account** — verified in
code: `buildCompanyIdentifierPairs` (`identityResolution.ts:192-208`) never
includes company name, and `planAccountResolution` returns `unresolved`
before any account lookup whenever no domain/external-id pair exists
(`identityResolution.ts:557-565`). The real duplicate mechanisms both involve
**two different strong identifiers**, never a weak one: (1) an account
created outside the resolver (e.g. `bootstrapProductionData.ts`, which
creates no `account_aliases` row) that a later signal identified only by a
non-domain strong identifier cannot find; (2) two strong identifiers for the
same real company that never co-occur on one signal, so no alias overlap is
ever found. No account-merge mechanism exists to reconcile either case
(deliberate, documented scope boundary, not a bug). See `PROJECT_AUDIT.md`
§F / DISC-06 for the full mechanism and citations.

**Aggregated activity does not feed evaluation today** — see above.

---

## ICP / scoring / decision architecture

Single-profile authoring, versioning, and evaluation are complete and solid:
multiple `icp_profiles` can be stored/edited/versioned; a profile version is
immutable once published; an evaluation is explicitly run against one
`profileId` selected by the caller (`POST .../icp-evaluations{,/official}`,
`.strict()` body schema — no smuggled evaluation mode). Fit/intent/eligibility/
actionability are genuinely separate dimensions in one canonical, pure
evaluator (`lib/evaluator`) — no duplicated scoring logic found elsewhere.
Hard disqualifiers sit outside weighted scoring, as the roadmap specifies.

Everything describable as multi-profile *orchestration* — automatic profile
assignment, evaluating one account against multiple profiles automatically,
comparing results, recommending a best profile, profile-specific routing —
is **not built**, matching `ROADMAP.md`'s own framing of this as future
Package 7 scope. Full 15-item matrix in `PROJECT_AUDIT.md` §H.

Decision/routing (Phase 3): only MQL and Dismiss are actually computed and
persisted (`account_decisions`), exactly as `ROADMAP.md` already states. The
other 6 `routing_output` enum values (`sales_review`, `pipeline_assist`,
`owner_alert`, `retarget`, `nurture`, `suppressed`) exist in the schema but
have no computation logic anywhere.

Evaluation staleness (GTM V2 Stage 4) is real and well-built: an accepted
`account_facts` change to a field the latest production evaluation's frozen
config actually references raises an `evaluation_stale` attention item; a
new production evaluation causally (not timestamp-based) auto-resolves it.

---

## Client Radar integration status

**Scope note:** this audit inspected only this repository. Everything below describes the Mission Control (this repo's) side of the integration; the separate Client Radar repository's own internal implementation and currently-deployed runtime behavior were **not** audited and are **UNKNOWN / REQUIRES RUNTIME VERIFICATION** or a separate audit of that repository.

A real HTTP client exists (not a mock), config-driven, with strict response
parsing — whether it currently reaches a live, reachable Client Radar
deployment is **UNKNOWN / REQUIRES RUNTIME VERIFICATION**.
Research-run submission/status-polling/result-retrieval is fully implemented
and persisted on the Mission Control side. Durable account mapping (newest
work, PR #43) reuses `account_aliases`, never silently remaps a conflicting
identity — a conflict is reported and raises a `client_radar_identity_conflict`
attention item. Evidence is displayed live in the frontend
(`client-radar-research-panel.tsx`, mounted on the account detail page).

**What does not exist at all, on the Mission Control side:** any candidate-fact / accept-reject layer.
The write function that persists a completed research result is explicitly
commented *"never touches accountFacts"* — confirmed, since `account_facts`
only ever accepts `source='manual-operator-v1'`. `ROADMAP.md`'s Package 6
("Evidence-Backed Client Radar Composer Enrichment") is correctly labeled
not-started; this audit found no code toward it beyond the evidence-display
layer already covered by the completed Package 4/5 handoff.

**Guardrails verified in code, not just docs:** no silent identity remapping;
no auto-accept facts (vacuously true — no fact-write path exists); no
auto-MQL (MQL write path is DB-trigger-gated on a completed production
evaluation and untouched by any Client Radar code); no auto-send outreach
(no Client Radar code path calls the n8n activation routes).

---

## Database / persistence status

**Schema capability (what the code supports):** extensively documented,
DB-CHECK-enforced, trigger-enforced immutability/lifecycle rules throughout
— see `PROJECT_AUDIT.md` §D for the full table-by-table breakdown. This is a
genuinely well-engineered schema: every immutability claim in this document
is backed by an actual Postgres trigger, not just application-layer
discipline.

**Runtime data (what actually exists in a live database):** **entirely
unverified by this audit.** No database was connected during this audit, per
its explicit constraints. This document makes no claim about row counts,
migration state of any live environment, or whether production has been
migrated through `0011`. If that needs to be established, it requires a
read-only query against an explicitly-approved `DATABASE_URL` — see
`NEXT_SESSION.md` / `PROJECT_AUDIT.md` §T for what would be needed.

---

## Known bugs / discrepancies / technical debt

See `PROJECT_AUDIT.md` §O (full discrepancy register, DISC-01 through
DISC-08) for complete EXPECTED/ACTUAL/CAUSE/IMPACT/FIX detail. Headline
items:

1. **`ROADMAP.md` was 16 PRs stale** — now corrected as part of this audit.
2. **Whether real operational signals reach GTM V2 ingestion at all is unproven** (DISC-07) — critical, and logically prior to item 3 below; no caller of `POST /internal/signals` exists anywhere in this repository.
3. **Signals/identity resolution never reach ICP evaluation** (DISC-02) — critical, open, and contingent on item 2 above.
4. **GTM V2 attention backend has zero frontend consumer** (DISC-03) — critical, open, and the basis of this audit's recommended next unit (narrowed — see item 6).
5. Client Radar → account facts bridge genuinely doesn't exist yet on the Mission Control side (DISC-04 — matches roadmap's own "not started" label; not a surprise).
6. **MQL/Dismiss decisions do not resolve attention items, and the resolve endpoint is unreachable from the browser session** (DISC-08) — narrows the "Needs Attention" next unit to read-only membership wiring; see `NEXT_SESSION.md`.
7. CI does not run Client Radar or ICP-profile test suites on any PR (DISC-05).
8. No account-merge mechanism exists — mechanism corrected in this pass (DISC-06); see "Shadow / account aggregation" above.

---

## Critical invariants / guardrails

Only invariants this audit found actual enforcing code for are listed here —
see the cited file for each.

- **No silent identity remapping.** `linkClientRadarAccountAlias` and the
  core `identityResolution.ts` resolution logic both only ever insert a new
  strong alias or report a conflict — never update/overwrite an existing
  strong alias. (`clientRadarAccountAlias.ts:82-90`; account-alias insert
  paths in `identityResolution.ts`.)
- **No auto-accept Client Radar facts.** Vacuously true — no code path
  writes a Client Radar-sourced row into `account_facts` at all.
- **No auto-MQL from research.** `account_decisions` writes are DB-trigger-
  gated on a completed, production `account_evaluations` row; no Client
  Radar code path touches `account_decisions`.
- **No silent auto-send.** Outbound execution only happens via the explicit,
  operator-triggered `action-modal.tsx` → `POST /api/n8n/activate` path; no
  Client Radar or evaluation code path calls it.
- **Accepted facts retain provenance.** Every `account_facts` row carries
  `source`, `recorded_by`, `observed_at`, `recorded_at`; a correction
  references the row it supersedes (`supersedes_fact_id`) and requires a
  `correction_reason` — the superseded row remains visible forever
  (insert-only, DB-trigger-enforced).
- **Relevant fact changes make evaluation stale — implemented, precisely
  scoped.** Only when the changed field is referenced in the latest
  production evaluation's own frozen `profileConfigSnapshot`
  (`accountFacts.ts:210-267`).
- **All Accounts / Needs Attention relationship.** Confirmed same underlying
  `accounts` query, filtered by a correlated `EXISTS` subquery against open
  `attention_items` — not two parallel stores (`accounts.ts:332-536`). This
  invariant holds at the API layer; the frontend does not yet use this API
  shape for its own "Needs Attention" view (see discrepancy #4 above).
  **Important caveat, verified in this pass:** membership is driven *solely*
  by open `attention_items` — an `account_decisions` write (MQL/Dismiss)
  does **not** resolve any attention item (`accountDecisions.ts` has zero
  attention-item references). Any frontend implementation of this invariant
  must not reintroduce the old model's "hide once MQL'd/Dismissed" local
  logic — see discrepancy #6 (DISC-08) and `NEXT_SESSION.md`.
- **Provider-confirmed truth for future execution.** `gtmContract.js`'s
  `extractLifecycleProof`/`buildLifecycleEnvelope` is a strict allowlist over
  n8n's response, never trusting arbitrary fields as proof of a real send —
  real, enforced code, not just prose. Note this proves "n8n confirmed,"
  not independently-verified proof of an actual email/call/LinkedIn send,
  since the actual provider call happens inside n8n, outside this repo.

---

## Tests / CI status

- Full workspace typecheck (`pnpm exec tsc --build`): clean, verified live during this audit.
- `artifacts/api-server` DB-independent unit tests: 528/528 pass, verified live.
- `@workspace/identity` unit tests: 42/42 pass, verified live.
- CI (`.github/workflows/pr-checks.yml`) provisions a real `postgres:16` service container and runs migrations before its integration tests — genuinely DB-backed, not silently skipped.
- **CI does not run every test suite that exists**: Client Radar and ICP-profile test files (added in PRs #43 and earlier) have no corresponding CI step. They may pass locally but are unverified on merge.
- DB-backed `.integration.test.ts` suites were not executed by this audit (would require a live Postgres instance).

---

## Development workflow

- Package manager: **pnpm only** — the root `package.json` `preinstall` script hard-fails on any other package manager. Use `pnpm exec`, never `npx`, to run workspace-local CLI tools.
- Typecheck: `pnpm run typecheck` (root) or `pnpm exec tsc --build`.
- Tests: per-package `pnpm --filter <pkg> test`, or `artifacts/api-server`'s scoped scripts (`test:signals`, `test:attention-items`, `test:accounts`, `test:evaluation-decision-lifecycle`, plus the full `test`/`test:unit`).
- Migrations: Drizzle, `lib/db/drizzle/*.sql`, 12 migrations as of this audit (`0000`-`0011`). **Do not run migrations against any environment without explicit approval and a named target.**
- Git conventions: PRs merged via GitHub squash-merge to `main`; commit messages are terse (title only, no body) — do not expect PR-description-level rationale in `git log` alone; the "why" instead lives in extensive in-code comments.
- Deployment: manual Docker Compose on a single Hetzner host, documented (non-secret) connection details in `DEPLOYMENT.md`. **Never SSH, deploy, or start Docker containers without explicit user approval in the moment.**

---

## Current next priority

Three distinct next steps, of three different kinds — see `PROJECT_AUDIT.md`
§R for the full reasoning:

1. **Implementation (safe now):** wire the frontend "Needs Attention" *membership* view to the already-built, tested GTM V2 attention read model (`GET /internal/accounts?needsAttention=true` + `AccountAttentionSummary`) — read-only, scoped per DISC-08 (do not carry forward the old "hide on MQL/Dismiss" logic). Full scope in `NEXT_SESSION.md`.
2. **Verification (should happen around the same time, not a prerequisite for #1):** runtime-verify whether any real operational signal currently reaches `POST /internal/signals` (DISC-07).
3. **Product decision (should follow #2):** decide what should feed Intent scoring (DISC-02).

---

## Explicitly deferred work

Per `ROADMAP.md`'s own explicit "out of scope" sections, still accurate as of
this audit: live RB2B/Dealfront/Cognism/HubSpot/Salesforge/Dripify/Retell/
ad-platform integrations; Microsoft Entra; DRUID Data Service migration;
LLM-generated scoring; concurrent multi-profile orchestration; final
enterprise permissions architecture; Client Radar composer enrichment
(candidate facts, accept/reject, message-context integration).

---

## Production status

This document makes **no** claim about what is currently running in
production. `DEPLOYMENT.md` describes a manual Docker Compose deployment
that builds from its own local checkout on the server rather than pulling a
CI-published image — meaning the commit running in production at any given
moment is **not guaranteed to equal `main`'s HEAD** without an explicit
read-only check (`DEPLOYMENT.md`'s documented SSH inspection command, not
run during this audit). Do not assume production reflects this repository's
current state without verifying it.
