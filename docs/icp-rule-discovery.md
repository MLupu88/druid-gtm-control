# ICP Rule Discovery & Truth Map — Package 2, Phase 0

Status: draft, for approval, and **interim** — this is a repository-only
artifact. It was produced entirely by reading code; no n8n workflow and no
live Google Sheet was inspected. Phase 0 itself is not complete until that
inspection happens and its findings are incorporated into an approved
revision of this document (see §14 exit criteria). Deliverable of
ROADMAP.md Package 2 ("Canonical Account Evaluation & Configurable ICP
Profiles"), Phase 0 ("Rule discovery and truth map").

This document inventories every ICP-affecting rule found by reading the
`druid-gtm-control` repository. It does not touch application code, n8n, or
Google Sheets. Where a rule cannot be verified from this repository alone —
which is true for almost everything that actually computes a score or a
disqualification — it is marked **UNVERIFIED** rather than inferred.

---

## 1. Scope and methodology

**In scope:** every file in `lib/gtm-shared`, `artifacts/api-server`,
`artifacts/druid-gtm`, `lib/db`, `lib/reference`, and `scripts`, read for any
logic that affects account fit, intent, eligibility, routing, action
availability, or operational state.

**Out of scope (per task instructions):** application code changes, n8n
workflow definitions (none are present in this repository), live Google
Sheets contents, live production state. No SSH/production inspection was
performed for this document.

**Method:**

1. Mapped the repo tree (`artifacts/*`, `lib/*`, `scripts/`).
2. Read in full: `lib/gtm-shared/src/gtmContract.js` (939 lines),
   `mockData.js`, `researchEligibility.js` + its test file,
   `messageComposer.js` + its test file, `scenarioFixtures.js` +
   `scenarios.test.js`, `gtmContract.test.js` (all four `.test.js` files in
   `lib/gtm-shared/src`).
3. Read in full: `artifacts/api-server/src/routes/sheets.ts` (1138 lines),
   `n8n.ts` (419 lines), `auth.ts`, `app.ts`, `routes/index.ts`,
   `middlewares/requireAuth.ts`, `lib/operators.ts`.
4. Read in full: `artifacts/druid-gtm/src/lib/queue-helpers.ts`,
   `components/account-detail-sheet.tsx`, `pages/dashboard.tsx`,
   `pages/settings.tsx`, `pages/sample-lead.tsx`,
   `components/action-modal.tsx`.
5. Grepped and spot-read `reports.tsx`, `queue.tsx`, `signal-pulse.tsx` for
   any independent rule computation (industry/region/threshold/gate
   patterns); traced every call site of anything that looked like routing
   logic.
6. Read `lib/db/src/schema/index.ts` (empty scaffold) and confirmed
   `lib/reference/*` is dead code (not in `pnpm-workspace.yaml`, no
   `package.json`, zero imports anywhere in the repo).
7. Searched the full repo for n8n workflow JSON, `roadmap`, `disqualif`,
   `seniority`, `employee`, `free_email`, `weight`, `threshold` — logged
   every hit and every confirmed absence.

**Evidence discipline:** every claim below cites a `file:line`. Where the
real production rule (a scoring weight, a disqualifier list, a threshold) is
known only to live inside n8n or a Google Sheet, this document says so
explicitly and does not guess at its shape.

---

## 2. Current architecture map

```
┌─────────────────────────────────────────────────────────────────────┐
│ n8n (external, NOT in this repo — UNVERIFIED)                        │
│  Fields this repo's contract/fixtures demonstrably RECEIVE from       │
│  n8n-written Sheet rows (verified: column names + observed values) — │
│    fit/interest/identity/actionability/timing scores,                 │
│    account_score/total_score, score_tier, gate_status, block_reason, │
│    recommended_output (account_queue only)                            │
│  n8n appears or is expected to also compute hard disqualifiers,       │
│  suppression, internal/free-email exclusion, competitor handling,     │
│  and open-opportunity/owner routing — but no formula, disqualifier    │
│  list, or matching rule for any of these is evidenced anywhere in     │
│  this repo. Treat as UNVERIFIED, not fact (see §3.3, §11).            │
│  - writes results into Google Sheets tabs                            │
│  - receives operator decisions/activations via 3 webhook endpoints   │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ (Google Sheets API, read-only)
┌───────────────────────────────▼───────────────────────────────────────┐
│ Google Sheets (external — UNVERIFIED beyond tab/column names in code) │
│  Tabs read by this repo: ICP_Review_Queue, ICP_Account_Queue,        │
│  ICP_Account_Records, ICP_Config, ICP_Suppression, ICP_Action_Log,   │
│  ICP_Signal_Events                                                    │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ google-sheets API (read-only, service account)
┌───────────────────────────────▼───────────────────────────────────────┐
│ artifacts/api-server (Express, this repo)                            │
│  routes/sheets.ts  — passthrough read + shape normalization only.    │
│                       ZERO scoring/eligibility logic.                 │
│  routes/n8n.ts     — pure proxy to n8n webhooks + operator-identity   │
│                       stamping + field-presence validation. ZERO      │
│                       scoring/eligibility logic.                      │
│  routes/auth.ts, middlewares/requireAuth.ts — session/operator auth,  │
│                       no ICP logic.                                   │
│  lib/db (Drizzle)  — schema is EMPTY (`export {}`). No canonical      │
│                       persistence exists yet.                         │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ /api/sheets/*, /api/n8n/* (JSON, cookie-authed)
┌───────────────────────────────▼───────────────────────────────────────┐
│ artifacts/druid-gtm (React frontend, this repo)                      │
│  lib/gtm-shared/gtmContract.js — canonical DISPLAY/eligibility/       │
│    action-availability contract. Explicitly documents itself as       │
│    display-only for gates/cost (gtmContract.js:1-3): "the cockpit     │
│    must never recompute gates or cost — n8n is the authority."        │
│  lib/queue-helpers.ts — ONE confirmed exception: signalOutputType()   │
│    independently DERIVES routing (MQL/Sales Review/Nurture/           │
│    Suppressed) for signal_queue rows, because that schema has no      │
│    recommended_output column at all (see Duplication Register).       │
│  messageComposer.js — deterministic, non-LLM draft templating.        │
│  researchEligibility.js — separate, canonical research-eligibility    │
│    rule, decoupled from prospecting eligibility.                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Headline finding:** the cockpit is overwhelmingly a *display and
operator-decision* layer. `gtmContract.js` states this as an explicit design
rule at the top of the file. The ICP scoring/gating/routing **field values**
this repo demonstrably renders (`account_score`, `score_tier`, `gate_status`,
`recommended_output`) arrive already written by n8n — there is no formula or
weight table implemented in this repository for computing any of them. Hard
disqualifiers specifically are **not evidenced as a field or value anywhere
in this repo at all** (the string "disqualif" has zero matches in the
codebase) — their existence and shape upstream in n8n is presumed, not
confirmed. The one clear exception to "display only" is `signalOutputType()`
(`queue-helpers.ts:24-38`), which independently computes a routing
classification in the frontend.

---

## 3. Full rule inventory

Legend for **Classification**: `canonical` = single, tested, authoritative
source in this repo; `duplicated` = same decision computed in more than one
place; `stale` = dead code, not executed; `mock-only` = only exists as
fixture/sample data, never implemented as logic; `unclear` = ambiguous
ownership; `UNVERIFIED` = the real rule is believed to live in n8n and/or
Google Sheets and cannot be confirmed from this repository.

### 3.1 Fit / Intent (score components)

| ID | Rule | Source | Layer | Input | Output/effect | Missing-data behavior | Classification | UI effect | Migration recommendation |
|---|---|---|---|---|---|---|---|---|---|
| FIT-01..05 | Display of `fit_score`/`interest_score`/`identity_score`/`actionability_score`/`timing_score` | `gtmContract.js:573-593` (`SCORE_COMPONENT_FIELDS`, `scoreComponentDisplay`) | frontend (shared lib) | `row[key]` | Renders value or "Not available" | Blank/non-numeric → "Not available", **never 0** | canonical (display only) | Account detail sheet "How this account scores" | Canonical evaluator becomes the writer of these five components; this display function is unchanged |
| FIT-06 | `account_score`/`total_score` resolution | `gtmContract.js:559-571` (`firstValidNumber`) | frontend (shared lib) | `row.account_score`, `row.total_score` | First valid numeric candidate; a real 0 counts | All candidates missing/invalid → `null` → "Not available" | canonical (display only) | Total score line, account-detail-sheet.tsx:143 | Canonical evaluator writes one unambiguous `fit_score`+`intent_score`; this fallback chain becomes unnecessary |
| FIT-07 | `score_tier` → business label | `gtmContract.js:535-551` (`SCORE_TIER_LABELS`, `scoreTierLabel`) | frontend (shared lib) | `row.score_tier` | Plain-language label | Missing → "Not available"; unknown → humanized, never invented | canonical (display only) | Score tier badge | Canonical evaluator's `fit_tier`/`intent_tier` enum replaces this ad hoc string |
| FIT-08 | `risk_score` sentinel detection (999, 1998) | `gtmContract.js:600-610` (`RISK_SCORE_SENTINELS`, `riskScoreDisplay`) | frontend (shared lib) | `row.risk_score` | Real value, or "Risk data unavailable" if sentinel, or "Risk not calculated" if blank | Two specific sentinel values, confirmed only against currently-observed contract; not a general threshold rule | canonical (display only) | Risk line in score section | Canonical evaluator should emit an explicit `risk_calculated: boolean` instead of magic sentinels |
| FIT-09 | `mql_flag` strict parsing | `gtmContract.js:616-636` (`mqlDisplay`) | frontend (shared lib) | `row.mql_flag`, `row.sales_review_reason`/`row.mql_reason` | "Qualified as MQL" / "Not MQL-qualified" / "MQL qualification not recorded" | Any value other than real boolean or exact string `"true"`/`"false"` → "not recorded", **never coerced to false** | canonical (display only) | MQL qualification line | MQL is a decision/routing outcome, not an eligibility outcome. The canonical evaluator produces fit, intent, and eligibility outputs; the canonical decision/routing policy then determines whether the account becomes MQL, Sales Review, Pipeline Assist, Owner Alert, Retarget, Nurture, or Suppressed. `mql_flag` should become a derived compatibility field (computed from the routing decision, for display parity with existing consumers) or be retired outright — it must not be reframed as part of the evaluator's eligibility output |
| FIT-10 | **UNVERIFIED**: `total_score = fit_score + interest_score + identity_score + actionability_score + timing_score` | Observed only in fixture data: `mockData.js:79-80` (Globex: 30+42+16+6+15=109; Acme: 40+69+10+0+15=134) | mock-only | — | — | — | mock-only / UNVERIFIED | — | This is evidence of the **shape** n8n's contract produces, not proof of the production formula, weights, or whether it's even a simple sum in production. Phase 0 exit requires confirming this directly against n8n, not inferring it from two fixture rows |

### 3.2 Fit/Intent categories with no code-level rule found (Phase 0 checklist coverage)

None of the following have any implementing logic anywhere in this
repository — no weight, no threshold, no enum, no matching function. Each
is marked **UNVERIFIED — presumed n8n-side**:

| Category | What exists in this repo | Evidence |
|---|---|---|
| Industries | Free-text display + normalization only, not a scoring input | `normalizeIndustryKey`/`industryDisplay`, `gtmContract.js:847-862` — trims/lowercases for future matching; explicitly documented as having "no fixed enum" today |
| Countries / regions | Free-text display field (`row.country`/`row.region`); one binary check (`region!=="us"`) inside the email legal-basis gate (ELIG-04) | `account-detail-sheet.tsx:238-242`; `gtmContract.js:162` |
| Employee ranges | None found anywhere (`grep -i employee` = zero hits) | — |
| Revenue ranges | None found anywhere (`grep -i revenue` = zero hits outside `.tsbuildinfo`) | — |
| Company types | None found | — |
| Buyer functions | None found (no taxonomy) | — |
| Titles | Free-text display field (`contact_title`), used only in composer greeting clause, never as a scoring/eligibility input | `messageComposer.js:196-197` |
| Seniority | None found (`grep -i seniority` = zero hits) | — |
| Use cases | Free-text `recommended_solution` field, path-classification heuristic in composer (`_classifyPathTopic`) — this is a **composer-copy** rule, not a fit/eligibility rule | `messageComposer.js:89-119` |
| Technology/integration signals | None found | — |
| Behavioural signals | Only as free-text `why_now`, never parsed into a structured signal type | — |
| Recency | `rowFreshnessDisplay` reads `updated_at`/`signal_at`/`last_signal_at` for **display** only, not as a scoring input | `gtmContract.js:673-680` |
| Frequency | None found | — |

### 3.3 Eligibility

| ID | Rule | Source | Layer | Input | Output/effect | Missing-data behavior | Classification | Migration recommendation |
|---|---|---|---|---|---|---|---|---|
| ELIG-01 | Identified-contact requirement | `gtmContract.js:267-296` (`hasIdentifiedContact`, `resolveIdentityKey`), enforced at `gtmContract.js:97-103` (signal path), `165` note (account path lives in ELIG-… below), `messageComposer.js:340-342,373-375` (composer), `action-modal.tsx:106-110` (defense-in-depth) | frontend (shared lib), enforced at 4 independent layers by design | `identity_resolution` (account rows) or `resolution_level` (signal rows) | Blocks approve_email/approve_linkedin | Missing/unrecognized → `"anonymous"` (fail-closed) | **canonical**, single source of truth, heavily tested (`gtmContract.test.js:865-932`, `messageComposer.test.js:574-670`) | This becomes the canonical evaluator's `eligibility.identity_confidence` input; keep the 4-layer defense-in-depth as UI/API belt-and-braces even after the evaluator owns the decision |
| ELIG-02 | Research eligibility (separate from prospecting) | `researchEligibility.js:58-63` | frontend (shared lib) | `account_key`/`company_domain`/`company_name` presence | eligible/not-eligible + purposes | No usable identifier → not eligible (fail-closed) | canonical, tested | Directly maps to ROADMAP.md Package 4's five research purposes; keep as its own decision, independent of the canonical fit/intent evaluator |
| ELIG-03 | Research purpose derivation | `researchEligibility.js:32-48` | frontend (shared lib) | `open_opportunity`, `existing_customer`, `recommended_output==="Suppressed"`, `hubspot_owner` | Set of purposes (union, not exclusive); default `new_prospecting` | Purposes derived from row state; if none match, defaults to `new_prospecting` | canonical, tested | Becomes an input to Package 4's request-purpose field |
| ELIG-04 | Email legal-basis gate (US vs. EMEA) | `gtmContract.js:158-162` | frontend (shared lib) | `row.region`, `row.consent_email`, `row.li_basis_cleared` | Blocks `approve_email` outside US without consent/basis | Missing/blank consent → blocked (fail-closed) | canonical for Email; **LinkedIn deliberately has no equivalent gate** — explicit, documented product-decision gap (comment at `gtmContract.js:158-161`: "LinkedIn's own legal-basis policy is a separate, not-yet-defined product/legal decision") | This is a real open policy question, not a bug — flagged in Unresolved Questions §9 |
| ELIG-05 | NO_PROSPECT output-type gate | `gtmContract.js:121,129-140,163` | frontend (shared lib) | `recommended_output` | Pipeline Assist/Owner Alert/Retarget/Suppressed never offer approve_email/linkedin/call | n/a (enum membership) | canonical | Becomes the canonical routing policy's "action availability by output type" table |
| ELIG-06 | previewOnly bypass scope | `gtmContract.js:145-156` | frontend (shared lib) | `previewOnly` flag | Bypasses **only** the live `engine_mode` gate for approve_email/linkedin; never voice, never identity, never region/consent | n/a | canonical, tested (`gtmContract.test.js:914-925,1043-1091`) | No change needed — Sample-mode behavior is a UI concern, not a business rule to migrate |
| ELIG-07 | Voice permanently locked | `gtmContract.js:96,150` | frontend (shared lib) | none (unconditional) | `approve_call` always disabled | n/a | canonical | Canonical evaluator should carry an explicit `restrictions: ["voice_not_validated"]`; frontend lock stays as defense-in-depth |
| ELIG-08 | Suppression / DNC | Only *displayed* — `sheets.ts:1100-1115` (`GET /api/sheets/suppression`, raw passthrough of `ICP_Suppression` tab), `settings.tsx:288-346` (do-not-contact table); referenced as `block_reason` values `"suppressed_or_dnc"`/`"do_not_contact"` (`gtmContract.js:340`), and in fixtures (`mockData.js:85`, `scenarioFixtures.js:159`) | none in this repo computes a suppression match | — | — | — | **UNVERIFIED — presumed n8n-side.** No domain/email-against-DNC-list matching logic exists anywhere in this repository | Phase 1 must define a canonical `suppression` table; Phase 0 exit requires confirming with n8n/Sheets owner how suppression matching currently works |
| ELIG-09 | Internal/test-account exclusion | Only observed as `block_reason:"excluded:internal"` + `gate_detail.internal_exclusion` in one fixture row (`mockData.js:36-38`); `sample-lead.tsx:55-58` preset `is_internal:true` sends a raw flag to n8n's shadow test-signal endpoint | none in this repo detects an internal domain | — | — | — | **UNVERIFIED — presumed n8n-side** | Phase 0 exit requires confirming the actual internal-domain match rule (e.g. is it a domain allowlist, an email suffix check?) with n8n |
| ELIG-10 | Personal/free-email handling | Only observed as `sample-lead.tsx:60-63` preset `personal_email:true`, forwarded raw to n8n; string `"free_email"` has zero matches anywhere in the codebase | none in this repo | — | — | — | **UNVERIFIED — presumed n8n-side** | Same as ELIG-09 — must be confirmed with n8n before Phase 2 can encode it as a hard disqualifier or a fit-reducing signal |
| ELIG-11 | Competitor handling | `competitor_flag:"false"` exists on exactly one fixture row (`mockData.js:79`) | never read or branched on anywhere in `gtm-shared` or the frontend | — | — | — | **mock-only / dead field** | If competitor exclusion is a real product requirement, it needs to be defined from scratch — nothing in this repo currently implements it |
| ELIG-12 | Open-opportunity effect on prospecting | Prospecting-side handling is entirely indirect: `NO_PROSPECT` already includes "Pipeline Assist", which n8n assigns when `open_opportunity` is true (UNVERIFIED how). Only `researchEligibility.js:34-37` reads `row.open_opportunity` directly | `researchEligibility.js:34-37` (research-purpose derivation only) | — | — | — | canonical (research-purpose derivation only); **UNVERIFIED for the prospecting-side rule itself** | Canonical routing policy (Phase 3) must own this explicitly rather than relying on n8n having already baked it into `recommended_output` |
| ELIG-13 | Existing-customer effect on prospecting | Same pattern as ELIG-12 — indirect via `recommended_output==="Suppressed"`; direct read only in `researchEligibility.js:38-41` | `researchEligibility.js:38-41` | — | — | — | canonical (research-purpose derivation only); **UNVERIFIED for the prospecting-side rule itself** | Same recommendation as ELIG-12 |
| ELIG-14 | Account-owner (`hubspot_owner`) effect | Read directly only by `researchEligibility.js:42-45` (owner_support/account_expansion purposes) and displayed; "Owner Alert"/"Pipeline Assist" routing itself is n8n-assigned | `researchEligibility.js:42-45` | — | — | — | canonical (research-purpose derivation only); **UNVERIFIED for the routing-side rule itself** | Phase 3 (decision/routing policy) must own owner-based routing explicitly |

### 3.4 Routing

| ID | Rule | Source | Layer | Classification | Notes |
|---|---|---|---|---|---|
| ROUTE-01 | `buttonsForOutput()` — output type → available actions | `gtmContract.js:129-140` | frontend (shared lib) | canonical | Single source of truth for which buttons an output type offers |
| ROUTE-02 | `OUTPUT_TYPES` enum + labels | `gtmContract.js:119,236-244` | frontend (shared lib) | canonical | MQL / Sales Review / Pipeline Assist / Owner Alert / Nurture / Retarget / Suppressed |
| ROUTE-03 | `SALES_REVIEW_REASONS` enum + labels | `gtmContract.js:120,247-255` | frontend (shared lib) | canonical (display); the reasons themselves (`no_lawful_channel`, `below_mql_threshold`, etc.) are **UNVERIFIED** as to which n8n rule actually assigns each one |
| ROUTE-04 | `accountOutputType()` | `queue-helpers.ts:41-44` | frontend | canonical validation, trusts n8n | Validates `row.recommended_output` against the known enum; unrecognized value falls back to `"Sales Review"` (conservative — forces human review rather than silently dropping the row) |
| ROUTE-05 | **`signalOutputType()` — frontend-derived routing** | `queue-helpers.ts:24-38` | **frontend, live, independently computed** | **duplicated / migration candidate** | Re-derives MQL/Sales Review/Nurture/Suppressed from `score_tier`+`engine_status`+`gate_status`+`block_reason` for signal-queue rows. Used in `dashboard.tsx:151,553`, `queue.tsx:101,106,117,258,379`, `account-detail-sheet.tsx:97`, `signal-pulse.tsx:28,33`. **Root cause:** the signal-queue schema (`QUEUE_COLUMNS`, `gtmContract.js:6-14`) has no `recommended_output` column at all — see Duplication Register §6 |
| ROUTE-06 | `rowOutputType()` dispatcher | `queue-helpers.ts:47-51` | frontend | canonical (dispatch only) | Chooses ROUTE-04 vs ROUTE-05 by `source` |

### 3.5 Action availability

Action availability in this repo is the union of ELIG-01/04/05/06/07 above,
applied through:

| ID | Rule | Source | Classification |
|---|---|---|---|
| ACT-01 | `BUTTONS` map (endpoint + payload shape + label + honest copy per action) | `gtmContract.js:50-70` | canonical |
| ACT-02 | `buttonDisabled()` — signal-queue disable logic | `gtmContract.js:92-112` | canonical |
| ACT-03 | `buttonDisabledPhaseC()` — account-queue disable logic | `gtmContract.js:149-165` | canonical |
| ACT-04 | `rowButtons()` — identity filter applied on top of `buttonsForOutput()` | `queue-helpers.ts:126-131` | canonical |

**CONFLICT-01** (see §7): ACT-02 checks `row.gate_status === "blocked"` as
its hard-gate condition; ACT-03 never reads `row.gate_status` at all. See
Conflict Register.

### 3.6 Operational state

| ID | Rule | Source | Classification |
|---|---|---|---|
| OPS-01 | `engine_mode` (live/recommend_only/paused) | `ENGINE_MODE_LABELS`, `gtmContract.js:223-227`; written via `/api/n8n/config`, allowlisted by `CONFIG_WRITES` (`gtmContract.js:38-43`) | canonical (display + allowlist); actual enforcement is n8n-side, **UNVERIFIED** |
| OPS-02 | `queue_source` (signal_queue/account_queue) | `resolveQueueTab`/`resolveMatchKey` (`gtmContract.js:125-126`), `QUEUE_SOURCE_LABELS` (`gtmContract.js:230-233`) | canonical; changing it is UI-disabled today (`settings.tsx:260-262`) |
| OPS-03 | `account_queue_write` toggle | `settings.tsx:649-797` | canonical (display + allowlisted write) |
| OPS-04 | `us_voice_cleared` danger toggle | `CONFIG_DANGER` (`gtmContract.js:45-47`), `UsVoicePanel` (`settings.tsx:800-940`) | canonical; note this toggle does **not** unlock `approve_call` anywhere in this repo — ELIG-07's unconditional lock overrides it regardless of this flag's value (intentional defense-in-depth, not a bug) |
| OPS-05 | `needsReview`/`needsReviewAccount` | `gtmContract.js:17-19,212-213` | canonical |
| OPS-06 | `isRowProcessed` | `gtmContract.js:925-928` | canonical |
| OPS-07 | `countUnresolvedRows` | `gtmContract.js:911-914` | canonical |
| OPS-08 | Operator/role model | `operators.ts` (whole file), `auth.ts`, `requireAuth.ts` | canonical for auth; **no persisted ownership/reassignment exists** — `OPERATORS` env var only |
| OPS-09 | `resolveOperatorAccessLocal`/`resolveOperatorAccessEntra` | `gtmContract.js:868-897` | canonical but **prepared/unused** — confirmed via `operators.ts:9-10` comment and full-repo grep: never called by any route |
| OPS-10 | Lifecycle envelope / truthful status derivation | `gtmContract.js:391-487,682-845` | canonical, extensively tested (`gtmContract.test.js:216-1034`) — strict whitelist, never trusts raw n8n response fields |

---

## 4. Scoring-model map

**There is no scoring model implemented in this repository.** What exists:

- A **display contract** for five score components (fit/interest/identity/
  actionability/timing), a total score, a score tier, and a risk score,
  all authored by n8n and rendered without recomputation (§3.1, FIT-01
  through FIT-09).
- **One data point** suggesting `total_score` might equal the simple sum of
  the five components, observed only in two fixture rows (FIT-10) — this is
  fixture/contract-shape evidence, not a verified formula, and must not be
  treated as the production rule.
- **No weights, no thresholds, no tier cutoffs** are defined anywhere in
  code. The tier values themselves (`outbound_now`, `sales_review`,
  `nurture`, and a `low` value the code anticipates but no current fixture
  carries — `gtmContract.js:535-539`) are an **observed enum**, not a
  derivation rule.
- **Which scoring model feeds the cockpit today:** whichever one n8n writes
  into whichever Sheets tab `ICP_Config.queue_source` currently points to
  (`signal_queue` → `ICP_Review_Queue`, or `account_queue` →
  `ICP_Account_Queue` — `sheets.ts:556-565`). Both tabs carry *different*
  score shapes: `ICP_Review_Queue` has a single `account_score`/`score_tier`
  pair (`QUEUE_COLUMNS`, `gtmContract.js:6-14`); `ICP_Account_Queue` has the
  five-component breakdown (observed in `MOCK_ACCOUNT_QUEUE`,
  `mockData.js:70-86`). This is architecturally significant: **the two
  queue paths are not the same scoring model with different routing — they
  appear to be two different score shapes entirely**, and Phase 0 has not
  been able to confirm from this repo alone whether `ICP_Review_Queue` rows
  ever receive the five-component breakdown in production.

---

## 5. Routing-model map

| Layer | What it does | Verified? |
|---|---|---|
| n8n | Assigns `recommended_output` (account_queue) and (presumably) `score_tier`/`gate_status`/`block_reason` (both queues) | **UNVERIFIED** |
| Frontend, account_queue path | Trusts `row.recommended_output`; falls back to `"Sales Review"` if unrecognized (ROUTE-04) | Verified (this repo) |
| Frontend, signal_queue path | **Independently derives** MQL/Sales Review/Nurture/Suppressed from `score_tier`+`engine_status`+`gate_status`+`block_reason` (ROUTE-05) | Verified (this repo) — this is the one confirmed instance of routing logic living outside n8n |
| Frontend, both paths | `buttonsForOutput()` maps the resulting output type to available actions (ROUTE-01) | Verified (this repo) |
| Frontend, both paths | `NO_PROSPECT` set further restricts prospect-facing actions regardless of identity (ELIG-05) | Verified (this repo) |

`SALES_REVIEW_REASONS` (`no_lawful_channel`, `low_confidence_match`,
`region_unknown`, `below_mql_threshold`, `strong_account_needs_review`,
`low_fit_high_activity`, `manual_review_required` — `gtmContract.js:120`)
are rendered with plain-language labels but **which condition produces each
one is UNVERIFIED** — no code in this repo assigns a `sales_review_reason`
value; it only ever reads one that n8n already wrote.

---

## 6. Duplication register

| ID | What's duplicated | Locations | Severity | Recommendation |
|---|---|---|---|---|
| DUP-01 | Routing classification (MQL/Sales Review/Nurture/Suppressed) for signal-queue rows | `queue-helpers.ts:24-38` (frontend) vs. whatever n8n internally decides for the same rows (UNVERIFIED) | **High** — this is live, user-facing routing logic outside the canonical evaluator | Root cause is a schema gap: `ICP_Review_Queue` has no `recommended_output` column. Phase 1/2 should extend the normalized snapshot to always carry a canonical `recommended_output` (or retire the signal_queue shape entirely in favor of one queue schema), then delete `signalOutputType()` |
| DUP-02 | `rowButtons()` filter logic re-implemented for tests | `queue-helpers.ts:126-131` (TypeScript, frontend workspace) vs. `visibleButtonsFor()` in `scenarios.test.js:34-38` | Low — both call the same underlying `buttonsForOutput`/`hasIdentifiedContact` from `gtmContract.js`; the file's own header comment (`scenarios.test.js:6-11`) explains this is a cross-workspace test-runner limitation, not independent business logic | No functional risk today, but there is no shared test enforcing the two stay in sync if `rowButtons()` changes. Worth a lint/test note when Package 2 touches this area |
| DUP-03 | An entire second implementation of the Sheets-read and n8n-post logic | `lib/reference/server_n8n.js`, `lib/reference/server_sheets.js` vs. the live `artifacts/api-server/src/routes/{n8n,sheets}.ts` | Low (dead code) but a real confusion risk | Confirmed: not in `pnpm-workspace.yaml`, no `package.json`, zero imports anywhere. Recommend deleting or clearly marking as historical-only in a follow-up PR (not this one — no application code changes here) |

---

## 7. Conflict register

| ID | Conflict | Evidence | Assessment |
|---|---|---|---|
| CONFLICT-01 | The two queue paths encode "is this row gated" differently: `buttonDisabled()` (signal path) hard-blocks activation when `row.gate_status === "blocked"` (`gtmContract.js:109`); `buttonDisabledPhaseC()` (account path) **never reads `row.gate_status` at all** — it relies on discrete fields (`consent_email`, `li_basis_cleared`, `NO_PROSPECT`, `engine_mode`, identity) instead | `gtmContract.js:92-112` vs. `149-165` | Not necessarily a bug — the two schemas differ — but it means a `gate_status` of `"warning"` or `"failed"` on an account-queue row (both values are observed in fixtures, e.g. `scenarioFixtures.js:187` `gate_status:"warning"`) has **no uniform hard-block effect** on that path; it only affects what's displayed. The canonical evaluator must decide a single, uniform meaning for gate status across both shapes |
| CONFLICT-02 | Email has a legal-basis/consent gate (ELIG-04); LinkedIn has none | `gtmContract.js:158-162` | **Deliberate and documented**, not a bug — comment explicitly defers LinkedIn's legal-basis policy as "a separate, not-yet-defined product/legal decision" (`gtmContract.js:158-161`). This is a real open policy gap that Package 2/3 needs an actual decision on, not silence |
| CONFLICT-03 | Root cause of DUP-01 | `QUEUE_COLUMNS` (`gtmContract.js:6-14`) has no `recommended_output` field | Same issue as DUP-01, listed separately because it's a schema conflict (missing column), not just duplicated logic |

---

## 8. Missing-data behavior register

Every one of these is verified against this repo's code and/or its test
suite (file:line given). The consistent pattern is **fail-closed toward
least access / least claim**, never zero-filled, never fabricated:

| Field/Rule | Missing/invalid behavior | Evidence |
|---|---|---|
| Score components (fit/interest/identity/actionability/timing) | "Not available", never 0 | `gtmContract.js:582-593`; tested `gtmContract.test.js:53-77` |
| `account_score`/`total_score` | First valid candidate; all missing → `null` → "Not available" | `gtmContract.js:559-571`; tested `gtmContract.test.js:81-96` |
| `risk_score` | Missing → "Risk not calculated"; sentinel (999/1998) → "Risk data unavailable" (distinct from missing) | `gtmContract.js:602-610`; tested `gtmContract.test.js:100-126` |
| `mql_flag` | Unrecognized/missing → "MQL qualification not recorded", **never coerced to false** | `gtmContract.js:616-636`; tested `gtmContract.test.js:130-168` |
| `score_tier` | Missing → "Not available"; unknown → humanized, not invented business meaning | `gtmContract.js:548-551`; tested `gtmContract.test.js:172-185` |
| Identity resolution | Missing/unrecognized → `"anonymous"` (fail-closed, least access) | `gtmContract.js:281-289` |
| `engine_mode` | Missing → `"paused"` (fail-closed, least activation) | `gtmContract.js:104` |
| `visitor_claim_allowed` | Missing/not `"true"` → treated as false; forbidden-phrase rewriting applies | `gtmContract.js:169` |
| Industry | Missing/blank → "Not recorded", never fabricated | `gtmContract.js:858-862`; tested `gtmContract.test.js:463-467` |
| `matched_by`/`match_confidence` | Missing → "Not available" | `gtmContract.js:660-671` |
| Row freshness timestamp | Missing/invalid → "Not available" | `gtmContract.js:674-680` |
| `recommended_output` (account queue) | Unrecognized → falls back to `"Sales Review"` (forces human review, doesn't drop the row) | `queue-helpers.ts:41-44` |
| Account-queue config (`cfg`) | Missing/empty → fail-closed, activation blocked outside preview | Tested `gtmContract.test.js:1087-1091` |
| Research eligibility identifier | No usable identifier → not eligible (fail-closed) | `researchEligibility.js:58-63`; tested `researchEligibility.test.js:9-25` |
| Composer field values | Blank field omitted from text, never a placeholder (`"undefined"`/`"N/A"`/`"{{...}}"`) | `messageComposer.js` module header + tested extensively, e.g. `messageComposer.test.js:154-173` |
| n8n response proof fields | Anything not on the explicit whitelist is discarded, never trusted as proof of persistence/execution | `gtmContract.js:714-746`; tested `gtmContract.test.js:303-329` |

---

## 9. Persistence-versus-inference map

**Persisted today (Google Sheets, via n8n — not owned by this repo):**
`engine_status`, `gate_status`, `block_reason`, `score_tier`,
`account_score`/`total_score`, the five score components, `recommended_output`
(account_queue only), `recommended_action`, `recommended_solution`,
`why_now`, `operator_decision`, `approved_by`, `approved_at`, `reason`,
`final_status`, `processed_at`, `identity_resolution`/`resolution_level`,
`hubspot_owner`, `open_opportunity`, `existing_customer`, `competitor_flag`,
`consent_email`, `li_basis_cleared`, `visitor_claim_allowed`,
`ICP_Config` key/value pairs, `ICP_Suppression` rows.

**Persisted in PostgreSQL:** nothing. `lib/db/src/schema/index.ts` is an
empty scaffold (`export {}`) — confirmed directly, not inferred.

**Inferred/derived at render time, never itself persisted:**

- `signalOutputType()`'s MQL/Sales Review/Nurture/Suppressed classification
  for signal-queue rows (ROUTE-05) — recomputed on every render from
  persisted fields.
- `accountOutputType()`'s enum-validation fallback (ROUTE-04).
- `needsReview`/`needsReviewAccount`/`isRowProcessed`/`countUnresolvedRows`
  — all recomputed from persisted fields, not persisted themselves, so
  always consistent with the underlying sheet state at read time.
- Research eligibility and purposes (`getResearchEligibility`) — recomputed
  every render from persisted row fields; **not itself persisted anywhere**.
  This matters directly for Package 4/5: a Client Radar research request
  will need its own durable record, since eligibility today leaves no
  trace of having been checked.
- Composer draft text — fully ephemeral client-side state until an operator
  explicitly approves; only then does `message_draft`/`subject` get sent to
  n8n as part of the approval payload (`queue-helpers.ts:176-207`,
  `buttonPostBody`).

**Persisted only as a display artifact, not as canonical evaluator state:**
the lifecycle envelope (`accepted`/`persisted`/`execution_confirmed`/etc.,
`gtmContract.js:815-845`) describes the outcome of *one request*; whether
and how it's durably stored beyond the sheet row's `final_status`/
`processed_at` is **UNVERIFIED** — that's n8n/Sheets-side.

---

## 10. n8n and Google Sheets dependency map

### n8n endpoints (all UNVERIFIED beyond the shape this repo sends/expects)

| Endpoint | Purpose | Source |
|---|---|---|
| `/webhook/gtm-activate` | Approve voice/email/linkedin | `gtmContract.js:29`, called from `n8n.ts:210-252` |
| `/webhook/gtm-decision` | reject / nurture / manual_review / suppress | `gtmContract.js:30`, `n8n.ts:258-298` |
| `/webhook/gtm-action` | owner_alert / retry | `gtmContract.js:31`, `n8n.ts:304-344` |
| `/webhook/icp-account-shadow` | "Try a Sample Lead" — shadow engine, side-effect-free | `gtmContract.js:32`, `n8n.ts:402-417` |
| `/webhook/gtm-config` | Settings writes (allowlisted keys only) | `gtmContract.js:33`, `n8n.ts:350-395` |
| `/webhook/icp-personalize-execute` | On-demand personalization preview | `gtmContract.js:34` — **no call site found anywhere in this repo**; declared but apparently unused from the frontend today |

None of these endpoints' internal logic, scoring formulas, or disqualifier
rules are visible from this repository. No n8n workflow JSON exists in this
repo (confirmed by full-tree search). **Workflow JSON on disk elsewhere and
these static route definitions are not proof of live n8n behavior** — they
only prove what this app *sends* and what shape it *expects back*.

### Google Sheets tabs read by this repo

| Tab | Read by | Purpose |
|---|---|---|
| `ICP_Review_Queue` | `sheets.ts:543-598` (`/api/sheets/queue`, signal_queue mode) | Per-signal queue rows |
| `ICP_Account_Queue` | same route, account_queue mode | Per-account queue rows (five-component score shape) |
| `ICP_Account_Records` | `sheets.ts:572,671` | Campaign/account enrichment join |
| `ICP_Config` | `sheets.ts:50-59,524-538` | `engine_mode`, `queue_source`, `us_voice_cleared`, `account_queue_write`, and any other keys (non-safe keys stripped before reaching the browser, `sheets.ts:69-89`) |
| `ICP_Suppression` | `sheets.ts:1100-1115` | Do-not-contact list (display only) |
| `ICP_Action_Log` | `sheets.ts:1120-1136` | Action/decision history (display + campaign-report input) |
| `ICP_Signal_Events` | `sheets.ts:670` (campaign-report only) | Raw signal events for campaign reporting |

All reads are read-only (`spreadsheets.readonly` scope, `sheets.ts:19`).
Nothing in this repo writes to Sheets directly — all writes go through n8n.
**Live Sheet contents, actual current tab structure beyond the columns this
code already expects, and any manually-maintained scoring config inside the
sheet are UNVERIFIED from this repository.**

---

## 11. Unresolved questions

Ranked by importance. Each is tagged with what's needed to resolve it.

1. **What is the actual fit/intent scoring formula (weights, thresholds,
   tier cutoffs)?** Only a shape (FIT-10) is observed from two fixture
   rows. — *Needs: n8n workflow inspection.*
2. **Are `ICP_Review_Queue` (signal_queue) and `ICP_Account_Queue`
   (account_queue) really two different scoring models, or the same model
   with two output shapes?** (§4) This materially affects whether
   `signalOutputType()` (DUP-01) is a stopgap for a schema gap or evidence
   of a genuinely separate legacy scoring path. — *Needs: n8n + Sheets
   inspection.*
3. **What is the real suppression/DNC matching rule?** (ELIG-08) Nothing in
   this repo computes it. — *Needs: n8n inspection.*
4. **What is the real internal-account exclusion rule?** (ELIG-09) Only a
   flag name and one fixture's `block_reason` are visible. — *Needs: n8n
   inspection.*
5. **What is the real personal/free-email handling rule, if any?**
   (ELIG-10) Only a sample-lead preset flag exists. — *Needs: n8n
   inspection.*
6. **Is competitor handling (`competitor_flag`) a real, active rule in
   production, or a dead/planned field?** (ELIG-11) — *Needs: n8n + Sheets
   inspection (check if any live row has this field set to `true`).*
7. **What is LinkedIn's legal-basis/consent policy?** (CONFLICT-02) This is
   a genuine open product/legal decision, not something inspection alone
   resolves — flagged here so it isn't silently carried forward into the
   canonical evaluator as "no rule = no restriction."
8. **What determines each `sales_review_reason` value** (`no_lawful_channel`,
   `below_mql_threshold`, etc.)? This repo only renders them. — *Needs: n8n
   inspection.*
9. **Does `gate_status` (`"warning"`/`"failed"`) have any effect on the
   account-queue path today**, given `buttonDisabledPhaseC()` never reads it
   (CONFLICT-01)? Or is it purely informational on that path? — *Needs: n8n
   inspection to confirm whether n8n itself already prevents such rows from
   reaching `recommended_output` states that would matter.*
10. **Is `/webhook/icp-personalize-execute` (the `preview` endpoint) actually
    used anywhere**, live or planned? No call site exists in this repo. —
    *Needs: n8n inspection, or confirmation it's vestigial.*
11. **What is the current live value of `ICP_Config.queue_source`** in
    production — is the account_queue (five-component) shape actually the
    one operators see today, or is production still on signal_queue? This
    directly determines how urgent DUP-01/ROUTE-05 retirement is. — *Needs:
    Sheets inspection (or a read-only production check, out of scope for
    this document).*
12. **Are there any manually-maintained scoring/threshold values living
    inside the Google Sheet itself** (e.g. an undocumented config tab) that
    this repo's code never reads? — *Needs: Sheets inspection.*

---

## 12. Recommended canonical evaluator boundary

Based only on what this repo actually shows today:

**The canonical evaluator (Package 2, Phase 2) should own:**
- Normalized account snapshot → `fit_score`/`fit_tier`,
  `intent_score`/`intent_tier` (replacing FIT-01–10's n8n-authored,
  unverified formula with one owned, versioned, tested implementation).
- Eligibility outcome, including identity confidence (ELIG-01, already a
  clean, canonical rule worth carrying forward largely as-is), suppression
  (ELIG-08, currently unverified — must be defined from scratch), internal/
  free-email exclusion (ELIG-09/10, currently unverified), and any
  competitor rule if ELIG-11 turns out to be real.
- Matched rules, missing inputs, restrictions, hard disqualifiers as
  first-class structured output (none of this is structured today — only
  ad hoc `block_reason` strings).

**The canonical decision/routing policy (Phase 3) should own:**
- Everything currently encoded across ROUTE-01–06 and ELIG-04/05/12/13/14 —
  i.e., combining the evaluator's fit/intent/eligibility output with
  identified contact, customer status, open opportunity, ownership,
  suppression, previous actions, and engagement recency to assign one of
  the seven `OUTPUT_TYPES`.
- This is also where CONFLICT-02 (LinkedIn legal-basis policy) must finally
  get an explicit rule instead of silence.
- `signalOutputType()` (ROUTE-05/DUP-01) must be retired here: once the
  evaluator+routing policy produces one canonical `recommended_output` for
  *every* normalized account regardless of which legacy Sheet tab it came
  from, the frontend's independent derivation has no reason to exist.

**Action availability (today's `buttonsForOutput`/`buttonDisabled*`, ACT-01–04)
should be reframed as a downstream "channel policy"** that consumes the
routing decision + eligibility restrictions, not an independent rule set —
it already behaves this way in practice, just without a canonical upstream
evaluator to consume from yet.

**What should explicitly stay out of the evaluator:** the truthful-lifecycle
/proof-of-execution machinery (OPS-10) and the operator/auth model (OPS-08)
— those are correctly separate concerns (request-outcome truth vs.
account-evaluation truth) and this repo already keeps them well-isolated.

---

## 13. Migration sequence

1. **Phase 0 (this document):** approve the rule map; resolve or explicitly
   schedule the 12 unresolved questions in §11 — in particular #1, #2, and
   #11, which block Phase 2 from starting with real numbers instead of
   fixture-shape guesses.
2. **Phase 1:** stand up the PostgreSQL schema (accounts, ICP profiles,
   immutable profile versions, activation history, normalized snapshots,
   evaluations, score components, decision history, re-score jobs, audit
   attribution) — currently 100% greenfield (§9).
3. **Phase 2:** build the canonical deterministic evaluator per §12, seeded
   with the real formula/weights/thresholds confirmed in Phase 0 rather than
   the FIT-10 fixture-shape guess.
4. **Phase 3:** build the decision/routing policy per §12, explicitly
   deciding CONFLICT-02 (LinkedIn legal basis) and formalizing ELIG-08/09/
   10/11/12/13/14 as real, owned rules instead of unverified/dead fields.
5. **Phase 4:** n8n boundary migration — remove `signalOutputType()`
   (DUP-01/ROUTE-05) once the evaluator+routing policy covers every queue
   shape; retire or consolidate `lib/reference/*` (DUP-03) as a housekeeping
   side-item.
6. **Phase 5/6:** admin UI and explanation/cutover, running the current
   n8n-derived `recommended_output` alongside the new canonical evaluator's
   output in parallel — the concrete parallel-run check is: for every row,
   diff `signalOutputType(row)`/`row.recommended_output` (old) against the
   canonical evaluator+routing result (new) before flipping any account
   over.

---

## 14. Phase 0 exit criteria

**This document is a repository-only, interim Phase 0 artifact.** Everything
in it was produced by reading code — no n8n workflow and no live Google
Sheet was inspected to produce this draft. Phase 0 is **not complete** until
the n8n and Google Sheets evidence listed below has actually been gathered
and incorporated into an approved revision of this document. This draft is
a necessary precondition for that inspection (it defines exactly what to go
look for), not a substitute for it.

Phase 0 is done when all of the following are true:

- [ ] This document (or its approved revision) is signed off as the
      canonical rule map.
- [ ] The current **live value of `ICP_Config.queue_source`** in production
      is verified directly (not inferred) — this determines whether
      operators are on the signal_queue or account_queue path today, which
      in turn determines how urgent retiring `signalOutputType()`
      (DUP-01/ROUTE-05) actually is.
- [ ] The **live `ICP_Config` keys and their current values** are inspected
      in full — not just the four keys this repo's allowlist (`CONFIG_WRITES`)
      already knows about — to catch any config-driven rule this repo isn't
      aware of.
- [ ] The **real columns and representative live rows** from both
      `ICP_Review_Queue` and `ICP_Account_Queue` are pulled and compared,
      to confirm or refute whether they are one scoring model with two
      output shapes or two genuinely separate models (Unresolved Question
      #2).
- [ ] The **actual n8n workflow(s)** that calculate scoring, gates,
      disqualifiers, and routing are identified by name/ID and reviewed —
      this is the only way to resolve Unresolved Questions #1, #3, #4, #5,
      #6, #8, #9, and #10, none of which can be closed from this repository
      alone.
- [ ] The **assignment logic for each `sales_review_reason` value**
      (`no_lawful_channel`, `low_confidence_match`, `region_unknown`,
      `below_mql_threshold`, `strong_account_needs_review`,
      `low_fit_high_activity`, `manual_review_required`) is mapped to the
      n8n condition that produces it.
- [ ] Any **manually maintained thresholds or scoring configuration living
      inside the Google Sheet itself** (e.g. an undocumented config tab, or
      values hand-edited by an operator rather than written by n8n) are
      identified and documented, or their absence is explicitly confirmed.
- [ ] `/webhook/icp-personalize-execute` is classified as **active,
      planned, or vestigial** (Unresolved Question #10) — no call site
      exists in this repo today.
- [ ] Questions that are genuinely **product/legal decisions rather than
      inspection gaps** — CONFLICT-02 (LinkedIn legal-basis policy) above
      all — are explicitly deferred with a named owner and a target phase,
      rather than left open as if more repository or n8n reading would
      resolve them. "Deferred to Phase 3, owner: <name>" is an acceptable
      exit state for these; "unknown" is not.
- [ ] CONFLICT-01 (gate_status handling asymmetry between queue paths) has
      an explicit resolution recorded for Phase 2's evaluator design.
- [ ] A decision is recorded on whether `signalOutputType()` is migrated as
      a stopgap-preserving compatibility shim or retired outright once
      Phase 2/3 ship.
- [ ] A decision is recorded on whether `mql_flag` becomes a derived
      compatibility field off the routing decision or is retired outright
      (see FIT-09) — it must not be redefined as evaluator-owned
      eligibility output.
- [ ] The migration plan in §13 is approved, in particular the Phase 1
      schema scope and the Phase 2 evaluator's input contract.

No application code, n8n workflow, or Google Sheets content was changed to
produce this document.
