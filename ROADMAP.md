# Product Roadmap

This roadmap covers the **complete connected product**, spanning two separate
applications, repositories, and deployments:

1. **DRUID GTM Mission Control** (this repository) — the internal review
   cockpit for the GTM signal engine.
2. **Client Radar** (separate repository, separate deployment) — the
   research/enrichment service that Mission Control hands accounts off to.

They are connected via an n8n orchestration boundary and a handoff contract,
**not** by shared code, a shared database, or a shared deployment. Nothing in
this roadmap merges the two repositories.

This file is the authoritative planning document for both products. It does
not replace or simplify any previously defined architecture — it consolidates
existing product scope and adds the next major package.

**A note on status language used throughout this document:** "merged to
`main`" means the code is on the `main` branch of this repository. It does
**not** by itself mean a database migration has been executed against the
production database, or that the change is running in production — those are
separate, verifiable facts (see `DEPLOYMENT.md` for how to check what's
actually deployed). Where this document says "deployed" or "live in
production," that has been independently confirmed; where it only says
"merged to `main`" or "committed," deployment/execution status is not
asserted.

---

## Current Product State (as of PR #27)

PR #27 (`feat/accounts-icp-completion`, commits `eb7eb87` and `4f0c193`) is
**merged to `main`**. This section describes what that leaves the product
able to do. It does not assert that PR #27 is running in production or that
migration `0005_add_dismissed_routing_output.sql` has been executed against
the production database — both are committed to `main`, and their live
deployment/execution status should be confirmed against the running system
(see `DEPLOYMENT.md`) before being treated as fact.

### Canonical data foundation

- **Canonical PostgreSQL accounts, snapshots, evaluations, and decisions.**
  Accounts, normalized account snapshots, ICP evaluations, and account
  decisions are persisted records (Drizzle ORM over PostgreSQL), not
  recomputed in the frontend or read live from Google Sheets.
- **Canonical configurable ICP profiles and evaluator core.** ICP profile
  configuration is separated from evaluation logic; profiles are versioned
  and persisted; the evaluator runs against a persisted profile version and
  produces structured, explainable results.
- **Production database, migration, and bootstrap foundation.** A dedicated
  GTM PostgreSQL deployment, a Drizzle migration history (through migration
  `0005`, committed to `main`), and a bootstrap process that imports curated
  target accounts and an initial active ICP profile all exist in the
  repository.

### Account workspace

- **Accounts is the canonical company workspace.** Every canonically
  resolved company — regardless of decision state — lives in Accounts,
  backed by persisted canonical records. Unresolved incoming queue rows
  remain visible in Needs Attention until they can be matched to a
  canonical account.
- **ICP profile selection, evaluation preview, and evaluation history at
  the account level.** Operators can select a profile, preview an
  evaluation against it, and review prior evaluations directly on the
  account record.
- **Consolidation of Needs Attention into the Accounts workspace.**
  Needs Attention is an **operational view inside Accounts** — a filtered,
  derived slice of canonical accounts, not a separate workspace or a
  parallel queue with its own logic.
- **Canonical persistence for Promote to MQL and Dismiss.** These actions
  write durable, attributable account decision records; they are not
  frontend-only state.
- **Latest canonical decision on account records.** Every account record
  surfaces its most recent decision, so an account's current state is
  never ambiguous between the account view and the Needs Attention view.
- **Resolved companies remain in Accounts with their evaluation and
  decision history.** Promoting or dismissing an account does not remove
  it from the product — it moves out of Needs Attention while its full
  evaluation and decision history stays attached to the account record.
- **Consistent removal of MQL/dismissed accounts from Needs Attention.**
  Once an account is resolved (promoted or dismissed), it is removed
  consistently from every Needs Attention count, filter, chip, empty
  state, and rendered row — there is no view where a resolved account
  still appears as pending attention.
- **Truthful owner-alert request handling.** Owner-alert actions reflect
  real request/attribution state rather than an optimistic or inferred
  success.

### Sample Mode

- **Sample Mode and its action guardrails.** A dedicated live/sample view
  toggle (`SampleModeProvider` / `useSampleMode`) gates which data is shown
  and disables state-changing actions while in sample mode, so demo/sample
  data can never be mistaken for — or accidentally produce — a real
  decision or activation.

### Client Radar integration

- **The Client Radar server-to-server handoff is complete**, not
  unfinished: authenticated scan creation, workspace-safe account identity,
  explicit purpose, external correlation ID, and idempotency are
  implemented and wired into the account detail view.
- **Completed-result retrieval, evidence, and source display.** Client
  Radar research is surfaced on the account detail view with its
  underlying evidence and source attribution visible. This is the core
  Client Radar integration working end to end for completed scans —
  what remains (composer enrichment, see Next Delivery Sequence below) is
  new, additive scope, not a gap in this core integration.

This substantially delivers the intent of prior roadmap Packages 1–5
(Business Truth & Activation Composer Foundation; Canonical Account
Evaluation & Configurable ICP Profiles; the canonical-records foundation of
Persistent Canonical Records and Leads Workspace; Client Radar Handoff &
Opportunity Intake; Server-to-Server Client Radar API and Status
Synchronization). Their detailed scope, acceptance criteria, and any
remaining open items are preserved in "Detailed Scope and Historical Package
Reference" below, with status labels updated accordingly.

---

## Next Delivery Sequence

### 1. Canonical operational workspace migration

*Immediate next package.*

**Current transitional model:**

```
Sheets queue → canonical account matching → PostgreSQL decisions
```

**Target model:**

```
canonical accounts + evaluations + decisions → database-derived operational workspace
```

Accounts is canonical today. Needs Attention is consolidated into the
Accounts workspace and uses canonical decisions to close resolved rows,
but its incoming queue remains part of the transitional Sheet-backed
model. The remaining transitional piece is that not every operational
queue is yet a first-class, independently addressable, database-derived
view. Add database-derived states and queues for:

- MQL
- Sales Review
- Pipeline Assist
- Owner Alert
- Nurture
- Retargeting
- Suppressed
- failures
- missing identity or enrichment
- re-score candidates

Each queue must be derived from persisted canonical decisions/evaluations —
none computed ad hoc in the frontend — with pagination, search, filters,
sorting, and loading/empty/stale/error states. See Package 3 in "Detailed
Scope and Historical Package Reference" below for the full views/forms
breakdown and acceptance criteria this package inherits.

### 2. Client Radar composer enrichment

A new high-value enhancement on top of the completed Client Radar core
integration — **not** unfinished Client Radar work:

- select completed, sourced Client Radar findings;
- insert them into email and LinkedIn composer context;
- retain source links and provenance;
- compare standard and Client Radar-enriched drafts;
- store draft history (pre- and post-enrichment drafts both retrievable);
- no automatic sending;
- no fabricated contacts;
- no suppression bypass.

Only `completed` findings may enrich composer context — `scanning`,
`failed`, or `stale` results are never used for composition, and a
stale/absent Client Radar result must degrade cleanly to GTM-only
composition. See Package 6 below for full acceptance criteria.

### 3. n8n boundary migration

- keep n8n for intake, normalization, and orchestration;
- move canonical scoring and decision authority into the application (no
  n8n workflow may reintroduce duplicated canonical scoring);
- treat Google Sheets as transitional sync/export rather than authority;
- use parallel result comparison (old vs. new evaluator) before cutover.

This is Package 2, Phase 4 below, carried forward as still-open work.

### 4. Connector control plane and staged integrations

Staged, controlled integrations for:

- HubSpot
- Dealfront
- RB2B
- Cognism
- Retell
- Salesforge
- Dripify
- advertising audiences

Clarify the distinction between, and make each state independently visible
and auditable:

- **configured** — connector credentials/config exist
- **requested** — an action was requested by an operator or the system
- **recorded** — the request is durably persisted
- **dispatched** — the request was sent to the external provider
- **externally confirmed** — the provider confirmed the outcome (never
  inferred from elapsed time or a queued request)

Corresponds to Packages 8–9 below.

### 5. Multi-profile ICP and operating controls

Multiple active profiles where authorized, account/campaign/region/
workspace/source/operator-based profile assignment, evaluation against
multiple profiles, comparative fit results and best-profile recommendation,
profile-specific routing, re-score by profile, and profile performance
reporting — activating the forward-compatible schema already in place from
the canonical evaluator work. Corresponds to Package 7 below.

### 6. Microsoft Entra authentication and RBAC

Title and position only — not yet scoped in detail. Corresponds to
Package 13 below.

### 7. DRUID Entities and Data Service integration

Placed after the domain model is proven in production. Title and position
only — not yet scoped in detail. Corresponds to Package 14 below.

### 8. Production hardening and cutover

- migration execution;
- deployment;
- production verification;
- rollback readiness;
- final cutover.

Corresponds to Packages 10–12 and 15 below.

---

## Permanent invariants

Carried forward unconditionally — not one-time migration steps:

- Company intelligence must never manufacture a contact or make an
  unidentified account eligible for person-addressed outreach.
- No UI may claim external execution without provider-backed confirmation.
- No research source (including Client Radar composer enrichment) may
  bypass identity, eligibility, suppression, or routing.
- No n8n workflow may reintroduce duplicated canonical scoring.
- Historical evaluations and decisions remain immutable; corrections are
  recorded alongside the original value, never overwriting it.

---

## Detailed Scope and Historical Package Reference

This section preserves the full package-level detail, acceptance criteria,
and dependency history that "Current Product State" and "Next Delivery
Sequence" above summarize. Status labels have been updated to reflect
what's actually merged to `main`; detailed requirements are otherwise left
intact even where their foundation is now complete, since they still define
the acceptance bar for remaining/related work.

### Roadmap order (original sequencing, statuses updated)

1. ✅ Completed — Business Truth & Activation Composer Foundation
2. ✅ Substantially delivered — Canonical Account Evaluation & Configurable
   ICP Profiles (Phases 0–2 and account-level profile/evaluation UI; Phase 4
   n8n boundary migration remains open — see Next Delivery Sequence #3)
3. ▶️ Next — Persistent Canonical Records and Leads Workspace, Views & Forms
   (canonical-records foundation delivered; full queue/views breakdown is
   Next Delivery Sequence #1)
4. ✅ Completed — Client Radar Handoff & Opportunity Intake
5. ✅ Completed — Server-to-Server Client Radar API and Status
   Synchronization
6. ▶️ Next — Evidence-Backed Client Radar Composer Enrichment (Next
   Delivery Sequence #2)
7. Multi-Profile Assignment & Comparative Evaluation (Next Delivery
   Sequence #5)
8. Common Connector Framework & Capability Registry (Next Delivery
   Sequence #4)
9. Controlled Live Integrations (Next Delivery Sequence #4)
10. Controlled Real-Data Pilot (Next Delivery Sequence #8)
11. Corporate Systems and Departmental Clearance (Next Delivery Sequence #8)
12. DevOps and Production Architecture Review (Next Delivery Sequence #8)
13. Microsoft Entra and Role Enforcement (Next Delivery Sequence #6)
14. DRUID Entities and Data Service Migration (Next Delivery Sequence #7)
15. Production Hardening and Final Cutover (Next Delivery Sequence #8)

---

### Cross-cutting prerequisite: Canonical `message_context` & claim guardrails

This is not one of the 15 numbered packages — it is a contract that Package 1
began, that Package 2 (evaluator reasons), Package 3 (persisted per-channel
policy), and Package 6 (composer enrichment) all depend on. **It is not fully
built yet.** Package 1 shipped a sanitized, allowlisted "Based on these
signals" evidence section inside the composer (PR #12) and several of the
underlying rules as scattered, independently-enforced checks (identified-
contact gate, `getResearchEligibility()`, per-button disabled logic). That is
real, tested protection — but it is not the same thing as a single canonical
`message_context` contract, and this roadmap does not claim that contract is
finished.

**Required canonical `message_context` fields (not yet consolidated into one
contract):**

- account identity
- person/contact identity
- identity confidence
- evidence
- evidence provenance
- directly observed facts
- approved capability claims
- prohibited claim patterns
- suppression/DNC state
- research eligibility
- prospecting eligibility
- per-channel policy
- reason for every allowed or blocked action

**Invariant (must hold everywhere this contract is consumed):**

> Company intelligence must never manufacture a contact or make an
> unidentified account eligible for person-addressed outreach.

**Claim guardrails must prevent:**

- invented customer facts
- invented ROI figures
- unsupported comparisons
- creepy visitor-surveillance language
- claims not backed by evidence or an approved claims library

**Status:** partially implemented as scattered, tested logic across the
frontend (see Package 1), plus canonical persistence for decisions and
evaluations delivered through PR #27 (see "Current Product State" above).
Formalizing the full `message_context` contract into one canonical,
persisted object is still required work, and is a hard dependency for
Package 6 (Client Radar composer enrichment) — enrichment may not bypass or
weaken any of the fields or the invariant above.

---

### 1. ✅ Completed — Business Truth & Activation Composer Foundation

Shipped in PR #10, #11, #12 (merged to `main`).

- Removed fabricated Signal Pulse scoring; replaced with a truthful Queue
  Summary of real, already-computed counts.
- Unconditional identified-contact requirement for Email/LinkedIn drafts,
  enforced independently at every layer (button visibility, disabled-state
  logic, composer, `ActionModal`), including against `previewOnly` bypass.
- `getResearchEligibility()` as a separate, tested rule — research eligibility
  decoupled from outbound-prospecting restrictions.
- Truthful unavailability messaging: three distinct, honestly-labeled
  categories (temporary/pending-compliance, not-applicable-for-recommendation,
  not-enabled-yet) instead of one generic "coming later."
- Edit-safe composer resets — confirmation before discarding an edited,
  unconfirmed draft; "Reset from signals" replaces the misleading
  "Regenerate from signals."
- Deterministic multi-angle composer (Use-case led, Business-value led,
  General outreach) — local, deterministic, non-LLM, with edit-safe angle
  switching and a sanitized, allowlisted "Based on these signals" evidence
  section.
- Truthful activation lifecycle preserved throughout (accepted / persisted /
  execution requested / execution confirmed / failed — never a false
  success).

This is real, shipped scope — but it is **not** the full canonical
`message_context` contract described above. That formalization work remains
open and is carried forward into Packages 2 and 3.

---

### 2. ✅ Substantially delivered — Canonical Account Evaluation & Configurable ICP Profiles

*GTM Mission Control.*

**Status update:** Phase 0 (rule discovery), Phase 1 (persistent canonical
records), Phase 2 (canonical deterministic evaluator), and account-level
profile selection/evaluation preview/evaluation history (mounted via PR #23)
are merged to `main` — see "Current Product State" above. Phase 3 (decision
and routing policy) is delivered for MQL/Dismiss specifically (PR #27); the
full routing set (Sales Review, Pipeline Assist, Owner Alert, Retarget,
Nurture, Suppressed) is carried forward into Next Delivery Sequence #1.
Phase 4 (n8n boundary migration) remains open — Next Delivery Sequence #3.
Phase 5 (ICP administration UI beyond the account-level selector/preview)
and Phase 6 (parallel-run cutover) status should be re-verified against
current code before being treated as complete or incomplete. The phase
detail, data model, and acceptance criteria below remain the reference for
this package's full scope.

#### Core architectural decisions

- Separate ICP profile configuration from evaluation logic.
- Separate fit, intent, eligibility, and routing.
- Hard disqualifiers sit outside weighted scoring.
- Every evaluation records profile version and evaluator version.
- Preserve normalized input snapshots or a reproducible equivalent.
- Existing evaluations are immutable.
- Re-scoring is explicit and creates a new evaluation record.
- n8n orchestrates but must not own duplicated canonical scoring formulas.
- Start with **one draft profile and one active immutable profile version**.
- PostgreSQL-backed canonical records must precede the administration UI.
- Google Sheets may remain a temporary synchronization/export surface, but
  not the authority for profile versioning or evaluation history.

#### Forward-compatible data model (schema only — not orchestration)

The first release ships a single active profile with no concurrent
multi-profile orchestration. The data model must nonetheless be shaped so
the following can be added later **without a schema rewrite**:

- Multiple active profiles where authorized (e.g. Enterprise Banking ICP,
  US Healthcare ICP, EMEA Insurance ICP, Partner-led ICP, Campaign-specific
  ICP).
- Account-to-profile assignment.
- Campaign-to-profile assignment.
- Region-, workspace-, account-type-, source-, or operator-based assignment.
- Evaluation against multiple profiles.
- Comparative fit results and best-profile recommendation.
- Profile-specific routing.
- Re-score by profile.
- Profile performance reporting.

Actual multi-profile orchestration and comparative evaluation are delivered
in Package **7 (Multi-Profile Assignment & Comparative Evaluation)**, not
here.

#### Phase 0 — Rule discovery and truth map

- Inventory every current ICP criterion, score component, weight, threshold,
  hard disqualifier, routing rule, and missing-data assumption.
- Record whether each rule currently lives in Google Sheets, n8n, API,
  frontend, shared libraries, or mock data.
- Classify every rule as fit, intent, eligibility, or routing.
- Identify which current scoring model actually feeds the cockpit.
- Document duplicated and conflicting logic.

**Deliverable:** one approved canonical rule map and migration plan. See
`docs/icp-rule-discovery.md` — note that document itself records some
Phase 0 exit criteria (live Google Sheets configuration values, a handful of
product/legal decisions) as still outstanding.

#### Phase 1 — Persistent canonical records

- PostgreSQL-backed accounts
- ICP profiles
- Immutable ICP profile versions
- Profile activation history
- Normalized account snapshots
- Account evaluations
- Structured score components
- Decision history
- Re-score jobs
- Audit attribution

#### Phase 2 — Canonical deterministic evaluator

**Input:** normalized account snapshot, immutable ICP profile version,
evaluator version.

**Output:** fit score and tier, intent score and tier, eligibility outcome,
matched rules, missing inputs, restrictions, hard disqualifiers, structured
score components.

#### Phase 3 — Decision and routing policy

Combines evaluation with identified contact, customer status, open
opportunity, ownership, suppression, previous actions, and engagement
recency to produce: MQL, Sales Review, Pipeline Assist, Owner Alert,
Retarget, Nurture, Suppressed. MQL and Dismiss are canonically persisted as
of PR #27; the remaining routing outcomes above are not yet independent,
database-derived states — see Next Delivery Sequence #1.

#### Phase 4 — n8n boundary migration

- Centralize scoring.
- Remove duplicated hard-coded industries, regions, titles, weights,
  thresholds, disqualifiers, and missing-equals-zero assumptions.
- Keep receivers, normalization, enrichment, event logging, and activation
  workflows mostly independent of ICP configuration.

Open — see Next Delivery Sequence #3.

#### Phase 5 — ICP administration UI

View active profile, edit draft, validate, compare draft vs active, activate
immutable version, version history, audit attribution, impact preview,
explicit re-score controls.

#### Phase 6 — Account explanation and controlled cutover

Show profile ID/version, evaluator version, fit and intent, eligibility,
component scores, matched rules, missing inputs, restrictions/disqualifiers,
final routing reasons. Run old and new evaluators in parallel before cutover.

#### Re-score model

Durable job, fixed profile version, preview/apply mode, selected
accounts/queue/eligible accounts/all accounts, queued/running/completed/
partial-failure/failed states, batching, idempotency, restartability,
progress and failure reporting, impact summary (tier movement, new/removed
MQLs, new disqualifications, unchanged accounts).

#### Acceptance criteria

- No target ICP criterion hard-coded in frontend.
- No signal receiver independently calculates canonical ICP fit.
- One canonical evaluator.
- Fit, intent, eligibility, and routing independently explainable.
- Profile version and evaluator version recorded on every evaluation.
- Normalized inputs preserved or reproducible.
- Missing inputs explicitly marked not evaluated.
- Hard disqualifiers explicit.
- Activated profile versions immutable.
- Activation creates a new version.
- Historical evaluations never silently overwritten.
- Re-scoring explicit and fixed to one profile version.
- Routing consumes canonical evaluation and decision results.
- Deterministic fixture tests.
- Old/new evaluator comparison available during migration.
- Data model supports future multiple ICP profiles without a schema rewrite
  (see "Forward-compatible data model" above).

#### Explicitly out of scope (this package)

- Live RB2B, Dealfront, Cognism, HubSpot, Salesforge, Dripify, Retell, or
  ad-platform integrations.
- Microsoft Entra.
- DRUID Data Service migration.
- LLM-generated scoring.
- Concurrent multi-profile orchestration (schema-ready only; see Package 7).
- Final enterprise permissions architecture.

---

### 3. ▶️ Next — Persistent Canonical Records and Leads Workspace, Views & Forms

*GTM Mission Control.*

**Status update:** the canonical-records foundation this package depends on
(Package 2, Phase 1) is merged to `main`, and Accounts/Needs Attention now
operate on it — the description below of a "mock-data / Sheets-backed"
Queue view is superseded; see "Current Product State" above. What remains
open from this package is the full set of independent, database-derived
operational queues (MQL, Sales Review, Pipeline Assist, Owner Alert,
Retarget, Nurture, Suppressed, failed/incomplete, missing identity/
enrichment, re-score review) beyond Accounts/Needs Attention, plus the forms
and persistence behaviors below not yet confirmed built. This is Next
Delivery Sequence #1. It also completes the canonical `message_context`
contract described in the cross-cutting prerequisite section, so every view
and form here operates on one persisted, explainable record — not scattered
frontend logic.

#### Views

- Persistent Leads table
- Account/lead detail view
- MQL queue
- Sales Review queue
- Pipeline Assist queue
- Owner Alert queue
- Retarget queue
- Nurture queue
- Suppressed queue
- Failed/incomplete processing queue
- Missing identity queue
- Missing enrichment queue
- Re-score review queue
- Decision history view
- Activation/outbox/execution history view

#### Forms

- Manual lead creation
- Lead/account edit
- Contact correction
- Review and decision
- Ownership
- Suppression
- Activation
- Re-score

#### Persistence and behaviour

- Decisions persist.
- Operator overrides persist.
- Ownership and reassignment history persist.
- Suppression and expiry persist.
- Corrections preserve original source values (never overwrite the source
  fact — corrections are recorded alongside it).
- Activation requests create durable records.
- Outbox state is separate from execution confirmation (a request being
  queued is not proof it executed).
- Historical evaluations remain immutable.
- Queue membership comes from canonical persisted decisions, not from
  recomputing routing logic in the view layer.
- Records are URL-addressable.
- Pagination, search, filters, and sorting on every list view.
- Loading, empty, stale, error, and retry states on every view.
- No critical operator action exists only in frontend state.
- Frontend does not depend on raw Google Sheet row structure.
- Google Sheets is not the operational workspace.

#### Acceptance criteria

- Every queue above is derived from persisted canonical decisions/evaluations
  — none is computed ad hoc in the frontend.
- Every form writes a durable, attributable record; none silently succeeds
  without a persisted result.
- Contact/account corrections are auditable: original source value and
  corrected value are both retrievable.
- Re-opening the app or refreshing mid-session never loses a decision,
  override, or in-flight activation record.
- No view can be reached that reads directly from a Google Sheet at request
  time for operational (non-export) purposes.
- Outbox vs. execution-confirmed states are visibly distinct in every history
  view (carries forward the Package 1 truthful-lifecycle rule: never claim
  success without provider-backed proof).

---

### 4. ✅ Completed — Client Radar Handoff & Opportunity Intake

*Client Radar — separate repository, separate deployment.*

**Status update:** merged to `main` — see "Current Product State" above.

#### Scope

- GTM actions such as "Create Client Radar review" and "Open in Client
  Radar."
- Explicit research purpose, including: new prospecting research, pipeline
  assistance, owner support, account expansion, and existing-customer
  intelligence.
- Workspace identity.
- Account identity.
- Contact identity where legitimately known (never fabricated to satisfy
  this package — see the cross-cutting invariant).
- External correlation ID.
- Idempotency key.
- Duplicate prevention.
- Research request state.
- Provenance.
- Source evidence.
- No manufactured contact.
- Research eligibility remains distinct from outbound eligibility (carries
  forward `getResearchEligibility()` from Package 1 — a suppressed or
  existing-customer account can still be research-eligible while remaining
  prospecting-ineligible).
- No automatic MQL.
- No automatic activation.
- Independently deployable applications (Client Radar ships and deploys on
  its own schedule, separate from Mission Control).

#### Acceptance criteria

- Every "Create Client Radar review" / "Open in Client Radar" action carries
  an explicit purpose, a workspace identity, an account identity, an external
  correlation ID, and an idempotency key.
- A contact identity is attached only when legitimately known from Mission
  Control's own identified-contact data — never synthesized to make the
  handoff "complete."
- Re-submitting the same request with the same idempotency key does not
  create a duplicate research request.
- Research request state is visible and distinct from prospecting
  eligibility state at all times.
- No handoff can, by itself, produce an MQL, a routing decision, or an
  activation.
- Client Radar can be deployed, redeployed, or rolled back independently of
  a Mission Control deploy.

---

### 5. ✅ Completed — Server-to-Server Client Radar API and Status Synchronization

*Client Radar — separate repository, separate deployment.*

**Status update:** merged to `main`, including completed-result retrieval,
evidence, and source display on the account detail view — see "Current
Product State" above.

#### Dependable minimum handoff path

- Authenticated scan creation.
- Workspace-safe account identity.
- Explicit purpose.
- External correlation ID.
- Idempotency.
- Duplicate prevention.
- Status retrieval.
- Evidence-backed result retrieval.

#### Persisted statuses

- `not_created`
- `creation_requested`
- `created`
- `scanning`
- `completed`
- `failed`
- `stale`

#### Explicit rules

- Repeated requests with the same idempotency key must not create duplicate
  accounts or scans.
- Mission Control must not display `completed` until Client Radar confirms
  completion — no optimistic or inferred completion state.
- Failures and stale results must be visible in Mission Control, not
  silently dropped or shown as pending indefinitely.
- A workflow JSON file on disk is not proof of a live imported workflow —
  status must reflect the running system, not the repository.

#### Acceptance criteria

- Every scan-creation call is authenticated server-to-server; no client-side
  credentials or direct browser calls to Client Radar.
- Status transitions are monotonic and auditable (no silent state reversal
  without a recorded reason, e.g. `completed` → `stale`).
- `completed` is only reachable via a Client Radar-confirmed response, never
  inferred from elapsed time or a queued request.
- `failed` and `stale` are rendered distinctly from each other and from
  `scanning` in every consuming view.
- Idempotency key reuse is covered by a test that asserts no duplicate
  account or scan record is created.

---

### 6. ▶️ Next — Evidence-Backed Client Radar Composer Enrichment

*Client Radar → Mission Control canonical `message_context`.*

**Status update:** the Client Radar core integration this package builds on
(handoff, status sync, completed-result retrieval, evidence display) is
complete — see "Current Product State" above. This package itself
(composer enrichment) has not started; it is Next Delivery Sequence #2.

#### Scope

- Only completed Client Radar findings may enrich `message_context` — no
  `scanning`, `failed`, or `stale` result is used for composition.
- Findings require provenance.
- Source URLs remain visible.
- Imported research is distinguishable from GTM evaluation in the UI —
  never merged into one undifferentiated evidence block.
- Synthetic fixtures remain marked synthetic (carries forward the
  `provenance:"synthetic_demo_fixture"` convention from Package 1's fixture
  work).
- Stale, failed, or absent Client Radar data degrades cleanly to
  GTM-only composition — the composer must never block or silently fabricate
  content when Client Radar data isn't available.
- Client Radar research cannot manufacture a contact (the cross-cutting
  invariant applies here without exception).
- Research evidence cannot override suppression or prospecting eligibility.
- No automatic activation.
- Previous GTM-only drafts and later enriched drafts remain auditable
  (both versions retrievable, not overwritten).

#### Acceptance criteria

- A finding with `status != completed` never appears in a composed draft.
- Every enrichment-sourced claim in a draft carries a visible source URL and
  provenance marker.
- Removing or failing the Client Radar integration entirely still produces a
  valid GTM-only draft with no error state exposed to the operator as a
  blocker.
- No enrichment path can flip a suppressed or prospecting-ineligible account
  to eligible.
- No enrichment path can attach a contact identity that Mission Control did
  not already hold.
- Both the pre-enrichment and post-enrichment draft are retrievable in
  history — enrichment never silently replaces an existing draft's record.

---

### 7. Multi-Profile Assignment & Comparative Evaluation

*GTM Mission Control. Activates the forward-compatible schema from Package 2.
Corresponds to Next Delivery Sequence #5.*

- Multiple active profiles where authorized
- Account-to-profile assignment
- Campaign-to-profile assignment
- Region-, workspace-, account-type-, source-, or operator-based assignment
- Evaluation against multiple profiles
- Comparative fit results and best-profile recommendation
- Profile-specific routing
- Re-score by profile
- Profile performance reporting

Detailed phase breakdown not yet defined.

---

### 8. Common Connector Framework & Capability Registry

Title and position only — not yet scoped in detail. Corresponds to Next
Delivery Sequence #4.

### 9. Controlled Live Integrations

Title and position only — not yet scoped in detail. Note: live RB2B,
Dealfront, Cognism, HubSpot, Salesforge, Dripify, Retell, and ad-platform
integrations remain out of scope until this package or later. Corresponds
to Next Delivery Sequence #4.

### 10. Controlled Real-Data Pilot

Title and position only — not yet scoped in detail. Corresponds to Next
Delivery Sequence #8.

### 11. Corporate Systems and Departmental Clearance

Title and position only — not yet scoped in detail. Corresponds to Next
Delivery Sequence #8.

### 12. DevOps and Production Architecture Review

Title and position only — not yet scoped in detail. Corresponds to Next
Delivery Sequence #8.

### 13. Microsoft Entra and Role Enforcement

Title and position only — not yet scoped in detail. Corresponds to Next
Delivery Sequence #6.

### 14. DRUID Entities and Data Service Migration

Title and position only — not yet scoped in detail. Corresponds to Next
Delivery Sequence #7.

### 15. Production Hardening and Final Cutover

Title and position only — not yet scoped in detail. Corresponds to Next
Delivery Sequence #8.

---

### Roadmap dependency rules

- The canonical evaluator (Package 2, Phase 2) depends on the approved rule
  map (Package 2, Phase 0).
- ICP administration (Package 2, Phase 5) depends on canonical
  profile/version persistence (Package 2, Phase 1).
- The Leads workspace (Package 3) depends on canonical accounts,
  evaluations, decisions, and history (Package 2, Phase 1).
- Client Radar handoff (Package 4) depends on durable request and status
  records (Package 5).
- Composer enrichment (Package 6) depends on confirmed Client Radar results
  with provenance (Package 5's `completed` status, never `scanning`/
  `failed`/`stale`).
- Multi-profile assignment (Package 7) depends on immutable profile/version
  records (Package 2's forward-compatible schema).
- Live integrations (Package 9) depend on durable outbox and
  execution-proof semantics (Package 3).
- Microsoft Entra (Package 13) depends on a stable role and permission
  model (not yet defined; upstream of Package 13, not delivered by it alone).
- DRUID Data Service migration (Package 14) depends on a proven canonical
  schema (Package 2 + Package 3, validated in production).
- No n8n workflow may reintroduce duplicated canonical scoring (applies from
  Package 2, Phase 4 onward, permanently).
- No UI may claim external execution without provider-backed confirmation
  (carries forward the Package 1 truthful-lifecycle rule, permanently).
- No research source may bypass identity, eligibility, suppression, or
  routing (applies to Package 4 and Package 6, permanently — this is the
  cross-cutting invariant, not a one-time migration step).

---

### Out of scope for the immediate next package (canonical operational workspace migration)

- Live RB2B, Dealfront, Cognism, HubSpot, Salesforge, Dripify, Retell, or
  ad-platform integrations
- Microsoft Entra
- DRUID Data Service migration
- LLM-generated scoring
- Concurrent multi-profile orchestration
- Final enterprise permissions architecture
- Merging the Mission Control and Client Radar repositories or deployments
