# Product Roadmap

> **⚠️ STALE — superseded by `NEXT_SESSION.md`, verified 2026-08-20.** This
> document (and `PROJECT_HANDOFF.md`, `PROJECT_AUDIT.md`) describes the
> repository as of commit `4a34112` (2026-08-18). At least 14 commits have
> since merged to `main`, including a full Milestone 0-3 restructuring
> (HubSpot integration, Account Workspace UX redesign, canonical attention
> wiring) that this document's "GTM V2" framing does not reflect. **Do not
> treat this file as current execution truth.** Read `NEXT_SESSION.md` first
> for present-tense state; this file is retained for historical/audit-trail
> value only until a dedicated reconciliation pass.

> **2026-08-18 audit update.** This document was last substantively edited at
> commit `5f866b0` and described "Current Product State" only through PR #27.
> Sixteen more PRs have merged to `main` since, including ten (`#34`-`#43`)
> implementing an entirely separate, previously undocumented architecture
> track referred to in code/migration comments as **"GTM V2"** — signal
> ingestion, identity resolution, attention items, evaluation staleness/
> resolution, and Client Radar account mapping. A full read-only audit
> (`PROJECT_AUDIT.md`) has now reconciled that track with this roadmap. See
> the new **"GTM V2 — Signal, Identity & Attention Track"** section below and
> **"Roadmap Corrections / Reclassified Work"** near the end of this
> document. Everything below this notice is otherwise unchanged from the
> pre-audit version except where a correction section explicitly says so —
> per the audit's instructions, existing content is preserved, not rewritten.
>
> **2026-08-18 correction pass.** A follow-up review of the initial audit
> flagged several imprecise claims, now corrected in place: the GTM↔Client
> Radar call path (direct HTTP, not via n8n), the duplicate-account
> mechanism (a weak/name-only signal was incorrectly said to be able to
> create an account — it cannot), a new **"Current Verified State —
> 2026-08-18"** section immediately below (so a fresh AI session reads
> present-tense truth before historical PR #27 content), and two new
> discrepancies (whether real signals reach GTM V2 at all, and a
> Needs-Attention/MQL-Dismiss lifecycle conflict) — see `PROJECT_AUDIT.md`
> DISC-07/DISC-08.

This roadmap covers the **complete connected product**, spanning two separate
applications, repositories, and deployments:

1. **DRUID GTM Mission Control** (this repository) — the internal review
   cockpit for the GTM signal engine.
2. **Client Radar** (separate repository, separate deployment) — the
   research/enrichment service that Mission Control hands accounts off to.

n8n is a broader GTM orchestration boundary used for other functions (legacy
signal intake/scoring, outbound activation dispatch) — it is **not** the call
path between Mission Control and Client Radar specifically. That call path is
a direct, authenticated HTTP integration from Mission Control's own API
server to Client Radar's API (verified in code — zero n8n imports/calls exist
anywhere in the Client Radar service files; see `PROJECT_AUDIT.md` §C).
*(Corrected 2026-08-18 — this line previously stated the two products were
connected "via an n8n orchestration boundary and a handoff contract," which
did not hold for the implemented call path.)* The two products are **not**
connected by shared code, a shared database, or a shared deployment either
way. Nothing in this roadmap merges the two repositories.

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

## Current Verified State — 2026-08-18

*This is the authoritative present-tense summary. Read this section, not the
historical section below it, for "what is true right now." The section below
("Historical Product State — Snapshot after PR #27") is preserved for
historical continuity but describes the product as of an older commit and
must not be read as current status on its own — a fresh AI/developer session
should treat this section as overriding it wherever they conflict. Full
evidence for every line below is in `PROJECT_AUDIT.md`.*

- **Canonical accounts, ICP profiles/versions, and single-profile evaluation** are implemented and live in the product (`artifacts/druid-gtm` frontend against session-authenticated API routes) — this part of the historical section below remains accurate.
- **A separate "GTM V2" backend track** (signal ingestion, identity resolution, attention items, evaluation staleness/resolution, Client Radar account mapping — 10 PRs, `#34`-`#43`) is implemented and unit-tested at the API/schema level. See the "GTM V2" section further below.
- **The GTM V2 attention backend has zero frontend consumer.** The live "Needs Attention" UI still runs entirely on the older Sheet + `account_decisions` model described in the historical section below.
- **Resolved signals/identity data does not feed ICP evaluation.** Evaluation input is built only from bare account identity plus manually-entered facts.
- **Whether real operational signals (RB2B, Dealfront, a legacy n8n workflow, or anything else) currently reach the GTM V2 ingestion endpoint at all is UNKNOWN / REQUIRES RUNTIME VERIFICATION.** No caller of it was found anywhere in this repository. This must not be assumed either way.
- **Client Radar** (Mission Control side only — the separate Client Radar repository was not audited): a real, direct HTTP integration exists for research submission, status, evidence display, and durable account-alias mapping. No candidate-fact/accept-reject layer exists at all.
- **Multi-ICP-profile orchestration** (automatic multi-profile evaluation, comparison, best-profile recommendation) is not built — only single-profile authoring/evaluation is complete.
- **Production runtime state is unverified.** Production builds from its own server-side git checkout rather than a pinned CI image, so the commit actually running in production is not guaranteed to equal this repository's `main` HEAD without an explicit, unattempted read-only check.

See `PROJECT_AUDIT.md` for full citations and the "GTM V2" and "Roadmap
Corrections / Reclassified Work" sections below for detail.

---

## Historical Product State — Snapshot after PR #27

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

## GTM V2 — Signal, Identity & Attention Track (2026-08-18 audit addition)

*GTM Mission Control, `artifacts/api-server` + `lib/db`. This section is new
as of the 2026-08-18 audit — it did not exist in any markdown file before
that audit. Its stage/unit structure was reconstructed entirely from code
and migration comments (`grep -rn "GTM V2 Stage\|GTM V2 Unit"`), not from any
prior planning document. Full evidence in `PROJECT_AUDIT.md` §Q.*

Ten PRs (`#34`-`#43`) merged to `main` between the "Historical Product
State — Snapshot after PR #27" snapshot above and this audit, building a
parallel canonical foundation for
signal ingestion, identity resolution, and operational attention — separate
from, and not yet connected to, the ICP evaluation and product-surface work
described elsewhere in this roadmap.

| Stage.Unit | PR | What it built | Verified status |
|---|---|---|---|
| Unit 1 | #34 | `signals` / `identity_resolution_events` / `account_aliases` / `account_people` / `people` schema foundation | ✅ Verified implemented |
| Unit 2 | #35 | Idempotent signal ingestion API (`POST /internal/signals`) | ✅ Verified implemented |
| Unit 3 | #36 | Deterministic runtime identity resolution (domain/external-id/email matching, conflict detection, replay-safe) | ✅ Verified implemented |
| Stage 2, Unit 4 | #37 | Current identity binding read model | ✅ Verified implemented |
| Stage 3, Unit 1 | #38 | `attention_items` lifecycle schema (open→resolved, DB-enforced, dedup) | ✅ Verified implemented |
| Stage 3, Unit 2 | #39 | Attention item create/resolve service API | ✅ Verified implemented |
| Stage 3, Unit 3 | #40 | Account attention read models (`needsAttention` filter + `AccountAttentionSummary` on `GET /internal/accounts`) | ✅ Verified implemented (backend) — **not consumed by the frontend at all; see correction below** |
| Stage 4, Unit 1 | #41 | Evaluation staleness lifecycle (`account_facts` change → `evaluation_stale` attention item) | ✅ Verified implemented |
| Stage 4, Unit 2 | #42 | Evaluation resolution lifecycle (causal auto-resolve of evaluation attention items) | ✅ Verified implemented |
| Stage 5, Unit 1 | #43 | Durable Client Radar account mapping (via `account_aliases`) | ✅ Verified implemented |

**Two questions this track's own correctness does NOT answer** (added in the
2026-08-18 correction pass — see `PROJECT_AUDIT.md` DISC-07):

- **A. Implemented contract (verified):** if a correctly-shaped signal reaches `POST /internal/signals`, the resolution logic itself is correct — covered by 30+ passing unit tests.
- **B. Unverified live bridge:** whether any real operational signal source (RB2B, Dealfront, a legacy n8n workflow, or anything else) currently delivers a signal to that endpoint at all. **No caller of it exists anywhere in this repository.** This is a distinct, unresolved question from A, and this track's test coverage is not evidence for B.

**What this track does NOT yet do** (see `PROJECT_AUDIT.md` §F, §G, DISC-02,
DISC-03, DISC-06, DISC-08 for full evidence):

- Resolved signals, identified people, and attention items have **no effect
  on ICP evaluation** — the evaluation input builder
  (`icpEvaluationResolvers.ts`) never reads `signals`, `identity_resolution_events`,
  or `account_people`; it only reads `accounts` + manually-entered
  `account_facts`. The evaluator's own `NormalizedEngagementV1Schema` and
  `intent` rule dimension are fully built to receive exactly this data — it
  is simply never wired.
- The attention/accounts read model this track built (Stage 3) has **no
  frontend consumer** — the live "Needs Attention" view still runs entirely
  on the older Sheet + `accountDecisions.routingOutput` model this roadmap
  describes above. **Additionally, MQL/Dismiss decisions do not resolve
  attention items** (`accountDecisions.ts` never touches `attention_items`),
  and the attention-item resolve endpoint is service-auth-gated, unreachable
  from the browser session — so a naive frontend wiring that reuses the old
  "hide once decided" logic would be wrong under the canonical model. See
  DISC-08.
- No orphaned/unresolved signal can currently be re-attached to a
  newly-matched account, and no account-merge mechanism exists. **Corrected
  mechanism** (a company-name-only signal can never create an account —
  verified in code, `identityResolution.ts:192-208, 557-565`): duplicates
  instead arise from (1) an account created outside the resolver (e.g.
  bootstrap import) that a later signal identified only by a non-domain
  strong identifier cannot find, or (2) two different strong identifiers for
  the same real company that never co-occur on one signal. See DISC-06.

**Recommended sequencing (revised in the correction pass — see
`PROJECT_AUDIT.md` §R):** (1) implementation now — wire the Stage 3 attention
read model's *membership* into the frontend, read-only, without the old
MQL/Dismiss local-state logic (DISC-08); (2) verification, in parallel, not a
prerequisite for (1) — runtime-verify whether any real signal reaches GTM V2
ingestion at all (DISC-07); (3) product decision, after (2) — what should
feed Intent scoring (DISC-02). See `NEXT_SESSION.md` for the operational
detail.

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
and dependency history that "Historical Product State — Snapshot after PR
#27" and "Next Delivery Sequence" above summarize. Status labels have been updated to reflect
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
evaluations delivered through PR #27 (see "Historical Product State —
Snapshot after PR #27" above).
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
are merged to `main` — see "Historical Product State — Snapshot after PR
#27" above. Phase 3 (decision
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

**Status update (precision-corrected 2026-08-18 — see `PROJECT_AUDIT.md`
DISC-03):** the canonical-records foundation this package depends on
(Package 2, Phase 1) is merged to `main`. **Accounts** is fully canonical —
every canonically resolved company lives there, backed by persisted
records. **Needs Attention is only partially canonical, and in a different
sense than the newer GTM V2 work below implies.** As of PR #27, Needs
Attention became "an operational view inside Accounts" filtered by canonical
`account_decisions` (see "Historical Product State" above) — a real
improvement over a raw Sheets-only queue, but its underlying data source is
still the Sheet-backed incoming queue joined to canonical accounts/decisions,
**not** the purpose-built `attention_items` canonical read model GTM V2
Stage 3 (`#38`-`#40`) later added. That newer, more canonical backend
read model (`GET /internal/accounts?needsAttention=true` +
`AccountAttentionSummary`) exists, is DB-verified, and is currently consumed
by **zero** frontend code — wiring the frontend onto it is this audit's
recommended next implementation unit (see `NEXT_SESSION.md`), not yet done.
What else remains open from this package is the full set of independent,
database-derived operational queues (MQL, Sales Review, Pipeline Assist,
Owner Alert, Retarget, Nurture, Suppressed, failed/incomplete, missing
identity/enrichment, re-score review) beyond Accounts/Needs Attention, plus
the forms and persistence behaviors below not yet confirmed built. This is
Next Delivery Sequence #1. It also completes the canonical `message_context`
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

**Status update:** merged to `main` — see "Historical Product State —
Snapshot after PR #27" above.

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
complete — see "Historical Product State — Snapshot after PR #27" above.
This package itself
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

---

## Roadmap Corrections / Reclassified Work (2026-08-18 audit)

Added by the 2026-08-18 read-only audit (`PROJECT_AUDIT.md`). Nothing above
this section was rewritten — this section only records where the audit found
current runtime/code behavior to differ from what a package's status label
above implies, or where a previously-complete package needs a new named
cross-cutting fix that would otherwise disappear because its package is
marked complete. Full evidence for every item below is in `PROJECT_AUDIT.md`.

- **Package 2 ("Canonical Account Evaluation & Configurable ICP Profiles")
  is accurately labeled "substantially delivered" for single-profile
  authoring, versioning, and evaluation** — the audit confirms Phases 0-2 and
  the account-level evaluation UI work exactly as claimed. **However, the
  roadmap does not currently say — and should — that the evaluator's Intent
  input is disconnected from any real behavioral signal today.** Evaluation
  input is built only from bare account identity plus manually-entered
  `account_facts`; the GTM V2 signal/identity track (see the new section
  above) has zero effect on it. This is not a regression in Package 2 — it
  predates GTM V2 — but it means "Intent" in every evaluation persisted to
  date is not measuring engagement/behavior in any automated sense. See
  `PROJECT_AUDIT.md` DISC-02.

- **Package 3 ("Persistent Canonical Records and Leads Workspace") should be
  re-scoped to include wiring the GTM V2 Stage 3 attention backend into the
  frontend**, not only the originally-scoped MQL/Sales Review/etc. queues.
  Four already-merged PRs (`#38`-`#40`) built and tested a canonical
  `attention_items` read model that zero frontend code currently consumes.
  See `PROJECT_AUDIT.md` DISC-03 — this is this audit's recommended single
  next implementation unit (`NEXT_SESSION.md`).

- **Package 4/5 (Client Radar Handoff and Server-to-Server API), marked ✅
  Completed, remain accurately completed on the Mission Control side** for
  the scope they originally described. **This audit inspected only this
  repository (`druid-gtm-control`) — the separate Client Radar
  repository/deployment's own internal implementation and runtime state were
  not audited**, so "Completed" here means the Mission Control-side handoff
  contract, HTTP client, status/result handling, persistence, evidence
  rendering, and account-alias mapping — not a certification of Client
  Radar's own codebase. A significant amount of additional Client Radar work
  has since landed under the GTM V2 track (Stage 5: durable account mapping,
  identity-conflict handling) that predates this roadmap section entirely —
  see the new GTM V2 section above for what it covers, and
  `PROJECT_AUDIT.md` §K for the full lifecycle status, including
  confirmation that no candidate-fact/accept-reject layer exists yet (this
  matches, and does not contradict, Package 6's "not started" label below).
  Also corrected in this pass: the GTM↔Client Radar call path is a direct
  HTTP integration, not routed through n8n (see the corrected opening
  paragraph of this document).

- **No package above was found to be mislabeled as complete when it is
  actually broken.** The reclassifications above are additions/clarifications
  (previously-invisible scope, or a caveat about what "Intent" currently
  means), not corrections of a false "complete" claim.

- **New named cross-cutting fix, not owned by any single package above:**
  CI (`.github/workflows/pr-checks.yml`) does not run the Client Radar or
  ICP-profile test suites on any PR, even though those suites exist and pass
  locally. Small, mechanical fix; see `PROJECT_AUDIT.md` DISC-05.

- **New named cross-cutting limitation, not owned by any single package
  above — mechanism corrected in this pass:** no account-merge mechanism
  exists. A company-name-only signal can never create an account by itself
  (verified in code — this document previously stated otherwise and has been
  corrected); the real risk is two different *strong* identifiers for the
  same real company never being cross-linked (e.g. an account created
  outside the resolver, such as a bootstrap import, that a later
  strong-identifier signal cannot find; or two strong identifier types that
  never co-occur on one signal). This is a deliberate, documented scope
  boundary in the GTM V2 schema (not a bug), but it was not previously named
  correctly in any roadmap document. See `PROJECT_AUDIT.md` DISC-06.

- **New discrepancy surfaced in the 2026-08-18 correction pass, not present
  in the original audit's headline framing:** whether any real operational
  signal (RB2B, Dealfront, a legacy n8n workflow, or anything else) actually
  reaches the GTM V2 signal-ingestion API is **UNKNOWN / REQUIRES RUNTIME
  VERIFICATION** — no caller of `POST /internal/signals` exists anywhere in
  this repository. This is logically prior to the Package 2 Intent-input gap
  above: the resolver's correctness (proven) says nothing about whether it
  currently receives real signals at all. See `PROJECT_AUDIT.md` DISC-07 and
  the "GTM V2" section above — this should be the next *verification* step,
  run alongside (not blocking) the Needs Attention frontend-wiring unit.

- **New discrepancy surfaced in the 2026-08-18 correction pass:** an
  `account_decisions` write (MQL/Dismiss) does not resolve any open
  `attention_items` row, and the attention-item resolve endpoint cannot
  currently be called by the browser-session frontend at all (it is
  service-auth-gated). A naive frontend implementation that reuses the old
  "hide once decided" local-state rule on top of the new canonical
  `attention_items` read model would be incorrect — an account can be
  MQL'd/Dismissed while still carrying an unrelated open attention item, and
  the canonical model says it still needs attention. See `PROJECT_AUDIT.md`
  DISC-08 and `NEXT_SESSION.md` for the corrected scope of the Needs
  Attention unit.
