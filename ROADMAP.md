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

---

## Roadmap order

1. ✅ Completed — Business Truth & Activation Composer Foundation
2. ▶️ Next — Canonical Account Evaluation & Configurable ICP Profiles
3. Persistent Canonical Records and Leads Workspace, Views & Forms
4. Client Radar Handoff & Opportunity Intake
5. Server-to-Server Client Radar API and Status Synchronization
6. Evidence-Backed Client Radar Composer Enrichment
7. Multi-Profile Assignment & Comparative Evaluation
8. Common Connector Framework & Capability Registry
9. Controlled Live Integrations
10. Controlled Real-Data Pilot
11. Corporate Systems and Departmental Clearance
12. DevOps and Production Architecture Review
13. Microsoft Entra and Role Enforcement
14. DRUID Entities and Data Service Migration
15. Production Hardening and Final Cutover

---

## Cross-cutting prerequisite: Canonical `message_context` & claim guardrails

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
frontend (see Package 1). Formalizing it into one canonical, persisted
contract is required work inside Packages 2 and 3, and is a hard dependency
for Package 6 (Client Radar composer enrichment) — enrichment may not bypass
or weaken any of the fields or the invariant above.

---

## 1. ✅ Completed — Business Truth & Activation Composer Foundation

Shipped in PR #10, #11, #12 (merged to `main`, currently in production).

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

## 2. ▶️ Next — Canonical Account Evaluation & Configurable ICP Profiles

*GTM Mission Control. Immediate next package.*

### Core architectural decisions

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

### Forward-compatible data model (schema only — not orchestration)

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

### Phase 0 — Rule discovery and truth map

- Inventory every current ICP criterion, score component, weight, threshold,
  hard disqualifier, routing rule, and missing-data assumption.
- Record whether each rule currently lives in Google Sheets, n8n, API,
  frontend, shared libraries, or mock data.
- Classify every rule as fit, intent, eligibility, or routing.
- Identify which current scoring model actually feeds the cockpit.
- Document duplicated and conflicting logic.

**Deliverable:** one approved canonical rule map and migration plan.

### Phase 1 — Persistent canonical records

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

### Phase 2 — Canonical deterministic evaluator

**Input:** normalized account snapshot, immutable ICP profile version,
evaluator version.

**Output:** fit score and tier, intent score and tier, eligibility outcome,
matched rules, missing inputs, restrictions, hard disqualifiers, structured
score components.

### Phase 3 — Decision and routing policy

Combines evaluation with identified contact, customer status, open
opportunity, ownership, suppression, previous actions, and engagement
recency to produce: MQL, Sales Review, Pipeline Assist, Owner Alert,
Retarget, Nurture, Suppressed.

### Phase 4 — n8n boundary migration

- Centralize scoring.
- Remove duplicated hard-coded industries, regions, titles, weights,
  thresholds, disqualifiers, and missing-equals-zero assumptions.
- Keep receivers, normalization, enrichment, event logging, and activation
  workflows mostly independent of ICP configuration.

### Phase 5 — ICP administration UI

View active profile, edit draft, validate, compare draft vs active, activate
immutable version, version history, audit attribution, impact preview,
explicit re-score controls.

### Phase 6 — Account explanation and controlled cutover

Show profile ID/version, evaluator version, fit and intent, eligibility,
component scores, matched rules, missing inputs, restrictions/disqualifiers,
final routing reasons. Run old and new evaluators in parallel before cutover.

### Re-score model

Durable job, fixed profile version, preview/apply mode, selected
accounts/queue/eligible accounts/all accounts, queued/running/completed/
partial-failure/failed states, batching, idempotency, restartability,
progress and failure reporting, impact summary (tier movement, new/removed
MQLs, new disqualifications, unchanged accounts).

### Acceptance criteria

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

### Explicitly out of scope (this package)

- Live RB2B, Dealfront, Cognism, HubSpot, Salesforge, Dripify, Retell, or
  ad-platform integrations.
- Microsoft Entra.
- DRUID Data Service migration.
- LLM-generated scoring.
- Concurrent multi-profile orchestration (schema-ready only; see Package 7).
- Final enterprise permissions architecture.

---

## 3. Persistent Canonical Records and Leads Workspace, Views & Forms

*GTM Mission Control.*

> The current MVP already has a working Queue view and account-detail view
> (mock-data / Sheets-backed). This package formalizes them as
> PostgreSQL-backed canonical records (Package 2, Phase 1) and extends them
> into the full Leads workspace below. It also completes the canonical
> `message_context` contract described in the cross-cutting prerequisite
> section, so every view and form here operates on one persisted,
> explainable record — not scattered frontend logic.

### Views

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

### Forms

- Manual lead creation
- Lead/account edit
- Contact correction
- Review and decision
- Ownership
- Suppression
- Activation
- Re-score

### Persistence and behaviour

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

### Acceptance criteria

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

## 4. Client Radar Handoff & Opportunity Intake

*Client Radar — separate repository, separate deployment.*

### Scope

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

### Acceptance criteria

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

## 5. Server-to-Server Client Radar API and Status Synchronization

*Client Radar — separate repository, separate deployment.*

### Dependable minimum handoff path

- Authenticated scan creation.
- Workspace-safe account identity.
- Explicit purpose.
- External correlation ID.
- Idempotency.
- Duplicate prevention.
- Status retrieval.
- Evidence-backed result retrieval.

### Persisted statuses

- `not_created`
- `creation_requested`
- `created`
- `scanning`
- `completed`
- `failed`
- `stale`

### Explicit rules

- Repeated requests with the same idempotency key must not create duplicate
  accounts or scans.
- Mission Control must not display `completed` until Client Radar confirms
  completion — no optimistic or inferred completion state.
- Failures and stale results must be visible in Mission Control, not
  silently dropped or shown as pending indefinitely.
- A workflow JSON file on disk is not proof of a live imported workflow —
  status must reflect the running system, not the repository.

### Acceptance criteria

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

## 6. Evidence-Backed Client Radar Composer Enrichment

*Client Radar → Mission Control canonical `message_context`.*

### Scope

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

### Acceptance criteria

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

## 7. Multi-Profile Assignment & Comparative Evaluation

*GTM Mission Control. Activates the forward-compatible schema from Package 2.*

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

## 8. Common Connector Framework & Capability Registry

Title and position only — not yet scoped in detail.

## 9. Controlled Live Integrations

Title and position only — not yet scoped in detail. Note: live RB2B,
Dealfront, Cognism, HubSpot, Salesforge, Dripify, Retell, and ad-platform
integrations are explicitly out of scope for Package 2 and are expected to
land here or later.

## 10. Controlled Real-Data Pilot

Title and position only — not yet scoped in detail.

## 11. Corporate Systems and Departmental Clearance

Title and position only — not yet scoped in detail.

## 12. DevOps and Production Architecture Review

Title and position only — not yet scoped in detail.

## 13. Microsoft Entra and Role Enforcement

Title and position only — not yet scoped in detail. Explicitly out of scope
for Package 2.

## 14. DRUID Entities and Data Service Migration

Title and position only — not yet scoped in detail. Explicitly out of scope
for Package 2.

## 15. Production Hardening and Final Cutover

Title and position only — not yet scoped in detail.

---

## Roadmap dependency rules

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

## Out of scope across the current roadmap horizon (Packages 1–2)

- Live RB2B, Dealfront, Cognism, HubSpot, Salesforge, Dripify, Retell, or
  ad-platform integrations
- Microsoft Entra
- DRUID Data Service migration
- LLM-generated scoring
- Concurrent multi-profile orchestration
- Final enterprise permissions architecture
- Merging the Mission Control and Client Radar repositories or deployments
