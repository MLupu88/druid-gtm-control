# DRUID GTM Mission Control — Next Session Handoff

## 1. Read this first

This file is the current execution handoff for the next coding agent. It is
an operational summary, not a replacement for the deeper project records.
Repository/runtime evidence wins over stale assumptions. Do not restart
completed work.

Before implementing anything, read `ROADMAP.md`, `PROJECT_HANDOFF.md`, and
the relevant audit documents referenced below. Confirm the current git state
and inspect the implementation that actually exists.

## 2. Working method

- Repository: `/Users/mihailupu/Projects/druid-gtm-control`
- GitHub: `MLupu88/druid-gtm-control`
- The user uses Claude Code/Codex for repository implementation and review.
- Normal Terminal/SSH is used for Git, Docker, deployment, and verification.
- Work one concrete step at a time.
- No production, deployment, schema, migration, or secrets work without explicit user approval.
- Never touch the unrelated untracked root `n8n` file.

## 3. Current production state

- Production server: `88.99.81.51`
- Production repository: `/root/gtm-control`
- Public app: `https://gtm.aiexperiments.eu`
- Current deployed/main commit: `7b219f5`
- Docker app service: `gtm-control`
- Production health was verified internally and externally after deployment.

## 4. Completed work

### Milestone 0 — Canonical Core

DONE.

### Milestone 1 — External Input Proof

DONE for:

- HubSpot controlled identity connector
- Client Radar direct backend integration

RB2B remains deliberately parked.

### Milestone 2 — UX Operating Shell v1

The current UX refresh is complete through Account Workspace Phase 3F:

- global shell/design system
- Accounts redesign
- Needs Attention redesign
- Account Workspace tabs
- Intelligence redesign
- evidence progressive disclosure
- trust-state wording
- sticky workspace tabs
- Overview redesign

Intelligence visual QA was positive.

Global Home/Overview remains old-generation UX and is intentionally deferred.
Reports and Settings remain old-generation UX and are deferred.

## 5. Current product truth boundaries

- Canonical account facts are confirmed/current account truth.
- Client Radar is research intelligence, not automatically confirmed truth.
- HubSpot CRM data is not behavioral Intent.
- Recommendation, human decision, execution, and provider confirmation are separate concepts.
- One canonical account is the unit of intelligence.

## 6. Milestone 3 — One Account Truth

This is the next active product milestone.

The target architecture is provider-neutral:

```text
Provider adapter
  → ProviderObservation
  → shared normalization/taxonomy
  → CandidateFact
  → agreement/conflict resolution
  → CanonicalFact
  → evaluation / UI
```

Current and future providers:

- HubSpot
- Client Radar
- RB2B
- Dealfront
- Cognism
- human/operator input

Do not design the canonical layer specifically around HubSpot and Client
Radar. Provider-specific payloads stay inside adapters; core resolution must
operate on generic observations/candidates.

## 7. One Account Truth audit findings

These findings come from the verified 2026-08-19 read-only architecture audit.

### HubSpot

- The connector currently requests only `domain` and `name` (plus company ID).
- It is used for canonical identity and aliases.
- It does not currently ingest industry, country, employees, revenue, owner, lifecycle stage, or similar firmographics.
- Field-level provenance does not yet exist.

#### HubSpot Capability Audit (3A.5) — DONE, verified against live tenant, 2026-08-20

Portal ID `6401175`. Verified directly against the production HubSpot tenant and the
production Private App token — read-only checks only; no writes, no schema changes.

**Website tracking:** HubSpot tracking for `https://www.druidai.com` is installed and
was validated in the HubSpot UI (confirmed 2026-08-20).

**Firmographic/company data — genuinely available, not currently ingested.** A live
company record (`57634473634`) returned `industry` (`CAPITAL_MARKETS`), `country`
(`United States`), `state` (`Colorado`), `numberofemployees` (`125`), `lifecyclestage`
(`lead`), and create/last-modified timestamps. `annualrevenue`, `owner`, and `type` are
available properties on the object but were null on this record. Current GTM code still
requests only `name`/`domain` — this is a code/config gap, not a platform limit.

**Identity/contact and CRM state — available, partially unproven.** Company-to-contact
association works. The token can read contacts. Contact analytics summary properties
(page-view/visit counts, first/last URL and timestamp) are API-readable — but the
tested contact had 0 visits/page views and `source = OFFLINE`, so known-contact web
activity itself remains unproven on a real record, not just unimplemented.

**Detailed web-event ingestion — verified NOT currently available.**
`GET /events/v3/events?...e_visited_page...` returns HTTP 403, requiring
`event-detail-read` or `web-analytics-api-access`. Neither scope is offered in the
Private App scope picker for this account/app. **This must not block Milestone 3** — it
is a verified platform/plan limitation, not an implementation gap.

**Exact current Private App scopes:** `analytics.behavioral_events.send`,
`behavioral_events.event_definitions.read_write`, `crm.objects.companies.read`,
`crm.objects.contacts.read`, `crm.objects.deals.read`, `crm.objects.owners.read`,
`oauth`. Note: the two `behavioral_events.*` scopes only allow *sending/managing*
custom events — they do not grant read access to existing page-view/visit events.

**Product decision (2026-08-20):** HubSpot and RB2B are the current priority provider
sources. HubSpot should be used for as much identity, CRM/firmographic context,
known-contact analytics summary, and owner/deal context as the verified API access
above actually permits. RB2B is the priority source for anonymous visitor/company
website behavior once its existing activation is verified. **Cognism and Dealfront
implementation are PARKED.** The architecture must stay provider-neutral so parked
providers can be added later without a redesign.

**Semantic boundary (binding on 3B):** HubSpot CRM/firmographic data is not Intent. A
single provider may produce more than one observation class — HubSpot alone spans
identity, firmographic_fact, and crm_state. The provider-neutral contract must not
collapse these into one generic value type.

### Client Radar

- The result parser recognizes top-level `company`, `domain`, `country`, and `industry`.
- Structured top-level `country` and `industry` are currently discarded during persistence.
- The opaque account payload and evidence are retained.
- Client Radar research does not write canonical account facts.

### Canonical account facts

- Facts are currently manual-only.
- Supported fields are `industry`, `country`, `region`, `employee range`, and `revenue range`.
- Industry, country, employee range, and revenue range are free text.
- Region is constrained to the existing region vocabulary.
- Immutable fact history and a current pointer exist.
- No provider candidate model exists.
- No provider agreement/conflict model exists.
- Source is persisted for manual facts but currently omitted from API/UI serialization.

### ICP/evaluator

- There is no shared taxonomy for most company attributes.
- Exact raw-string equality is used.
- A real mismatch exists between values such as `emea` and `EMEA`.
- The evaluator consumes current canonical/manual facts through immutable snapshots.

## 8. Major architectural blockers

- No provider-neutral observation/candidate-fact model.
- No shared taxonomy/normalization layer.
- Exact-string ICP matching.
- Client Radar structured firmographics are being dropped.
- Fact provenance is incomplete through the API/UI.
- No generic source agreement/conflict resolution.
- HubSpot firmographics are not ingested yet.

## 9. Future-provider constraint

Adding RB2B, Dealfront, or Cognism later must not require:

- redesigning the canonical fact schema
- copying Client Radar's research-run architecture
- duplicating HubSpot-specific identity logic
- adding provider-specific reconciliation branches to core canonical-truth logic

Provider-specific payloads stay inside adapters. Core resolution operates on
generic observations and candidates. Provider-specific research fields must
not become canonical fact fields merely because one provider exposes them.

## 10. Recommended Milestone 3 sequence

### 3A — Deep architecture audit

DONE. Findings are summarized above and were captured from the 2026-08-19
read-only audit.

**3A.5 — Mandatory HubSpot Capability Audit is also DONE**, verified
2026-08-20 against the live production HubSpot tenant (not just repo code).
See §7 "HubSpot Capability Audit (3A.5)" above for full findings.

### 3B — Provider-neutral observation contract

**CURRENT WORK.** Implemented, tested, and typechecked 2026-08-20 — **not
yet reviewed/approved for commit, not committed, not pushed, not
deployed.** See §17 "Session checkpoint — 3B implementation" below for the
full precise resume point (exact files, final contract shape, test
results, git status, next exact action).

Define provider-neutral concepts and invariants:

- provider
- sourceRecordId
- canonical field
- rawValue
- normalizedValue
- confidence
- observedAt
- importedAt
- evidenceRefs

Do not implement provider auto-promotion yet.

### 3C — Shared taxonomy and normalization

Establish one source of truth for:

- industry
- country
- region
- employee bands
- revenue bands

Do not invent the business taxonomy without an explicit product decision.

### 3D — Candidate fact persistence

Persist generic multi-provider observations/candidates with provenance and
idempotency.

### 3E — First provider adapters

HubSpot and Client Radar become the first adapters.

- HubSpot can then request relevant firmographics.
- Client Radar should preserve structured country/industry.
- Both initially submit candidates rather than directly overwriting canonical facts.

### 3F — Agreement/conflict and canonical selection

Add deterministic resolution, human override, provenance, and conflict state.

### 3G — ICP/evaluator integration

ICP authoring and evaluation consume shared normalized values.

### 3H — Provenance/conflict UX

Account Workspace clearly shows:

- canonical value
- source(s)
- agreement
- conflict
- human override
- unresolved candidate values

## 11. Later roadmap

- Milestone 4 — Account Intelligence / Account Brain
- Milestone 5 — Qualification + real Intent + multi-ICP
- Milestone 6 — UX Operating Shell v2
- Milestone 7 — GTM cockpit / validation / Home + Reports + Settings
- Milestone 8 — Action + feedback loop
- Milestone 9 — Production hardening

Multi-ICP runtime comparison and AI Account Summary / Account Brain remain
planned. Do not implement them during early One Account Truth work.

## 12. Deferred / do not accidentally start

- RB2B implementation
- Dealfront implementation
- Cognism implementation
- Account Brain / AI summary
- multi-ICP runtime comparison
- new Intent model
- People enrichment
- Activity enrichment
- recommendation engine
- outbound execution/orchestration changes
- n8n integration changes
- Entra/auth redesign unless separately requested

## 13. Known UX/product issues

- Global Home/Overview is visually weak and needs a later dense GTM cockpit redesign.
- Reports and Settings remain old generation.
- Free-text canonical fact confirmation is not acceptable as final UX.
- Do not merely replace free text with arbitrary dropdowns before shared taxonomy exists.
- The Intelligence tab redesign is considered directionally successful.

## 14. Next coding-agent task

Do not start by expanding HubSpot.

**Contextualized 2026-08-20, post-3A.5:** this means the common provider-neutral
contract comes first — not that HubSpot lacks useful fields. 3A.5 verified HubSpot
firmographics, CRM state, and contact analytics summary data are genuinely available
against the live tenant (see §7). Consuming those verified fields is **3E** scope, to
be done once the common contract lands — it is not future/unknown capability.

The first implementation task is **Milestone 3B — provider-neutral
observation contract**.

Before editing:

1. Inspect existing shared types and package boundaries.
2. Choose the smallest reusable location for the generic observation contract.
3. Avoid a schema migration unless it is required.
4. Do not introduce provider-specific reconciliation logic.
5. Preserve all current production behavior.

If architecture is ambiguous, return an implementation plan before modifying
files.

## 15. Verification expectations

- Run targeted tests for changed domain logic.
- Run the full relevant frontend/backend regression suite before a meaningful checkpoint.
- Run typecheck.
- Run a production build where appropriate.
- Run `git diff --check`.
- Inspect changed paths for scope drift.
- Do not repeat successful test runs without a reason.

## 16. Canonical references

- `ROADMAP.md`
- `PROJECT_HANDOFF.md`
- `PROJECT_AUDIT.md`
- Any current One Account Truth audit documentation present in the repository.

If the One Account Truth audit exists only in session output and not as a
repository document, the findings above preserve the 2026-08-19 read-only
architecture audit in this handoff.

## 17. Session checkpoint — 3B implementation (2026-08-20, uncommitted)

This section is the precise resume point for a fresh session. Read this
section first, then the rest of this file for full context.

### Status

- 3A — DONE (2026-08-19 audit).
- 3A.5 — DONE (2026-08-20, verified against live HubSpot tenant — see §7).
- **3B — Provider-neutral observation contract — CURRENT WORK.** Implemented,
  tested, and typechecked. **Not reviewed/approved for commit. Not
  committed. Not pushed. Not deployed. No migration run. No production
  change of any kind.**

### Product decision recorded (2026-08-20)

- HubSpot and RB2B are the priority provider sources.
- Cognism and Dealfront implementation remain PARKED.
- HubSpot firmographic, CRM-state, and contact/identity capabilities are
  verified available against the live tenant (see §7).
- HubSpot detailed page-level web-event ingestion is verified **currently
  unavailable** — `event-detail-read`/`web-analytics-api-access` are not
  offered in this account's Private App scope picker. Confirmed
  platform/plan limitation, not an implementation gap — must not block
  Milestone 3.

### Files changed for 3B (all currently uncommitted)

New package:

- `lib/observation/package.json`
- `lib/observation/tsconfig.json`
- `lib/observation/src/index.ts`
- `lib/observation/src/types.ts` — the contract
- `lib/observation/src/idempotency.ts` — `computeObservationIdentityKey()`
- `lib/observation/src/types.test.ts`
- `lib/observation/src/idempotency.test.ts`

Modified:

- `tsconfig.json` (root) — added `./lib/observation` project reference.
- `pnpm-lock.yaml` — new workspace importer entry only (verified: no
  unrelated dependency version drift).
- `NEXT_SESSION.md` — this file (3A.5 findings, product decision, this
  checkpoint).
- `ROADMAP.md`, `PROJECT_HANDOFF.md`, `PROJECT_AUDIT.md` — a single
  prominent stale-warning banner added to the top of each, pointing at
  this file. Contents otherwise untouched — no wholesale rewrite was done.

Untouched: all application code (HubSpot client/sync/identity, Client
Radar client/services, DB schema/migrations, evaluator, frontend/UI, n8n
routes), and the unrelated untracked root `n8n` file.

### Final contract architecture implemented

`ProviderObservationV1` — a Zod discriminated union on `observationClass`,
package `@workspace/observation`, pure (no DB/network/other-lib
dependency), sibling to `lib/identity`, deliberately not merged into it.

Shared envelope (every branch):

```
schemaVersion: "v1"
provider: string                          // open string, not a closed enum
sourceRecordId: string
observedAt: ISO8601 (offset-aware) | null // nullable — see rationale below
importedAt: ISO8601 (offset-aware)        // always required
confidence: "low" | "medium" | "high" | null
evidenceRefs: { type: string; ref: string }[]     // max 20
providerMetadata: Record<string, unknown> | null  // only escape hatch for provider payload shape
```

Discriminated classes (5, per explicit requirement — semantically
separate, never one generic value type):

- `identity` — `subjectType("account"|"person")`, `identityKey`,
  `identityValue`. Never a canonical account fact.
- `firmographic_fact` — `canonicalField` (required), `rawValue`,
  `normalizedValue`.
- `crm_state` — `canonicalField` (required), `rawValue`, `normalizedValue`.
  Kept separate from `firmographic_fact` — CRM operational state and a
  fact about the company are never reconciled as interchangeable evidence.
- `behavioral_signal` — `eventType`, `rawValue`, `normalizedValue`. No
  `canonicalField` key exists on this branch at all (not merely null).
  Explicit sibling to `lib/identity`'s existing `NormalizedSignalV1` —
  not a replacement, not touched.
- `research_intelligence` — `findingType`, `rawValue`, `normalizedValue`.
  No `canonicalField` key at all. `evidenceRefs` enforced non-empty via
  `superRefine` (a finding with no evidence is rejected).

Key design decisions from explicit review adjustments (not the original
proposal):

- Discriminated union with class-specific branches, not one loose
  `rawValue`/`canonicalField` object gated only by `superRefine`.
- `observedAt` nullable — 3A.5 verified HubSpot's company-property API
  exposes no trustworthy field-level observation timestamp, only a
  whole-record last-modified time. `importedAt` stays required.
- `confidence` is a semantic level (`low`/`medium`/`high`/`null`), never a
  fabricated numeric 0..1 score — no provider was verified to honestly
  supply one. Provider-native numeric confidence, if any, stays in
  `providerMetadata` until normalization is explicitly defined (3C+).
- No taxonomy invented: `canonicalField`, `identityKey`, `eventType`,
  `findingType` are all open (non-blank) strings, not closed enums — the
  closed vocabulary is explicitly 3C's job.

### Idempotency semantics (documented + tested, NOT persisted — that's 3D)

`computeObservationIdentityKey(observation)` in
`lib/observation/src/idempotency.ts`:

```
key = provider + observationClass + sourceRecordId + semanticKey
```

where `semanticKey` = `identityKey` (identity) / `canonicalField`
(firmographic_fact, crm_state) / `eventType` (behavioral_signal) /
`findingType` (research_intelligence).

Rationale, verified against real data: one HubSpot company record (one
`sourceRecordId`, e.g. `57634473634`) legitimately produces multiple
observations — industry, country, employee count, lifecycle stage — so
`(provider, sourceRecordId)` alone is not a safe identity. `importedAt` is
deliberately excluded from the key: re-ingesting the same observation
later is still "the same observation," not a new one. No DB uniqueness
constraint exists yet — this is a pure function only, to be enforced (or
translated into a DB constraint) in 3D.

**Reviewed 2026-08-20 (post-implementation, pre-commit): `sourceRecordId`
invariant for per-event classes.** For `behavioral_signal` (and equally
`research_intelligence`), `eventType`/`findingType` alone does not
distinguish two occurrences of the same kind from the same subject — two
`page_view`s from one visitor both have `eventType: "page_view"`.
`sourceRecordId` is what must distinguish them, so it **must identify the
individual event/observation record, never merely the subject
(account/person) it is about** — a HubSpot contact id used as
`sourceRecordId` for a `page_view` observation would incorrectly collapse
every page view from that contact into one identity key. This is now an
explicit, documented invariant in `types.ts`'s `sourceRecordId` and
`BehavioralSignalObservationV1Schema` comments, and is demonstrated by two
new tests in `idempotency.test.ts` (correct per-event usage, and the
misuse case, shown as a known limitation the contract cannot structurally
prevent — the obligation is on the adapter, per 3E). No schema shape
changed; this was a documentation/test gap, not a contract defect.

### Tests / typecheck results (all executed live, 2026-08-20)

- `pnpm --filter @workspace/observation test` — **22/22 pass** (5
  idempotency-key tests, 17 contract-shape tests).
- `pnpm exec tsc --build` (full workspace) — clean, zero errors.
- `git diff --check` — clean, no whitespace errors.
- Full workspace `pnpm run build` was **not** re-run this checkpoint (no
  application code changed, only a new isolated pure package) — recommend
  running it once more as a pre-commit sanity check.

### Still waiting for final verification/review

- **User review/approval of the 3B contract shape and package placement**
  — not yet explicitly approved for commit as of this checkpoint.
- Decision on whether to commit 3B now or continue refining first.
- `pnpm run build` (full workspace build, not just typecheck) — recommended
  before any commit, per §15 verification expectations.
- 3C (shared taxonomy) requires an explicit product decision before any
  taxonomy values are invented — not started, not to be started implicitly.

### Current git status (2026-08-20, this checkpoint)

```
 M NEXT_SESSION.md
 M PROJECT_AUDIT.md
 M PROJECT_HANDOFF.md
 M ROADMAP.md
 M pnpm-lock.yaml
 M tsconfig.json
?? lib/observation/
?? n8n
```

`n8n` is the pre-existing, unrelated untracked root file — not created or
touched by this work, and must not be touched by any future session.

**Explicit statement: nothing in this checkpoint (3A.5 or 3B) has been
committed, pushed, deployed, migrated, or changed in production. Every
change described in this section exists only in the local working tree.**

### Next exact action for the new session

1. Get explicit user approval on the 3B contract (`lib/observation`) as
   implemented — do not assume approval from this checkpoint alone.
2. If approved: run `pnpm run build` once more as a pre-commit sanity
   check, then commit only 3B plus the documentation changes described
   above (do not fold in unrelated future work). Do not push without
   separate explicit approval.
3. If changes are requested: apply them inside `lib/observation` only —
   still contract-only, still no persistence, no provider changes, no
   evaluator/UI/n8n changes, per the same constraints this slice was built
   under.
4. Only after 3B is committed: **3C — shared taxonomy and normalization**
   is next per the Milestone 3 sequence (§10), and requires an explicit
   product decision on taxonomy values before any implementation starts.

## 18. New-session startup instruction

> Read this file first. Then inspect the referenced canonical docs and current
> git state. Do not assume historical notes are still true if the repository
> contradicts them. Do not start implementation until you can state the
> current milestone, next slice, hard boundaries, and files likely involved.
