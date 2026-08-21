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

**3C V1 (closed observation field/key-name vocabularies) — DONE**, implemented
2026-08-20, uncommitted as of this note. See §17 for the full checkpoint.
This closed `lib/observation`'s `identityKey` and `canonicalField` (split
per branch into `FirmographicCanonicalFieldV1`/`CrmCanonicalFieldV1`) —
i.e. the vocabulary of field/key *names* an observation can target.

**Still open, NOT part of 3C V1, remains future work:** the vocabulary of
field *values* this section originally described — what counts as a valid
`industry` string, a valid `country`, a normalized `region`/employee-band/
revenue-band value. That is a distinct layer (closer to `lib/db`'s
`ACCOUNT_FACT_REGION_VALUES` territory, generalized) from the field-name
closure 3C V1 delivered, and still requires its own explicit product
decision before it is ever implemented.

**Explicit product decision (2026-08-20): this deferred value-level
taxonomy is NOT a prerequisite or blocker for Milestone 3D.** It remains
deliberately deferred until real provider ingestion gives us evidence for
the normalization rules — inventing it now, with no real data, would
repeat exactly the mistake 3C V1 avoided for `eventType`/`findingType`.
3D may proceed using the existing observation contract as-is: `rawValue`/
`normalizedValue` as JSON, plus the closed field-*name* taxonomy 3C V1
already delivered. Do not read this section as implying another product
decision is required before starting 3D — none is.

`eventType` (behavioral_signal) and `findingType` (research_intelligence)
were deliberately left open in 3C V1 — no verified provider data exists to
close them against yet (HubSpot's page-event API is 403-blocked per 3A.5;
RB2B unimplemented; Client Radar's real contract has no finding-category
field). Revisit once RB2B is activated/verified or HubSpot's event-read
scope changes — do not invent values from test fixtures in the meantime.
This, too, is not a blocker for 3D.

### 3D — Candidate Observation / Fact Persistence

**DONE.** Committed and pushed at `b3a26ea`. See §19 for the full
checkpoint (final architecture, migrations, test results).

### 3E — First provider adapters

Revised sequence (corrected 2026-08-20 — RB2B is an active, required
provider, not deferred; see §20):

- **3E.1 — RB2B live-path verification + contract capture — DONE.**
- **3E.2 — RB2B → `behavioral_signal` adapter — split into two parts (see §21):**
  - **3E.2a — Mission Control RB2B observation ingestion endpoint —
    DONE.** Committed and pushed at `1794e8b` ("feat: add RB2B observation
    ingestion bridge"). `POST /internal/rb2b/signals` accepts a
    caller-supplied `source_record_id`/`ingestion_attempt_at` and never
    derives either.
  - **3E.2b — n8n RB2B fan-out wiring — NOT STARTED, pending** until
    either (1) the actual RB2B payload contract is obtained from RB2B
    configuration/documentation, including a defensible native or stable
    event/visit identifier and event-time field, or (2) the first real
    RB2B delivery provides enough evidence to establish the
    `source_record_id`/`provider_observed_at` strategy for whatever calls
    3E.2a. There has never been an RB2B execution — this is not "inspect
    an existing one."
- **3E.3 — HubSpot → `identity`/`firmographic_fact`/`crm_state` adapter —
  DONE.** Committed and pushed at `f435071` ("feat: add HubSpot observation
  adapter"). See §22 for the full checkpoint (mappings, known gaps, review
  corrections).
- **3E.4 — Client Radar → `research_intelligence` adapter — DONE.**
  Committed at `b33a12e` ("feat: add Client Radar observation adapter").
- **3F — Agreement/conflict resolution + canonical selection — DONE
  locally, verified, uncommitted/unpushed.** Unit 27/27, integration 5/5.
  See §24 for the full checkpoint (architecture, subject binding, policy,
  persistence, tests).
- **3G — ICP/evaluator integration on canonical truth — DONE locally,
  verified, uncommitted/unpushed.** Unit 33/33, integration 10/10.
  See §25 for the full checkpoint (authoritative read path,
  snapshot/evidence extension, backward compatibility, tests).

### 3F — Agreement/conflict and canonical selection

**DONE locally, verified, uncommitted/unpushed.** See §24 for the full
checkpoint. Deterministic resolution + provenance is done and tested;
human override and conflict-state UI remain 3H (not started).

### 3G — ICP/evaluator integration

**DONE locally, verified, uncommitted/unpushed.** See §25 for the full
checkpoint. `createCurrentAccountSnapshot` now sources company/crm
evaluator input from Milestone 3F's canonical resolution (recomputed at
the evaluation boundary) instead of reading account_fact_current
directly; ICP authoring/evaluation consume this through the existing,
unchanged account_snapshots mechanism. Unit 33/33, integration 10/10.

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

## 17. Historical checkpoint — 3B implementation (2026-08-20)

**Superseded — 3B is now committed and pushed at commit `d39e602`.** This
section is kept for the file/architecture/rationale detail it recorded at
the time; for current status read §18 below first, which covers 3C V1.

### Status (at time of writing — now historical)

- 3A — DONE (2026-08-19 audit).
- 3A.5 — DONE (2026-08-20, verified against live HubSpot tenant — see §7).
- **3B — Provider-neutral observation contract.** Implemented, tested,
  typechecked, and (as of the next session) reviewed, committed, and
  pushed at `d39e602`.

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

**Update: 3B (including the pre-commit behavioral-signal identity review)
was subsequently approved, committed, and pushed at `d39e602`.** No
migration was run, no deployment happened as part of that commit/push
itself — see §18 for what has and hasn't happened since.

### Next exact action recorded at the time (now superseded — see §18)

1. ~~Get explicit user approval on the 3B contract~~ — done.
2. ~~Commit only 3B plus the documentation changes~~ — done, `d39e602`.
3. If changes are requested: apply them inside `lib/observation` only —
   still contract-only, still no persistence, no provider changes, no
   evaluator/UI/n8n changes, per the same constraints this slice was built
   under.
4. Only after 3B is committed: **3C — shared taxonomy and normalization**
   is next per the Milestone 3 sequence (§10), and requires an explicit
   product decision on taxonomy values before any implementation starts.

## 18. Session checkpoint — 3C V1 implementation (2026-08-20, uncommitted)

This section is the precise resume point for a fresh session. Read this
section first, then §17 and the rest of this file for background.

### Status

- 3A, 3A.5, **3B — all DONE and committed/pushed at `d39e602`.**
- **3C V1 (closed observation field/key-name vocabularies) — CURRENT
  WORK.** Implemented, tested, typechecked. **Not reviewed/approved for
  commit. Not committed. Not pushed. Not deployed. No migration run. No
  production change of any kind. No 3D/3E/3F/3G work started.**

### What 3C V1 closed, and what it deliberately did not

Closed (Zod enums in `lib/observation/src/types.ts`):

- `IdentityKeyV1`: `domain`, `external_id`.
- `FirmographicCanonicalFieldV1`: `company.industry`, `company.country`,
  `company.region`, `company.employeeRange`, `company.revenueRange` —
  exactly `lib/db`'s existing `ACCOUNT_FACT_FIELDS`, reused not redefined.
- `CrmCanonicalFieldV1`: `crm.owner`, `crm.lifecycleStage`,
  `crm.openOpportunity`, `crm.existingCustomer`, `crm.competitorFlag`,
  `crm.partnerFlag`. **Provider-neutral naming, approved 2026-08-20:
  `crm.owner`, not `crm.hubspotOwner`** (the evaluator's existing,
  unmodified field name) — `lib/evaluator` was explicitly NOT touched in
  this milestone; the two vocabularies now differ by name and a future
  3G slice will need to reconcile them. `crm.lifecycleStage` is new (no
  evaluator consumer yet) but included on "verified against the live
  HubSpot tenant" grounds (3A.5 — real value `"lead"` read).

Deliberately left open (still `NonBlankString`, unchanged from 3B):

- `eventType` (behavioral_signal) — no verified real eventType data
  exists anywhere (HubSpot page-event API 403-blocked; RB2B
  unimplemented).
- `findingType` (research_intelligence) — Client Radar's actual result
  contract has no finding-category field at all.

Both deferrals are intentional, not an oversight — do not close either
from test-fixture strings (`"page_view"`, `"company_summary"`, etc. are
illustrative only, never a taxonomy decision).

### Product decisions approved and applied (2026-08-20)

1. Provider-neutral CRM canonical field names — `crm.owner`, never
   `crm.hubspotOwner`, inside the observation taxonomy. Evaluator
   untouched.
2. Provider record ids are `identity` assertions, not `crm_state` —
   `identityKey: "external_id"` covers this for both HubSpot and any
   future provider; no `crm.companyId`/`crm.contactId`/provider-specific
   id field exists anywhere in `lib/observation`.
3. Cross-field validation added: `identityKey: "domain"` is valid only
   when `subjectType === "account"`; `identityKey: "external_id"` is
   valid for either `subjectType`. Enforced in `ProviderObservationV1Schema`'s
   existing top-level `superRefine` (same mechanism the research_intelligence
   evidence-required rule already used) — no shape change to the `identity`
   branch itself.

### Files changed for 3C V1 (all currently uncommitted, on top of the
committed 3B baseline)

- `lib/observation/src/types.ts` — added `IdentityKeyV1`,
  `FirmographicCanonicalFieldV1`, `CrmCanonicalFieldV1`; narrowed
  `identityKey`/`canonicalField` field types on the affected branches;
  added the `domain`-requires-`account` cross-field check; updated
  header/field comments (removed speculative eventType/findingType
  example values from comments, replaced with an explicit deferral
  rationale).
- `lib/observation/src/types.test.ts` — added tests for both closed
  enums (accepted/rejected values, including an explicit test that
  `crm.hubspotOwner` is rejected) and both subjectType/identityKey
  validation branches.
- `lib/observation/src/idempotency.test.ts` — inspected, **not
  modified**: existing fixtures already used only values that remain
  valid under the new closed vocabularies (`company.industry`,
  `company.country`, `crm.lifecycleStage`, `domain` with
  `subjectType: "account"`).
- `NEXT_SESSION.md` — this file (3C section update, this checkpoint,
  §17 corrected to reflect 3B's actual committed state).

Untouched: DB schema/migrations, `lib/evaluator`, HubSpot/Client
Radar/RB2B application code, UI, n8n, any persistence/adapter/
reconciliation code, and the unrelated untracked root `n8n` file.

### Tests / typecheck results (executed live, 2026-08-20)

- `pnpm --filter @workspace/observation test` — pass (see terminal output
  from this session for the exact count; re-run before acting on this
  checkpoint if in doubt).
- `pnpm exec tsc --build` (full workspace) — clean.
- `git diff --check` — clean.

### Still waiting for final verification/review

- **User review/approval of 3C V1** — not yet given as of this
  checkpoint.
- Whether to commit 3C V1 now or continue refining.
- The **value-level taxonomy** this milestone's original scope note
  described (valid `industry`/`country`/`region`/employee-band/
  revenue-band *values*, not field names) remains completely open — a
  distinct product decision, not started, not implied by 3C V1's field-
  name closure. **Explicitly NOT a prerequisite or blocker for 3D** —
  see §10's 3C section for the full, explicit product decision recorded
  2026-08-20.

### Next exact action for the new session

1. Get explicit user approval on 3C V1 as implemented — do not assume
   approval from this checkpoint alone.
2. If approved: commit only 3C V1 (the four files above), following this
   repo's normal commit process. Do not push without separate explicit
   approval.
3. If changes are requested: apply them inside `lib/observation` only,
   under the same constraints this slice was built under (no persistence,
   no provider code, no evaluator/UI/n8n changes).
4. **3D — candidate fact persistence is the immediate next milestone once
   3C V1 is committed** (§10) — no further product decision is a
   prerequisite. The deferred value-level taxonomy does NOT block 3D: 3D
   proceeds using the existing observation contract's `rawValue`/
   `normalizedValue` as JSON plus the closed field-name taxonomy 3C V1
   already delivered.

## 19. Session checkpoint — 3D V1 implementation (2026-08-20, uncommitted)

This section is the precise resume point for a fresh session. Read this
section first, then §17/§18 and the rest of this file for background.

### Status

- 3A, 3A.5, 3B, 3C V1 — all DONE. 3B is committed/pushed at `d39e602`; 3C
  V1 is committed/pushed at `5188107`.
- **3D — Candidate Observation / Fact Persistence — DONE.** Approved as
  implementation-complete 2026-08-20. **Not committed. Not pushed. Not
  deployed. No migration applied to production. No production change of
  any kind.**
- **3E — First provider adapters — NEXT.** Not started, not designed.

### Final architecture

`observations` — one immutable, append-only occurrence log:

- **No `account_id`/`person_id` binding in 3D.** Subject association is
  wholly deferred to 3F, via a separate resolution/link mechanism
  following the repo's existing `signals` → `identity_resolution_events`
  precedent — never a mutation of the observation row.
- **`imported_at` is caller-supplied, with no DB default.** Assigned once
  at the ingestion boundary by the caller and preserved unchanged across
  retries of the same ingestion attempt — the DB column carries no
  `defaultNow()`.
- **Occurrence uniqueness:** `UNIQUE (provider, observation_class,
  source_record_id, semantic_key, imported_at)`. Semantic identity alone
  (`computeObservationIdentityKey` — provider + observationClass +
  sourceRecordId + semanticKey) is deliberately NOT globally unique in
  this table; a new `imported_at` always creates a new occurrence row,
  whether the observed value changed or not.
- **`identity_value` is stored explicitly** in its own column — never
  smuggled inside `raw_value` as a fake JSON-string container. Identity
  rows carry `identity_subject_type`/`identity_value` and neither
  `raw_value` nor `normalized_value`; every other class carries
  `raw_value` (required) and neither identity column — enforced by one
  combined iff-CHECK.
- **`observation_confidence` is a new, distinct Postgres enum** — never
  reuses `identity_confidence` (that type's own comment scopes it to
  "confidence in a resolved identity," a different concept from
  confidence in an observed value).
- **`semantic_key` CHECKs are branch-specific, never one combined list**
  — an identity key can never validate under `crm_state` or vice versa;
  each closed class (`identity`, `firmographic_fact`, `crm_state`) gets
  its own scoped `IN (...)` clause.
- **`behavioral_signal`/`research_intelligence` semantic keys remain
  open** — no CHECK constrains `eventType`/`findingType`, matching 3C's
  deliberate deferral (no verified provider data exists to close them
  against yet).
- **`recordObservation()` outcomes: `created` / `duplicate` / `conflict`**
  — insert-first, catch `23505` on the occurrence constraint, re-read,
  classify by full structural comparison of every non-key column.
  `conflict` (same tuple, different content) is surfaced, never silently
  overwritten.
- **The shared `getObservationSemanticKey` helper is used** —
  `lib/observation/src/idempotency.ts`'s formerly-private `semanticKeyOf`
  was exported under this name and is called directly from
  `toInsertObservation()`; no semantic-key switch logic is duplicated in
  the API service, and `computeObservationIdentityKey` itself now calls
  the same exported function.
- Immutable by trigger: `observations_immutable` reuses the existing
  `reject_update_delete()` function — no new PL/pgSQL.

### Migrations

- `lib/db/drizzle/0012_add_observations.sql` — generated baseline (table,
  `observation_class`/`observation_confidence` enums, CHECKs, indexes).
- `lib/db/drizzle/0013_observations_immutability.sql` — hand-authored,
  reuses `reject_update_delete()`.
- Verified against a disposable local Postgres 16 container (`docker run
  postgres:16`, migrated via `pnpm --filter @workspace/db run migrate`,
  then stopped and removed). **Never applied to production.**

### Test results (executed live, 2026-08-20)

- `@workspace/observation`: **34/34 pass.**
- `@workspace/api-server` `test:observations` (unit + integration,
  `recordObservation()`'s created/duplicate/conflict paths, real DB):
  **14/14 pass.**
- All `observations`-related tests in `lib/db`'s full suite (17
  integration + 6 structural + the shared-helper test): **all pass.**
- `lib/db`'s full suite otherwise: **154/158 pass. The 4 failures are
  pre-existing, in `attention_items`** (a `resolved_at >= created_at`
  CHECK, timing-sensitive against this specific fresh container's
  clock/latency) — a table this milestone never touched. Not caused by
  3D (migrations 0012/0013 are strictly after `attention_items`' own
  0011 and touch nothing it depends on). **Explicitly not fixed here** —
  out of scope, flagged for a future session.
- `pnpm exec tsc --build` (full workspace libs): clean.
  `@workspace/api-server` typecheck: clean.
- `git diff --check`: clean.

### Files changed for 3D (all currently uncommitted)

New: `lib/db/src/schema/observations.ts`, `lib/db/drizzle/0012_add_observations.sql`,
`lib/db/drizzle/0013_observations_immutability.sql`,
`lib/db/drizzle/meta/{0012,0013}_snapshot.json`,
`artifacts/api-server/src/services/observations.ts`,
`observations.test.ts`, `observations.integration.test.ts`.

Modified: `lib/db/src/schema/enums.ts`, `index.ts`, `schema.test.ts`,
`integrity.integration.test.ts`, `lib/db/drizzle/meta/_journal.json`,
`lib/observation/src/idempotency.ts` (+`.test.ts`),
`artifacts/api-server/package.json`, `pnpm-lock.yaml`.

Untouched: DB migrations/schema for any other table, `lib/evaluator`,
HubSpot/Client Radar/RB2B application code, UI, n8n routes, and the
unrelated untracked root `n8n` file.

### Next exact action for the new session

1. Get explicit user approval to commit 3D as implemented.
2. If approved: commit only the 3D files above plus this checkpoint. Do
   not push without separate explicit approval.
3. **3E — First provider adapters is next** per the Milestone 3 sequence
   (§10) — not started, not designed. Do not begin 3E design or
   implementation until explicitly requested in a new session.

## 20. Session checkpoint — Milestone 3E.1/3E.2 (2026-08-20, design-only)

This section is the precise resume point for a fresh session. Read this
section first, then §19 and the rest of this file for background.

### Status

- 3D — DONE, committed/pushed at `b3a26ea`.
- **3E.1 — RB2B live-path verification + contract capture — DONE.**
- **3E.2 — RB2B → `behavioral_signal` adapter — DESIGN COMPLETE; split
  into 3E.2a/3E.2b, see §21.** 3E.2b remains pending until either (1) the
  actual RB2B payload contract is obtained from RB2B
  configuration/documentation, including a defensible native or stable
  event/visit identifier and event-time field, or (2) the first real
  RB2B delivery provides enough evidence to establish the
  `source_record_id`/`provider_observed_at` strategy. There has never
  been an RB2B execution to inspect.
- 3E.3 (HubSpot), 3E.4 (Client Radar) — NOT STARTED.
- 3F — NOT STARTED.

### Correction to the Milestone 3 provider priority (2026-08-20)

RB2B is an **active, required** provider for this product's behavioral
signal / Intent path — not deferred. Only Cognism and Dealfront remain
parked. The 3E sequence is revised accordingly: 3E.1 (RB2B verification)
and 3E.2 (RB2B adapter) now come before 3E.3 (HubSpot) and 3E.4 (Client
Radar), reversing the earlier HubSpot-first assumption recorded upstream
in this file.

### 3E.1 — verified live topology

```
RB2B -> n8n "RB2B Capture" (rb2b-capture) -> "Map RB2B Payload"
     -> POST /webhook/icp-signal-intake -> ICP 01 Normalize Signal
     -> existing legacy GTM pipeline
```

**Live n8n UI confirms the relevant workflows are active.** Any exported
workflow JSON or repo-recorded `active: false` metadata is a stale
snapshot and must not be treated as current — live runtime state is
authoritative over it.

**No repository evidence exists for a native RB2B event/visit id, a
confirmed timestamp provenance, or the fan-out node's retry
configuration** — see the three unresolved runtime questions below.

### 3E.2 — target architecture (design complete)

```
RB2B -> RB2B Capture -> ICP 01 Normalize Signal
           -> existing legacy GTM path (UNTOUCHED)
           -> ADDITIVE fan-out -> Mission Control observation ingestion
                -> observations table, observationClass = behavioral_signal
```

- Existing legacy GTM processing **must remain unaffected** if Mission
  Control ingestion fails — an n8n-side wiring requirement (parallel
  branch, not serial; continue-on-fail), not something this repo can
  implement or verify without touching n8n.
- **One `behavioral_signal` observation per RB2B visit** in the minimal
  3E.2 slice — no separate `identity`/`firmographic_fact` split (no
  current consumer for either; `contact_email` isn't even in 3C's closed
  `IdentityKeyV1` vocabulary). Full context (`company_domain`,
  `contact_email`, `linkedin`, `page_visited`, `signal_detail`, etc.)
  lives in `rawValue`.
- **Observation persistence remains pre-resolution.** Identity resolution
  (unresolved, missing, or conflicting) must never gate whether an
  observation is recorded — this corrects an earlier draft of the
  HubSpot 3E design that wrongly gated observation writes behind
  successful identity bootstrap.
- Reuses the existing 3D `observations` table and `recordObservation()`
  unmodified — **no schema migration expected for 3E.2.**
- Proposed endpoint: `POST /internal/rb2b/signals` — a dedicated,
  RB2B-specific bridge (not a generic multi-provider endpoint yet — that
  stays deferred until a second provider needs it), reusing the existing
  `requireServiceAuth` internal-service-auth convention exactly as
  `/internal/signals` does.

### Three unresolved runtime questions (the actual blocker)

1. Does the raw RB2B webhook payload contain a stable native
   event/visit/activity id that the current mapper discards during
   normalization?
2. Is the incoming `timestamp` the provider's real event time, or is it
   generated locally by n8n at normalization time?
3. What are the actual retry semantics of the future Mission Control
   fan-out node (does it retry at all, how many times, what backoff), and
   can one ingestion attempt preserve a stable `importedAt`/attempt
   identity across those retries?

None of these is answerable from static repository inspection. There has
never been an RB2B execution, so this is not a matter of inspecting an
existing one — answering them requires either (1) the actual RB2B payload
contract from RB2B configuration/documentation, or (2) the first real
RB2B delivery providing enough evidence to answer them directly.

### Explicitly NOT approved — two rejected heuristics

Two candidate mechanisms for deriving `importedAt` were proposed and
**explicitly rejected** during this design pass — do not implement
either:

- **"Reuse the earliest existing row's `importedAt`"** for any repeat
  sighting of the same `sourceRecordId` — rejected because it cannot
  distinguish a retry of the same delivery from the same provider event
  being intentionally imported again later; it would wrongly collapse
  the latter into a duplicate.
- **"Time-bounded prior-row lookup"** (reuse `importedAt` only if a prior
  row exists within a short recent window) — also rejected. It is a
  heuristic guess at a safe window size with no verified basis, and still
  cannot reliably distinguish retry vs. later reimport vs. two genuine
  events/imports occurring close together in time.

**Preferred direction, still unfinalized:** `importedAt` should be
assigned once at the ingestion-attempt boundary and preserved across
retries of that same attempt — not reconstructed after the fact from
`observations` table history. The exact mechanism must follow verified
n8n retry/execution behavior (question 3 above), not be guessed at.

### Next exact action for the next session

Establish the RB2B `sourceRecordId`/`provider_observed_at` strategy for
3E.2b via one of: (1) obtaining the actual RB2B payload contract from RB2B
configuration/documentation, including a defensible native or stable
event/visit identifier and event-time field, including the **Webhook -
RB2B Push** node's real input shape and the retry behavior/configuration
for the future additive HTTP fan-out node; or (2) the first real RB2B
delivery providing enough evidence to establish it directly. There has
never been an RB2B execution — do not treat this as inspecting an
existing one. Do not finalize `sourceRecordId`/`provider_observed_at`
semantics or begin 3E.2b implementation until one of these is done.

## 21. Session checkpoint — Milestone 3E.2a implementation (2026-08-20, committed/pushed)

This section is the precise resume point for a fresh session. Read this
section first, then §20 and the rest of this file for background.

### Status

- 3D, 3E.1 — DONE (3D committed/pushed at `b3a26ea`).
- **3E.2 split into 3E.2a and 3E.2b, per explicit correction 2026-08-20:**
  - **3E.2a — Mission Control RB2B observation ingestion endpoint —
    DONE.** Committed and pushed at `1794e8b` ("feat: add RB2B observation
    ingestion bridge"); local `main` == `origin/main`. Tests previously
    passed 29/29; workspace and `api-server` typechecks clean. No
    deployment. No production migration. No production change of any
    kind.
  - **3E.2b — n8n RB2B fan-out wiring — PENDING.** Not started. n8n
    untouched — the unrelated root `n8n` file remains untracked. See the
    dedicated subsection below for the two valid paths forward.
- 3E.3, 3E.4, 3F — NOT STARTED.

### What 3E.2a is, and what it deliberately is not

`POST /internal/rb2b/signals` — a repository-side contract only. It does
**not** derive `source_record_id` or `importedAt`; both are required,
caller-supplied fields (`source_record_id`, `ingestion_attempt_at`),
passed through exactly as received. This is the corrected design: the
earlier raw-body-fingerprint derivation strategy considered during the
3E.2 design pass is **not implemented and not approved** — see §20's
"Explicitly NOT approved" section, which still stands unchanged. 3E.2a
exists so the repository side of the contract can be built and tested
ahead of 3E.2b, without needing to solve the still-open
`source_record_id`/`importedAt` derivation question at all — that
question now belongs entirely to whatever calls this endpoint (3E.2b),
not to Mission Control.

### 3E.2b — n8n RB2B fan-out wiring — PENDING (payload contract or first real delivery)

Not started. n8n untouched. Two valid paths forward — either is
sufficient on its own:

1. Obtain the actual RB2B payload contract/configuration/documentation,
   including a defensible native or stable event/visit identifier and
   event-time field; or
2. Use the first real RB2B delivery to establish the
   `source_record_id`/`provider_observed_at` semantics directly.

There has never been an RB2B execution, so this is not a matter of
inspecting an existing one. Do not begin n8n fan-out wiring, and do not
finalize `source_record_id`/`provider_observed_at` semantics, until one
of the two paths above is complete.

### Endpoint contract

`POST /internal/rb2b/signals`, behind the existing `requireServiceAuth`
middleware (reused, not duplicated — same shared-secret header convention
as `/internal/signals`).

Required: `source` (must equal `"rb2b"`), `signal_type`,
`source_record_id`, `ingestion_attempt_at`.
Optional: `provider_observed_at`, plus the normalized RB2B context fields
already identified in the 3E.2 design (`company_domain`, `company_name`,
`country`, `industry`, `contact_email`, `contact_name`, `contact_title`,
`contact_phone`, `linkedin`, `page_visited`, `signal_detail`, `campaign`,
`keyword`, `resolution_level`, `stream`) — plus any other field, via
passthrough (not rejected as unrecognized), since no real RB2B payload
has ever been received.

Mapping (exact, per approval): `provider = "rb2b"`, `observationClass =
"behavioral_signal"`, `eventType = signal_type`, `sourceRecordId =
source_record_id` (unchanged), `observedAt = provider_observed_at ??
null`, `importedAt = ingestion_attempt_at` (unchanged), `rawValue` = the
complete validated inbound DTO, `normalizedValue = null`, `confidence =
null`, `evidenceRefs = []`, `providerMetadata = null`.

Reuses `ProviderObservationV1Schema`, `getObservationSemanticKey()` (via
`recordObservation()`), and `recordObservation()` itself — all unmodified.
No DB schema change; 3D's `observations` table and trigger are unchanged.

### Files changed

New: `artifacts/api-server/src/routes/rb2bSignalBridge.ts`,
`artifacts/api-server/src/services/rb2bObservationMapping.ts`,
`rb2bObservationMapping.test.ts`, `rb2bObservationMapping.integration.test.ts`.

Modified: `artifacts/api-server/src/routes/index.ts` (mounts the new
router behind `requireServiceAuth`, before any `requireAuth`-gated
`/internal` prefix — same ordering discipline as every other
service-to-service route), `artifacts/api-server/package.json`
(`test:observations`/`test:observations:unit` extended to include the new
files).

Untouched: n8n, DB schema/migrations, `lib/evaluator`, HubSpot/Client
Radar application code, UI, and the unrelated untracked root `n8n` file.

### Test results (executed live, 2026-08-20)

- Pure mapping/contract-validation unit tests: **18/18 pass** (no DB).
- Full suite including integration (disposable local Postgres, migrated
  through 3D's `0013`, torn down after): **29/29 pass** — covers valid
  persistence; same `source_record_id` + same `ingestion_attempt_at` →
  `duplicate`; same `source_record_id` + new `ingestion_attempt_at` → new
  occurrence; different `source_record_id` → new occurrence; a signal
  with no identity/company context at all → still persists (proves
  identity resolution never gates persistence); malformed request,
  `source != "rb2b"`, and invalid timestamps all rejected before any
  write.
- Full workspace libs typecheck (`pnpm exec tsc --build`): clean.
  `@workspace/api-server` typecheck: clean. `git diff --check`: clean.
- Scope note: route-level HTTP/auth wiring was **not** re-tested with a
  duplicate test matrix — `requireServiceAuth` is reused unmodified and
  already has its own tested behavior (`signals.route.test.ts`); this
  slice's tests focus on what's actually new (the mapping and the
  duplicate/occurrence semantics), per "focused tests only."

### Next exact action for the next session

1. ~~Get explicit approval to commit 3E.2a as implemented.~~ Done —
   committed and pushed at `1794e8b`.
2. **3E.2b remains pending** — do not begin n8n fan-out wiring until
   either (1) the actual RB2B payload contract is obtained from RB2B
   configuration/documentation (addressing §20's three unresolved runtime
   questions), including a defensible native or stable event/visit
   identifier and event-time field, or (2) the first real RB2B delivery
   provides enough evidence to establish the
   `source_record_id`/`provider_observed_at` strategy for whatever calls
   this endpoint. There has never been an RB2B execution — this is not a
   matter of inspecting an existing one.
3. Do not start 3E.3/3E.4/3F until 3E.2 (both parts) is complete.

## 22. Session checkpoint — Milestone 3E.3 implementation (2026-08-20, uncommitted)

This section is the precise resume point for a fresh session. Read this
section first, then §20/§21 and the rest of this file for background.

### Status

- 3D, 3E.1, 3E.2a — DONE, committed/pushed. 3E.2b — pending (see §20/§21),
  and does not block 3E.3/3E.4/3F.
- **3E.3 — HubSpot → `identity`/`firmographic_fact`/`crm_state` adapter —
  DONE.** Committed and pushed at `f435071`.
- **3E.4 (Client Radar) — DONE locally, verified, uncommitted/unpushed —
  see §23.** 3F — NOT STARTED.

### Mappings supported

- `identity`: `domain`, `external_id` (both always emitted — HubSpot
  company id/domain are guaranteed present by `fetchHubSpotCompanyById`'s
  own contract).
- `firmographic_fact`: `company.industry`, `company.country`,
  `company.employeeRange` (raw `numberofemployees`), `company.revenueRange`
  (raw `annualrevenue`) — each emitted only when the underlying HubSpot
  property is present.
- `crm_state`: `crm.owner` (raw `hubspot_owner_id`), `crm.lifecycleStage`
  (raw `lifecyclestage` string, whenever present) — each emitted only when
  present. `crm.existingCustomer` emitted **only** when
  `lifecyclestage === "customer"` (`normalizedValue: true`); never emitted
  as an explicit `false` for any other stage (corrected during review —
  see below).

### Known gaps (explicit, per 2026-08-20 review)

- **`company.employeeRange`/`company.revenueRange` currently preserve raw
  HubSpot `numberofemployees`/`annualrevenue` values**, not bands. Value
  banding/normalization is intentionally deferred — reconciling this
  against the manual/`account_facts` banded convention is a named open
  item for 3F, where canonical reconciliation can define one
  provider-neutral value taxonomy.
- **HubSpot sync records observations before identity bootstrap.** This
  is intentional — observations are pre-resolution evidence (Milestone
  3D) and must not be gated on resolution succeeding. If identity
  bootstrap later throws (rather than returning a normal `conflict`
  result), observations may already have been durably persisted even
  though the route then returns an error response. Persistence itself is
  safe and immutable regardless; richer partial-success visibility in the
  error response is deferred and must not be read as a 3E.3 architecture
  change requirement.
- **`crm.owner` contains the HubSpot owner ID, not a resolved owner
  name** — this slice does not call HubSpot's Owners API.
- **`crm.openOpportunity`, `crm.competitorFlag`, `crm.partnerFlag`, and
  `company.region` remain unsupported/absent**, not guessed:
  `openOpportunity` would require HubSpot's Deals API (a different object
  type this client doesn't fetch); `competitorFlag`/`partnerFlag` have no
  tenant-confirmed trustworthy HubSpot property; `company.region` has no
  native HubSpot property at all (it's a derived EMEA/US/other banding
  from country).

### Review correction applied (2026-08-20)

A final review (before this checkpoint) flagged that `crm.existingCustomer`
originally emitted an explicit `false` for every non-"customer"
lifecycle stage — asserting a broader "not a customer" claim the
`lifecyclestage` field alone can't actually support (e.g. a churned
customer or a tenant-specific post-customer stage would have wrongly read
`false`). Corrected: `crm.existingCustomer` is now emitted **only** when
`lifecyclestage === "customer"`, matching the same "absence over guessed
negative" discipline already applied to `competitorFlag`/`partnerFlag`.
`crm.lifecycleStage` itself continues to be emitted unconditionally
whenever present, so no information is lost.

### Files changed

Modified: `artifacts/api-server/src/lib/hubSpotClient.ts` (expanded
fetched properties), `hubSpotClient.test.ts`, `routes/hubSpotCompanySync.ts`
(additive `observations` field in responses), `hubSpotCompanySync.route.test.ts`,
`services/hubSpotCompanySync.ts` (records observations independently of
identity bootstrap), `hubSpotCompanySync.test.ts`, `package.json`
(`test:hubspot`/`test:hubspot:unit` scripts).

New: `services/hubSpotObservationMapping.ts` (pure mapping),
`hubSpotObservationMapping.test.ts`, `hubSpotObservationMapping.integration.test.ts`.

No DB schema/migration changes — reuses 3D's `observations` table and
`recordObservation()` unmodified. No evaluator/UI/n8n changes.

### Test results

Verified externally (not re-run as part of the review-correction pass):
HubSpot unit tests 41/41 pass, `api-server` typecheck clean, HubSpot
observation Postgres integration tests 3/3 pass — against the
pre-correction code. The `crm.existingCustomer` fix changes behavior
covered by `hubSpotObservationMapping.test.ts`'s lifecycle tests (now
split into a "customer" test and a "lead" test proving `existingCustomer`
is absent) — **re-run `pnpm --filter @workspace/api-server run
test:hubspot:unit` before treating this checkpoint as verified.**

### Next exact action for the next session

Superseded — 3E.3 is now committed/pushed at `f435071`, and 3E.4 is done
locally and verified (see §23). Next action is getting approval to commit
3E.4, then starting 3F.

## 23. Session checkpoint — Milestone 3E.4 implementation (2026-08-20, uncommitted)

This section is the precise resume point for a fresh session. Read this
section first, then §22 for the HubSpot precedent this mirrors.

### Status

- 3D, 3E.1, 3E.2a, 3E.3 — DONE, committed/pushed. 3E.2b — pending (see
  §20/§21), does not block 3E.4/3F.
- **3E.4 — Client Radar → `research_intelligence` adapter — DONE locally,
  reviewed, corrected, verified. Uncommitted. Not pushed. Not deployed.
  No migration. No production change of any kind.**
- 3F — NOT STARTED. Next milestone: agreement/conflict resolution +
  canonical selection.

### Actual Client Radar topology found

`ClientRadarResultAccount` (`lib/clientRadarClient.ts`) returns
`company`/`domain`/`country`/`industry`, an opaque `account` payload, a
nullable `clientRadarAccountId`, and `evidence: { items, total }` where
each `ClientRadarEvidenceItem` is `{ id, source_type, title, url, content,
created_at }` — `id` and `created_at` are real, stable, provider-issued
per-item values (the strongest sourceRecordId/observedAt grounding of any
provider adapter built this session). All completion paths converge on
`persistCompletedClientRadarResult()` in
`services/clientRadarResearchRuns.ts`, which already ran a single
`db.transaction()` doing the run status/payload UPDATE plus the Client
Radar account-alias link (or conflict attention item). No parallel
integration was created — this milestone wires directly into that
existing convergence point.

### Mapping implemented

One `research_intelligence` observation **per evidence item** (not per
account-level result) — evidence items have real per-item ids, unlike the
account-level summary fields, which remain out of scope (still
firmographic_fact-shaped, not touched this milestone).

- `provider`: always `"client_radar"`.
- `sourceRecordId`: `evidenceItem.id` directly — Client Radar's own
  stable id, never a Mission Control account id.
- `findingType`: `evidenceItem.source_type?.trim() || "evidence_item"`.
  Open string, no invented business taxonomy — `source_type` is
  genuinely nullable in Client Radar's own client-level type
  (`nullableString` in `parseEvidenceItem`), so the neutral
  `"evidence_item"` fallback is a structural placeholder only, required
  because `ResearchIntelligenceObservationV1.findingType` is a non-blank
  string. Reviewed explicitly for collision safety: the DB's occurrence
  uniqueness constraint is `(provider, observation_class,
  source_record_id, semantic_key, imported_at)`, and `semantic_key` for
  `research_intelligence` is `findingType` — but since `sourceRecordId`
  is already the unique per-item id, two items sharing the
  `"evidence_item"` fallback never collide. The alternative (skipping
  mapping when `source_type` is absent) would silently discard genuine
  evidence findings just because Client Radar didn't categorize them —
  worse than the neutral fallback, not safer.
- `observedAt`: tolerant re-parse of `evidenceItem.created_at` via
  `new Date(...).toISOString()`, `null` if unparseable — never fabricated
  as current time. Same pattern as RB2B's "Seen At" handling.
- `importedAt`: caller-supplied `now.toISOString()` — the exact same
  `now: Date` boundary `persistCompletedClientRadarResult` already
  receives for its own DB timestamp columns, reused (never a second,
  separately generated timestamp) and shared across every observation
  from one completion attempt.
- `evidenceRefs`: always includes `{type: "client_radar_evidence_item",
  ref: evidenceItem.id}`; adds `{type: "client_radar_evidence_url", ref:
  evidenceItem.url}` only when Client Radar actually supplied a URL — no
  URL is ever invented.
- `rawValue`: the complete original evidence item, unmodified.
- `confidence`/`normalizedValue`: always `null` — Client Radar does not
  supply either.
- `providerMetadata`: `{clientRadarAccountId, company, domain}` — unlike
  HubSpot's `null`, this is populated because Client Radar's `rawValue`
  is just the lone evidence item and doesn't self-describe which company
  it's about.

### Alias-resolution independence (pre-resolution evidence rule)

Observation candidates are built and persisted **before**
`db.transaction()` is entered — not after. This means: an alias conflict
(a different account already strongly owns the Client Radar account id)
still leaves the observation persisted, since it happens before that
step is reached; and a genuine thrown alias-resolution error (a real
programming/DB error, not the expected conflict outcome) does not undo or
retroactively gate the observation write already attempted. These are two
separate, sequential writes, not one atomic operation — if the later
transaction throws, already-recorded observations are not rolled back.
The existing research-run/alias transaction's own behavior (status/payload
update, alias link, conflict attention item, rollback on genuine error) is
otherwise unchanged. A narrow optional `RecordObservationFn` DI seam
(defaulting to real `recordObservation({db, observation})`) was added
specifically so this could be unit-tested without a real DB — mirrors
`hubSpotCompanySync.ts`'s identical pattern; the one existing production
caller (`syncClientRadarResearchResult`) requires no change.

### Files changed

New: `services/clientRadarObservationMapping.ts` (pure mapping),
`clientRadarObservationMapping.test.ts`,
`clientRadarObservationMapping.integration.test.ts`.

Modified: `services/clientRadarResearchRuns.ts` (`RecordObservationFn`
type + DI seam, observations recorded before the transaction, corrected
`importedAt`/comment), `clientRadarResearchRuns.test.ts` (fake observation
recorder injected at all 8 call sites, new/enhanced assertions),
`clientRadarResearchRuns.integration.test.ts` (new conflict-path
observation-persistence test), `package.json`
(`test:client-radar`/`test:client-radar:unit` extended,
`test:observations`/`test:observations:unit` extended).

No DB schema/migration changes — reuses 3D's `observations` table and
`recordObservation()` unmodified. No new provider-specific table. No
account/person resolution, canonical truth, scoring, intent, evaluator, or
UI changes. RB2B, HubSpot, and the root `n8n` file untouched.

### Known gaps / unsupported (explicit, not silently dropped)

- Account-level summary fields (`company`, `domain`, `industry`,
  `country`) remain unmapped to any observation this milestone — still a
  documented open item, candidate `firmographic_fact` scope for a future
  slice, not 3E.4.
- `evidenceItem.content`/`title` are preserved only inside `rawValue`, not
  surfaced as separate structured fields — no normalization attempted.

### Test results

Verified externally (regular Terminal, not run by the coding agent this
pass): Client Radar unit tests 51/51 pass, Client Radar/Postgres focused
integration tests 6/6 pass, integration exit status 0, `api-server`
typecheck clean before the final verification pass.

### Next exact action for the next session

Get explicit approval to commit 3E.4, then begin 3F (agreement/conflict
resolution + canonical selection) — the first milestone that will need to
read across multiple providers' observations for the same account/person
and select a canonical value.

## 24. Session checkpoint — Milestone 3F implementation (2026-08-21, uncommitted)

This section is the precise resume point for a fresh session. Read this
section first.

### Status

- 3A–3E — DONE, committed/pushed (3E.4 at `b33a12e`). 3E.2b (n8n RB2B
  fan-out) remains independently deferred — never gated 3F, still not
  started.
- **3F — Agreement/conflict resolution + canonical selection — DONE
  locally, verified, uncommitted/unpushed.** Unit 27/27 pass
  (`test:fact-resolution:unit`), integration 5/5 pass
  (`test:fact-resolution`, disposable Postgres, full migration chain
  including 0014+0015). Full workspace typecheck clean. Migration 0014
  (resolved_facts table) + 0015 (immutability trigger) generated locally
  via the real `drizzle-kit generate`/`generate --custom` commands (never
  hand-authored) — local only, never applied to production.
  One integration fixture bug was found and fixed during verification:
  the "unjustified conflict" test originally used `hubspot` as one side,
  but `hubspot` is explicitly authoritative for `crm.owner` under
  `FACT_RECONCILIATION_POLICY_V1`, so it deterministically won — not a
  resolver defect. Fixed by using two unranked synthetic providers
  (`dealfront`/`cognism`); suite then passed 5/5.
- 3G (evaluator/UI wiring), 3H (provenance/conflict UX) — NOT STARTED.
  3F deliberately does not touch either.

### Architecture implemented

```
current manual account_facts (via account_fact_current) ─┐
                                                            ├─> FactCandidate[] ─> reconcileFactCandidates() ─> resolved_facts
bound firmographic_fact / crm_state observations          ─┘
```

- **Subject binding** (`observationSubjectBinding.ts`, pure): derived,
  never persisted. An `identity`-class observation's
  (`identityKey`/`identityValue`) maps to the exact same
  `aliasType`/`normalizedValue` convention
  `canonicalAccountResolution.ts` already uses (`"domain"` via
  `normalizeCompanyDomain`, or `` `external_id:${canonicalSourceKey(provider)}` ``
  exact-match) — reused, not reinvented. Every observation sharing a
  provider's `(provider, sourceRecordId)` with a successfully-bound
  identity observation is transitively that account's. No fuzzy
  matching; an unmatched observation is simply absent from the result,
  never guessed.
- **Reconciliation** (`factReconciliation.ts`, pure): takes
  provider-neutral `FactCandidate[]` (see shape below), groups by
  materially-equivalent value, and returns `single_source` / `agreement`
  / `conflict` / `unresolved` plus full evidence provenance.
- **Manual facts** (`factResolutionRun.ts`'s `loadManualCandidate`):
  adapts the account's CURRENT `account_facts` row (via the existing
  `account_fact_current` ⋈ `account_facts` join, same one
  `icpEvaluationResolvers.ts` already uses) into a `FactCandidate` with
  `isManual: true`. Never copied into `observations`. Only the 5 fields
  `account_facts.ts` supports can ever produce one — the 6 `crm.*` fields
  structurally never get a manual candidate.
- **Persistence** (`factResolutionRun.ts`'s `resolveAccountCanonicalField`):
  append-only insert into `resolved_facts`. No current-pointer table
  (`resolved_fact_current` was deliberately removed — see below).
  `getLatestResolvedFact` is a narrow read helper, wired into nothing.

### Files changed

New:
- `lib/db/src/schema/resolvedFacts.ts` — `resolved_facts` table.
- `lib/db/drizzle/0014_luxuriant_nuke.sql`,
  `0015_resolved_facts_immutability.sql` (+ their `meta/*_snapshot.json`,
  generated via the real `drizzle-kit` CLI, never hand-authored).
- `artifacts/api-server/src/services/factResolutionPolicy.ts` — the one
  explicit, versioned policy object.
- `artifacts/api-server/src/services/factReconciliation.ts` — pure
  resolver.
- `artifacts/api-server/src/services/observationSubjectBinding.ts` —
  pure subject binding.
- `artifacts/api-server/src/services/factResolutionRun.ts` — DB
  orchestrator (`resolveAccountCanonicalField`, `getLatestResolvedFact`).
- `factReconciliation.test.ts`, `observationSubjectBinding.test.ts`
  (pure unit), `factResolutionRun.integration.test.ts` (real Postgres).

Modified:
- `lib/db/src/schema/enums.ts` — `factResolutionState` pgEnum.
- `lib/db/src/schema/index.ts` — new exports.
- `artifacts/api-server/package.json` — `test:fact-resolution` /
  `test:fact-resolution:unit`, and both added to the aggregate
  `test`/`test:unit` scripts.

Removed (per explicit architecture-review correction — see below):
- `lib/db/src/schema/resolvedFactCurrent.ts` — built, then removed
  before any migration referenced it.

account_facts.ts / account_fact_current.ts / the evaluator / the UI —
**untouched**, as required.

### Architecture-review corrections applied mid-implementation

Two required corrections were made before this design was approved, both
already reflected in the current code — recorded here so a future
session doesn't re-litigate them:

1. **No `resolved_fact_current` pointer table.** Initially designed to
   mirror `account_fact_current`, then removed: nothing reads
   `resolved_facts` on a hot path yet (no route, no evaluator/UI wiring
   — that's 3G), so a current-pointer table would be premature caching
   of a relationship nothing consumes, and would be the one piece
   visibly creating "two current-value pointer systems" in the schema.
   `identity_resolution_events` already established this exact
   no-pointer-until-a-reader-needs-one precedent in this repo.
2. **Manual `account_facts` participates in reconciliation.** Initially
   scoped to provider observations only; corrected because the only
   real provider producing scalar `firmographic_fact`/`crm_state`
   observations today is HubSpot — reconciling only provider evidence
   while `account_fact_current` remained the value UI/evaluator actually
   read would have created two disconnected truth systems. Manual facts
   are now first-class `FactCandidate`s (see policy below), and
   `resolved_facts`' evidence columns were changed from bare
   `observations.id` arrays to provider-neutral
   `{kind: "observation" | "manual_account_fact", id}` references so
   provenance can name either kind without copying either into the
   other.

### Reconciliation candidate shape

```ts
type EvidenceReference =
  | { kind: "observation"; id: string }
  | { kind: "manual_account_fact"; id: string };

interface FactCandidate {
  evidence: EvidenceReference;
  provider: string;        // "hubspot" | ... ; "manual" for account_facts
  canonicalField: ResolvedFactCanonicalField;
  value: unknown;           // observation.normalizedValue ?? rawValue; or account_facts.value
  observedAt: Date | null;
  importedAt: Date | null;  // always null for manual (account_facts has no ingestion boundary)
  confidence: "low" | "medium" | "high" | null; // always null for manual — never fabricated
  isManual: boolean;
}
```

### Policy — `FACT_RECONCILIATION_POLICY_V1`

One explicit, versioned object (`factResolutionPolicy.ts`), read as data
by the resolver, never branched on inline:

1. A current manual `account_facts` value is unconditionally
   highest-authority for the 5 fields it covers — but ONLY applied when
   the field's representations are provably comparable (see 6 below);
   it never overrides a raw-vs-band pair it can't actually compare.
2. Without a decisive manual candidate, `providerAuthority` (per-field
   ranked provider list) decides — today every field lists only
   `["hubspot"]` (the only real firmographic_fact/crm_state provider),
   so the ranking logic itself is exercised by
   `factReconciliation.test.ts` via synthetic provider names, not by
   real data yet.
3. Failing that, defensible `observedAt` recency breaks the tie — only
   when EVERY candidate under consideration has a non-null `observedAt`
   (never preferring a dated claim over an unknown-age one).
4. `importedAt` is never used to decide which VALUE wins — only as a
   last-resort tie-break for which specific duplicate row to cite once a
   value has already won.
5. `confidence` participates only as an additional (never fabricated)
   tie-break dimension when picking a representative row — never a
   conflict decider.
6. `company.employeeRange`/`company.revenueRange` are marked
   `nonComparableFields`: confirmed by inspecting
   `accountFactValueValidation.ts` that no band taxonomy exists anywhere
   in this repo. ≥2 candidates with DIFFERING raw representations for
   these fields resolve `unresolved`, never a naive `"125"` vs `"50-200"`
   comparison. Identical raw representations still agree normally
   (literal equality needs no normalization to prove). A single
   candidate for these fields still resolves `single_source`.
7. If no rule justifies a winner, the conflict stays open with
   `canonicalValue: null` — never a guessed winner.
8. Every evidence array the resolver returns is sorted by a stable key
   before returning, making the result provably independent of
   candidate input order.

### Known gaps

- Identity observations are queried broadly (every `identity`/account-
  subject row in the table) rather than narrowed by a dedicated index —
  acceptable for this milestone's narrow internal scope, not optimized
  for scale.
- RB2B person-level subject binding is out of scope, structurally: no
  `person_aliases` table exists (`people.ts`'s own header comment scopes
  multi-source person matching as out of its unit's bounds), and RB2B
  emits no `identity` observation at all today. `behavioral_signal` never
  participates in scalar reconciliation regardless (see policy 3E.2's own
  framing) — documented, not worked around.
- Client Radar needs no binding work here: `research_intelligence` never
  participates in scalar reconciliation; its existing
  `client_radar_account_id` alias already serves whatever account-level
  attachment it needs, entirely outside this module.
- No route/evaluator/UI wiring — `resolved_facts` is computed and
  persisted but has zero consumers today. Deciding how a manual
  `account_facts` value and a `resolved_facts` value should combine for
  any given UI/evaluator read is an explicit open question for 3G, not
  decided by 3F.

### Test results — VERIFIED

Verified externally in regular Terminal (not by the coding agent):

- `pnpm --filter @workspace/api-server run test:fact-resolution:unit`
  (`factReconciliation.test.ts` — 14 pure cases + 2 structural;
  `observationSubjectBinding.test.ts` — 4 binding cases +
  fuzzy-matching/gap cases): **27/27 pass**.
- `DATABASE_URL=... pnpm --filter @workspace/api-server run test:fact-resolution`
  against a disposable Postgres instance with the full migration chain
  applied (including 0014/0015): **5/5 pass**.
- Full workspace `pnpm run typecheck` (rebuilds `lib/db`'s `dist/*.d.ts`
  via `tsc --build` first, required for `@workspace/db/schema`'s new
  exports to resolve downstream): clean.

### Next exact action for the next session

1. Get explicit approval to commit 3F.
2. Begin 3G (evaluator/UI wiring decision: how a `resolved_facts` value
   and a manual `account_facts` value combine for existing consumers) —
   not started, not designed. 3E.2b (n8n RB2B fan-out / production
   activation) remains an independently deferred, separate item — does
   not block 3G.

## 25. Session checkpoint — Milestone 3G implementation (2026-08-21, uncommitted)

This section is the precise resume point for a fresh session. Read this
section first, then §24 for the 3F precedent this integrates with.

### Status

- 3A–3F — DONE, verified. 3F unit 27/27, integration 5/5 (see §24).
- **3G — ICP/evaluator integration on canonical truth — DONE locally,
  verified, uncommitted, unpushed, not migrated to production, not
  deployed.** Unit 33/33 pass (`canonicalFactEvaluatorInput.test.ts` +
  `accountFactsSnapshotEvidence.test.ts`), integration 10/10 pass
  (`icpEvaluationResolvers.integration.test.ts`, disposable Postgres,
  full migration chain). Full workspace typecheck clean.
  One integration test fixture was corrected during verification: the
  `behavioral_signal`-exclusion test originally asserted
  `resolvedFacts.length === 0`, but `createCurrentAccountSnapshot`
  intentionally resolves and freezes all 10
  `EVALUATOR_CANONICAL_FIELDS` on every call, so a behavioral_signal-only
  account legitimately produces 10 `unresolved` entries — not a
  production defect. Corrected to assert exclusion semantics directly
  (no evidence reference to the behavioral observation, every entry
  unresolved/null); suite then passed 10/10.
- 3E.2b (n8n RB2B fan-out / production activation) remains an
  independently deferred, separate item — does not block 3H.
- 3H (provenance/conflict UX) — NOT STARTED. 3G deliberately builds no
  UI/route surface. **3H is next.**

### Architecture implemented

```
account row + resolveEvaluatorCanonicalFacts(db, accountId)   [Milestone 3F, recomputed fresh]
  -> applyResolvedFactsToNormalizedInput()  -> NormalizedAccountInputV1  -> account_snapshots.normalizedInput
  -> buildResolvedFactEvidenceEntries()     -> frozen evidence array    -> account_snapshots.rawInput
```

`createCurrentAccountSnapshot` (icpEvaluationResolvers.ts) now creates
`gtm-account-current-state-v3` snapshots unconditionally, exactly
mirroring the precedent it already set switching v1 -> v2: v1's and v2's
own builders/constants are untouched (historical snapshots stay exactly
as interpretable as before); v3 is additive, not a rewrite.
`accountEvaluations.ts` (the only caller of `createCurrentAccountSnapshot`,
2 call sites) required **zero changes** — the whole integration is
encapsulated behind that function's already-stable
`(db, accountId) => Promise<AccountSnapshot>` contract.

### B. Authoritative evaluator read path

**Recompute at the evaluation boundary — never read a possibly-stale
resolved_facts row, no background worker.** `resolveEvaluatorCanonicalFacts`
(canonicalFactEvaluatorInput.ts) calls Milestone 3F's own
`resolveAccountCanonicalField` once per evaluator-relevant field (10
fields, parallel `Promise.all`), which durably appends a fresh
`resolved_facts` row every time. Answers to the task's explicit
questions:

1. Recompute immediately before snapshot creation — yes, always.
2. Never read latest-only; always fresh.
3. No resolved_facts row for a field yet — `resolveAccountCanonicalField`
   still runs (0 candidates -> `unresolved`), so this case is
   indistinguishable from "ran and found nothing," never a special case.
4. `conflict` + `canonicalValue: null` -> evaluator field stays
   null/false/"unknown" (never guessed); the conflict is still frozen in
   `rawInput.resolvedFacts`.
5. `unresolved` -> same null/false/"unknown" handling.
6. Manual-only field, no provider observations -> 3F's own resolver
   already returns `single_source` from the manual candidate alone
   (manual facts are first-class 3F candidates, per §24) — no special
   case needed here at all.
7. Staleness after a manual-fact change or new observation -> solved by
   recomputation itself: the very next `createCurrentAccountSnapshot`
   call sees it, with no cache/pointer to invalidate.

**No double-layering:** this module never re-reads
`account_fact_current`/`account_facts` to overlay manual truth a second
time — 3F's resolver already gave manual facts their (highest, when
present) authority. The ONLY place `account_facts`/`account_fact_current`
are still read directly in this flow is the pre-existing
`resolveCurrentAccountFacts` call, kept **unchanged** solely to populate
the legacy `identity`/`evidence` evidence arrays for
`mqlDecisionReadiness.ts`'s existing v2 resolver (see D below) — that is
bookkeeping for an unrelated, untouched consumer, not a second truth
input to the evaluator.

### C. Single/agreement/conflict/unresolved handling

- `single_source` / `agreement` -> `canonicalValue` used directly.
- `conflict` WITH a policy-justified winner -> `canonicalValue` used;
  losing evidence stays in `rawInput.resolvedFacts[].conflictingEvidence`
  (never discarded).
- `conflict` WITHOUT a winner (`canonicalValue: null`) -> evaluator field
  null/false/"unknown"; conflict state itself still frozen in evidence.
- `unresolved` (no candidates, or raw-vs-band employeeRange/revenueRange
  incomparability) -> same null/false/"unknown"; never a naive
  `"125"` vs `"50-200"` comparison — unchanged 3F semantics, no band
  taxonomy invented in 3G either.
- Boolean crm fields (`openOpportunity`/`existingCustomer`/
  `competitorFlag`/`partnerFlag`) have no tri-state slot in
  `NormalizedCrmV1Schema` (lib/evaluator, unmodified) — `true` only on a
  positively-confirmed `canonicalValue === true`, `false` for every other
  case (no evidence, unresolved, unjustified conflict). This is the exact
  same conservative-default convention `buildNormalizedAccountInputFromAccount`
  already documented pre-3G, not a new invention.

### D. Snapshot/evidence changes

`accountFactsSnapshotEvidence.ts`'s `AccountFactsSnapshotEvidenceV1Schema`
gained ONE new **optional** field, `resolvedFacts` — additive only:
- `identity`/`evidence` (manual-facts-only, pre-3G) are completely
  untouched, so every existing test/consumer keeps working unmodified,
  and old v1/v2 snapshot rows (which never carry this key) still parse.
- Each `resolvedFacts` entry freezes: `canonicalField`, `resolutionState`,
  `canonicalValue`, `policyVersion`, `selectedEvidence` (nullable
  `EvidenceReference`, reused verbatim from `@workspace/db/schema` —
  never redefined), `supportingEvidence`, `conflictingEvidence`,
  `resolvedAt`. Built by `buildResolvedFactEvidenceEntries`, sorted by
  `canonicalField` for determinism.
- `mqlDecisionReadiness.ts` — ONE line added: registers
  `CURRENT_STATE_V3_SNAPSHOT_SOURCE` against the EXISTING (unmodified) v2
  evidence-backedness resolver function, since v3's `identity`/`evidence`
  arrays are byte-identical in shape/semantics to v2's. Known gap, not a
  regression: `resolvedFacts`/crm.* fields are not yet consulted for MQL
  evidence-backedness — crm.* fields were never evidence-backed before
  3G either.
- No DB schema/migration changes — `account_snapshots.rawInput`/
  `normalizedInput` are already generic `jsonb` columns.

### E. Backward compatibility

- Manual-only accounts (no observations, no resolved_facts history yet):
  3F's resolver returns `single_source` from the manual candidate alone
  — no special-casing, verified by test (see G).
- Old v1/v2 snapshots: builders/constants untouched; not migrated (per
  instruction — none needed, they remain independently interpretable).
- `accountEvaluations.ts`, `accountFacts.ts`, `accounts.ts` routes/UI:
  **zero changes.**
- Existing integration test fixtures (accountEvaluations.integration.test.ts,
  accountFacts.integration.test.ts) call `createCurrentAccountSnapshot` as
  a black-box fixture builder and never assert a literal `.source` value
  or specific company/crm content — confirmed by inspection, unaffected.

### Files changed

Modified: `icpEvaluationResolvers.ts` (`CURRENT_STATE_V3_SNAPSHOT_SOURCE`,
`createCurrentAccountSnapshot` rewired; v1/v2 builders/constants
untouched), `accountFactsSnapshotEvidence.ts` (additive `resolvedFacts`
schema field + `buildResolvedFactEvidenceEntries`),
`accountFactsSnapshotEvidence.test.ts` (new tests appended only),
`mqlDecisionReadiness.ts` (one-line v3 resolver registration),
`package.json` (`test:evaluator-canonical-facts[:unit]`, both added to
aggregate `test`/`test:unit`).

New: `canonicalFactEvaluatorInput.ts` (the 3F -> evaluator adapter:
`EVALUATOR_CANONICAL_FIELDS`, `resolveEvaluatorCanonicalFacts`,
`applyResolvedFactsToNormalizedInput`), `canonicalFactEvaluatorInput.test.ts`,
`icpEvaluationResolvers.integration.test.ts`.

Untouched: `lib/evaluator` (no scoring-model/schema change — `hubspotOwner`
naming kept as-is), `account_facts.ts`/`account_fact_current.ts` schema,
`factReconciliation.ts`/`factResolutionPolicy.ts`/
`observationSubjectBinding.ts`/`factResolutionRun.ts` (3F itself, no
redesign), all routes, all UI, RB2B/Client Radar adapters, `n8n`. No DB
migration.

### Known gaps

- `crm.lifecycleStage` is never resolved or frozen in 3G — no evaluator
  field exists for it (`NormalizedCrmV1Schema` has no slot, no
  allowlist references it) — a future evaluator schema change would be
  required first, out of this milestone's scope.
- `crm.hubspotCompanyId`/`crm.hubspotContactId` remain always null —
  these are `identity`-class data (subject binding), not `crm_state`
  canonical facts; 3F produces no resolution for them.
- `mqlDecisionReadiness.ts`'s v3 registration reuses v2's resolver
  verbatim — the new `resolvedFacts` evidence is not yet consulted for
  MQL evidence-backedness (pre-existing scope, not widened here).
- No route/UI change — 3H still owns provenance/conflict UX.
- `crm.owner` -> `hubspotOwner` remains a provider-prefixed evaluator
  field name (pre-existing, not renamed — see canonicalFactEvaluatorInput.ts's
  own comment on why renaming it is out of 3G's scope).

### Test results — VERIFIED

Verified externally in regular Terminal (not by the coding agent):

- `pnpm --filter @workspace/api-server run test:evaluator-canonical-facts:unit`
  (`canonicalFactEvaluatorInput.test.ts` + `accountFactsSnapshotEvidence.test.ts`
  — the latter's pre-existing tests passed unmodified, proving backward
  compatibility): **33/33 pass**.
- `DATABASE_URL=... pnpm --filter @workspace/api-server run test:evaluator-canonical-facts`
  against a disposable Postgres instance with the full migration chain
  applied: **10/10 pass** (after the fixture correction below).
- Full workspace `pnpm run typecheck`: clean.

One integration fixture was corrected during verification (test-expectation
bug, not a production defect): the `behavioral_signal`-exclusion test
asserted `resolvedFacts.length === 0`, but `createCurrentAccountSnapshot`
intentionally resolves and freezes all 10 `EVALUATOR_CANONICAL_FIELDS` on
every call — a behavioral_signal-only account legitimately produces 10
`unresolved` entries referencing no behavioral evidence. Corrected to
assert exclusion semantics directly; suite then passed 10/10.

### Next exact action for the next session

1. Get explicit approval to commit 3G.
2. Begin 3H (provenance/conflict UX) — not started, not designed.
   3E.2b (n8n RB2B fan-out / production activation) remains an
   independently deferred, separate item — does not block 3H.

## 26. New-session startup instruction

> Read this file first. Then inspect the referenced canonical docs and current
> git state. Do not assume historical notes are still true if the repository
> contradicts them. Do not start implementation until you can state the
> current milestone, next slice, hard boundaries, and files likely involved.
