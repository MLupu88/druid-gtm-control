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
  IMPLEMENTED, reviewed, corrected.** Uncommitted. See §22 for the full
  checkpoint (mappings, known gaps, review corrections).
- **3E.4 — Client Radar → `research_intelligence` adapter — NOT STARTED.**
- **3F — NOT STARTED.**

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

- 3D, 3E.1, 3E.2a — DONE, committed/pushed. 3E.2b — pending (see §20/§21).
- **3E.3 — HubSpot → `identity`/`firmographic_fact`/`crm_state` adapter —
  IMPLEMENTED, reviewed, corrected. Uncommitted. Not pushed. Not deployed.
  No migration. No production change of any kind.**
- 3E.4 (Client Radar), 3F — NOT STARTED.

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

1. Run `pnpm --filter @workspace/api-server run test:hubspot:unit` (and
   the integration suite, DB permitting) to confirm the `existingCustomer`
   correction. 2. Get explicit approval to commit 3E.3. 3. **3E.4 — Client
   Radar → `research_intelligence` adapter** is next per the Milestone 3
   sequence (§10) — not started, not designed.

## 23. New-session startup instruction

> Read this file first. Then inspect the referenced canonical docs and current
> git state. Do not assume historical notes are still true if the repository
> contradicts them. Do not start implementation until you can state the
> current milestone, next slice, hard boundaries, and files likely involved.
