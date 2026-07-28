# ICP Rule Discovery & Truth Map — Package 2, Phase 0

Status: draft, for approval, and **interim** — this remains a Phase 0
discovery/truth-map artifact, not a future-state design document. It began as
a repository-only read (§§1-14 below, largely unchanged) and has since been
extended with a second inspection unit: direct, read-only inspection of the
live n8n instance's workflow **structure** (node code, conditions, field
mappings, via the n8n API) for the 5 active workflows that actually carry
ICP rule logic. No workflow executions, no credentials, and no live Google
Sheet *data* were read in this second pass either — see "Phase 0 status"
immediately below. Phase 0 is **still not complete**: live Google Sheets
configuration values, representative queue records, and several product/
legal decisions remain outstanding (see §14 exit criteria). Deliverable of
ROADMAP.md Package 2 ("Canonical Account Evaluation & Configurable ICP
Profiles"), Phase 0 ("Rule discovery and truth map").

This document inventories every ICP-affecting rule found by reading the
`druid-gtm-control` repository, plus every rule now confirmed by reading the
live n8n workflow definitions for the 5 active, rule-bearing workflows in the
GTM pipeline (`ICP 01 - Signal Intake & Normalize`, `ICP 02v2 - Enrichment
(Cognism + credit gate)`, `ICP 03v2 - Score & Route (config-driven)`,
`ICP Account Shadow (Phase B)`, `GTM Config`). Repository-only findings that
no code implements are marked **UNVERIFIED**, as before. Findings newly
confirmed by live n8n workflow inspection are marked **CONFIRMED (n8n
workflow structure)** and cite the workflow and node name. Live Google Sheet
*data* — the actual weight values, thresholds, live config keys, and row
contents — was not read in either inspection pass and remains **UNRESOLVED**
throughout this document.

## Phase 0 status

| Area | Status |
|---|---|
| Repository code (frontend, api-server, shared libs) | Inspected — see §§1-14 |
| n8n workflow **structure**: the 5 active workflows that implement ICP scoring/routing/config (signal intake, enrichment, score & route, account shadow, config) | **Inspected** — see new §2A |
| n8n workflow **structure**, remaining ~73 non-ICP workflows (Client Radar, MP Publisher, Retail, PMM/job-radar digests, etc.) | Not inspected — out of scope for Package 2 |
| Live Google Sheets **configuration** (`ICP_Config`, `ICP_Scoring_Config`, `Vertical_Map`, actual weight/threshold values) | **Pending** — not read in either inspection pass |
| Representative live **queue/account records** (`ICP_Review_Queue`, `ICP_Account_Queue`, `ICP_Account_Records`) | **Pending** — not read in either inspection pass |
| Product/legal resolution decisions (LinkedIn legal-basis policy, the newly-found US-voice policy conflict between the two scoring engines, CONFLICT-01 gate_status asymmetry) | **Pending** — these are decisions, not inspection gaps; no further reading resolves them |

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

**Evidence discipline (repository pass):** every claim in §§1-14 (aside from
§2A) cites a `file:line`. Where the real production rule (a scoring weight, a
disqualifier list, a threshold) is known only to live inside n8n or a Google
Sheet, this document says so explicitly and does not guess at its shape.

### 1.1 Second inspection unit — live n8n workflow structure

**In scope:** read-only inspection of the live n8n instance via the
read-only use of `GET /api/v1/workflows`. The API key itself was not
technically read-only; the inspection procedure was restricted to GET
requests. Authentication confirmed (HTTP 200). All 78 workflows in the
instance were inventoried at a summary level (id, name, active status, node
count, webhook path) from that response. The 5 workflows that implement ICP
scoring, enrichment, routing, or config-write logic — `ICP 01 - Signal
Intake & Normalize`, `ICP 02v2 - Enrichment (Cognism + credit gate)`,
`ICP 03v2 - Score & Route (config-driven)`, `ICP Account Shadow (Phase B —
resolver/accumulator/scorer)`, and `GTM Config (engine_mode /
us_voice_cleared writes)` — were then extracted from that same
already-fetched workflow response and inspected locally at the node level in
a temporary scratchpad; no separate per-workflow network requests were made.

**Out of scope (per task instructions for this inspection):** workflow
executions, webhook invocations, credential values, live Google Sheet row
contents, and any create/update/activate/deactivate/delete action. The
remaining ~73 workflows in the instance (Client Radar, MP Publisher, Retail,
PMM/job-radar digests, and several `ZZZ_OLD` legacy duplicates) were
inventoried by name/webhook path only, not read at the node level — they sit
outside GTM Mission Control's ICP scoring/routing surface.

**Evidence discipline (n8n pass):** every claim in §2A cites the workflow
name and node name it came from. Secrets, credential IDs, API keys, header
values, Google Sheet document IDs, and complete raw node-parameter bodies are
never reproduced in this document — only the rule logic itself (formulas,
conditions, field mappings, Sheet tab names). Numeric weight and threshold
*values* live only in Google Sheet data, which was not read; every such value
is marked UNRESOLVED even where the config *key* that holds it is confirmed.

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

**Update (second inspection unit):** hard disqualifiers, suppression, and
internal/free-email exclusions are no longer entirely unevidenced — see §2A.
The internal-domain, free-email, competitor, and account-level suppression
rules are confirmed specifically within `ICP Account Shadow`, which remains
shadow-only. `ICP 03v2` is the authoritative per-signal path when
`engine_mode === 'live'`; equivalent enforcement was not found there except
for `do_not_contact` within the Retell eligibility gate.

---

## 2A. n8n live workflow findings (second inspection unit)

This section reports what the previous version of this document could only
presume: the actual rule logic living inside n8n. It is organized around the
single most important structural finding of this inspection pass, stated up
front so it is not lost among the detail below.

### 2A.0 Two separate, independently-coded scoring engines run in parallel today

**CONFIRMED (n8n workflow structure).** GTM Mission Control's ICP pipeline is
not served by one scoring model with two output shapes (the open question
§4/§11 previously left open) — it is served by **two genuinely different,
independently implemented engines**, wired to run side by side on the same
incoming signals:

| | `ICP 03v2 - Score & Route (config-driven)` | `ICP Account Shadow (Phase B — resolver/accumulator/scorer)` |
|---|---|---|
| **Scope** | Scores one **signal/event** in isolation, on each arrival | Resolves the signal to an **account**, then replays the account's *entire* historical event chain on every run |
| **Score shape** | One flat `account_score` = sum of 9 additive weighted boolean checks | Five components — `fit_score` / `interest_score` / `identity_score` / `actionability_score` / `timing_score` — plus a separate risk gate |
| **Tiers** | `outbound_now` / `sales_review` / `light_outbound` / `nurture` (own threshold set) | `outbound_now` / `sales_review` / `nurture` / `low` (different threshold set, different vocabulary) |
| **`mql_flag`** | Derived directly from `routing_action === 'mql'` | Derived from an 8-condition `isMQL` gate (see §2A.4) |
| **Configured live side effects** | **Yes, when `engine_mode === 'live'`.** The workflow POSTs the scored record to a HubSpot-writer webhook and computes `retell_eligible` (a voice-call-eligibility flag consumed elsewhere). **Whether that outbound call results in a successful, live HubSpot write is UNRESOLVED** — the account-level workflow inventory (first inspection unit) found no *active* `ICP 04 - HubSpot Sync Writer` workflow, so the actual downstream persistence path was not confirmed. | **No.** The workflow's own sticky-note documentation states verbatim: *"Changes NOTHING live — no routing, no Retell, no sequences, no MQL creation, no HubSpot writes. The live per-signal engine runs beside this untouched."* Its only live-adjacent write (`ICP_Account_Queue`) is itself gated behind a separate, default-**off** config flag (`account_queue_write`). |
| **Consumes** | `ICP_Config`, `Vertical_Map` | `ICP_Scoring_Config`, `ICP_Free_Email_Domains`, `ICP_Signal_Events`, `ICP_Config` |
| **Writes** | (a configured HTTP call to a HubSpot-writer webhook, gated by `engine_live`; not a direct Sheets write in this workflow) | `ICP_Signal_Events`, `ICP_Account_Records`, `ICP_Shadow_Diff`, and (conditionally) `ICP_Account_Queue` |

**Practical consequence for Package 2:** `ICP 03v2` is the system whose
configured behavior the rest of the roadmap should treat as "what the
cockpit is wired to today," while treating end-to-end delivery to HubSpot as
still-unconfirmed rather than assumed. `ICP Account Shadow` is a second,
more structurally rigorous model already being run in parallel by n8n for
comparison purposes — which is functionally very close to what ROADMAP.md
Package 2, Phase 6 asks for ("run old and new evaluators in parallel before
cutover"). n8n has already started an informal version of that parallel
run; Phase 6 should investigate reusing or formalizing `ICP_Shadow_Diff`
rather than building a comparison mechanism from scratch.

### 2A.1 `ICP 01 - Signal Intake & Normalize` — confirmed rules

- **CONFIRMED (node: `Normalize Signal`)** — country → `stream` classification
  is a hardcoded allowlist: EMEA (`ro, de, at, ch, gb, uk, nl, be, fr, it, es,
  pl, cz, hu, se, no, dk, fi, ie, pt, gr, bg, sk, si, hr, lt, lv, ee, lu, ae,
  sa, za, tr`) vs. US (`us, usa, united states, united states of america,
  u.s., u.s.a.`); anything else non-empty → `'other'`; empty → `'unknown'`.
- **CONFIRMED (node: `Normalize Signal`)** — `resolution_level` default (only
  applied when not already provided upstream): contact_name/email present →
  `self_id`/`person`; else domain present → `company`; else `anonymous`.
- **CONFIRMED (node: `Normalize Signal`)** — missing-data defaults:
  `consent_call`/`consent_email` default `'unknown'` (not false);
  `do_not_contact`, `dpo_voice_cleared`, `mql_flag` default `'false'`. This
  matches the fail-closed pattern already documented in §8 of this document.
- **UNRESOLVED** — `employee_range`, `revenue_range`, `tech_stack`, `vertical`
  are passed through unchanged by this node; no computation happens here
  (confirms §3.2's "no code-level rule found" classification for these
  fields still holds at this stage of the pipeline).
- Sheet tab: `ICP_Signals` (append only). Document ID not reproduced here.

### 2A.2 `ICP 02v2 - Enrichment (Cognism + credit gate)` — confirmed rules

- **CONFIRMED (node: `Enrichment Gate`)** — the "credit gate" in this
  workflow's name is a feature flag + cooldown, not an ICP rule: enrichment
  only proceeds if `ICP_Config.cognism_enabled === 'true'`, the account has a
  domain, and the cached record (if any) is older than
  `ICP_Config.enrich_cooldown_days` (code default 14, live value UNRESOLVED).
- **CONFIRMED (node: `Account Fit Pre-filter`)** — a coarse firmographic
  pre-filter gates whether Cognism credits are spent at all, and the node's
  own comment states this explicitly: *"COARSE credit-protection pre-filter
  (NOT the ICP score - that is config-driven in flow 03)."* Rule:
  `bigEnough = sizeFrom>=200 OR sizeTo>=200 OR revenue>=50,000,000`;
  `excluded = industry matches /staffing|recruit|marketing agency/i`;
  `firmographic_fit = bigEnough && !excluded`.
- **CONFIRMED, high-impact (nodes: `Cognism - Enrich Account`,
  `Cognism - Search Committee`, `Cognism - Redeem Contacts`)** — all three
  Cognism HTTP-request nodes are set to **`disabled: true`** in the live,
  active version of this workflow. A disabled n8n node passes its input
  through unchanged. This means that even when the gate above resolves to
  "enrich," **no live Cognism API call is actually made today** — this
  replaces the prior UNVERIFIED status of Cognism enrichment with a
  confirmed-inert finding at the workflow-structure level.
- **CONFIRMED (node: `Merge + Committee`, code comment)** — contacts
  reconstructed via Cognism committee search are deliberately never upgraded
  to `resolution_level: 'person'`: *"reconstructed != deanonymized, so the
  Retell voice gate in flow 03 still correctly excludes these."* This is a
  real, intentional identity-integrity rule, not a gap.
- Sheet tabs: `ICP_Config` (read), `ICP_Accounts` (read cache + upsert,
  matched on `company_domain`).

### 2A.3 `ICP 03v2 - Score & Route (config-driven)` — confirmed rules (the authoritative per-signal scoring/routing path)

This workflow is the authoritative per-signal scoring/routing path — it
becomes operational (i.e. its scored output is actually acted on) when
`engine_mode === 'live'`. **The current live value of `engine_mode` is
UNRESOLVED** (see Phase 0 status and §11 Q2) — this section describes what
the workflow is *configured* to do, not a confirmed current runtime state.
When live, it POSTs the scored record to a HubSpot-writer webhook
(successful downstream HubSpot persistence is **UNRESOLVED**, see §2A.0)
and computes a voice-call eligibility flag.

- **CONFIRMED (node: `Score & Route (config-driven)`)** — `engine_mode` is
  read from `ICP_Config`, defaulting to `'paused'` if missing (fail-closed);
  `engine_live = (engine_mode === 'live')`. This is the sole gate on the
  HubSpot-writer webhook call.
- **CONFIRMED — vertical classification.** `industry` is substring-matched
  (case-insensitive) against each `Vertical_Map` row's keyword list; first
  match wins; no match falls back to `Other`.
- **CONFIRMED — scoring formula.** A pure additive sum of 9 independent
  boolean checks, each contributing a config-driven weight (**config key
  names and code-fallback defaults are confirmed; live numeric values are
  UNRESOLVED — see below**):

  | Config key | Code fallback default | Fires when... |
  |---|---|---|
  | `weight_icp_vertical` | 20 | industry matches a mapped vertical present in `Vertical_Map` |
  | `weight_enterprise_size` | 15 | employee count ≥ `size_min_employees` (default 200) OR revenue ≥ `size_min_revenue_musd` (default 50) |
  | `weight_tech_fit` | 15 | tech_stack contains any entry from config list `target_tech` |
  | `weight_solution_page` | 20 | page_visited matches solution/patient/claims/scheduling/etc. pattern |
  | `weight_pricing_compliance` | 15 | page_visited matches pricing/compliance/platform pattern |
  | `weight_linkedin_eng` | 10 | signal_source matches `linkedin` |
  | `weight_search_intent` | 25 | signal_source matches google/search AND keyword present |
  | `weight_trigger` | 20 | signal_type includes `trigger` OR signal_detail matches hiring/news/funding/expansion |
  | `weight_known_account` | 25 | hubspot_company_id present OR signal_type includes `known` |

  No cap, no subtraction, no decay — a plain sum.
- **CONFIRMED — tier thresholds (config keys `tier_outbound_now` / default
  100, `tier_sales_review` / default 70, `tier_light_outbound` / default 40;
  live values UNRESOLVED).**
- **CONFIRMED — `routing_action` assignment (first match wins):**
  `hubspot_company_id present → 'owner_alert'`; else
  `tier==='nurture' or anonymous → 'retarget'`; else
  `tier==='light_outbound' → 'sequence'`; else
  `identified → 'mql'`; else `'enrich_then_sequence'`.
- **CONFIRMED — `mql_flag` logic.** `mql_flag = (routing_action === 'mql')`.
  This resolves FIT-09's migration recommendation in §3.1: at this layer,
  `mql_flag` is *literally* a derived compatibility field off the routing
  decision, exactly as recommended — not an independently computed
  eligibility output.
- **CONFIRMED — `retell_eligible` (voice/consent gate), all of:**
  `engine_live AND identified AND phone has ≥8 digits AND consent_call in
  ('true','yes') AND do_not_contact !== 'true' AND (stream==='us' OR
  dpo_voice_cleared==='true') AND score >= retell_min_score (default 100)
  AND NOT hubspot_company_id present`. This flag is computed here but
  whether it actually gates a real outbound voice call happens in a
  downstream workflow not covered by this inspection unit.
- **CONFIRMED — no separate suppression/consent re-check** happens
  immediately before the HubSpot-writer webhook call; the only gate on that
  call is `engine_live`.
- Sheet tabs: `ICP_Config`, `Vertical_Map`.

### 2A.4 `ICP Account Shadow (Phase B)` — confirmed rules (shadow-only, no live authority)

Per its own sticky-note documentation (quoted in full in 2A.0), this
workflow **changes nothing live**. Its findings below describe a
structurally richer model that n8n is already running in parallel, not the
system currently driving cockpit routing.

**Identity / account-key resolution — `resolveAccount()`, first match wins:**

1. Domain in a **hardcoded single-domain set `{'druidai.com'}`** →
   `internal:` account, confidence high. **CONFIRMED — this is the actual
   internal-domain exclusion rule** referenced as UNVERIFIED in the prior
   version of ELIG-09 below. It is one hardcoded domain, not a general
   pattern or Sheet-driven allowlist.
2. Domain present, not a free-email domain → `dom:` account, confidence high.
3. `hubspot_company_id` present → `hs:` account, confidence high.
4. Contact email's domain present, not free/internal → `dom:` account
   (via email domain), confidence medium.
5. Contact email's domain **is** a free-email domain →
   **no account is ever formed** (`account_key=''`), confidence none.
   **CONFIRMED — this is the actual free/personal-email rule** referenced as
   UNVERIFIED in the prior version of ELIG-10 below. The free-email domain
   list is read from Sheet tab `ICP_Free_Email_Domains`, column `domain`.
6. Normalized company name present → `name:` account, confidence low.
7. Else → unmatched/anonymous, no account.

**Identity rank (no-downgrade model), ascending:** `anonymous(0) <
company_level(1) < reconstructed_contact(2) < identified_contact(3) <
known_crm_contact(4)`. An account's `identity_resolution` only ever
upgrades across accumulated signals, never downgrades.

**Industry tier map — CONFIRMED, with a flagged discrepancy.** The scoring
code embeds its own 4-tier map (A: insurance/banking/financial
services/finserv/telecom/telecommunications/transportation/logistics; B:
healthcare/higher education/education; C: software/technology/manufacturing;
D: everything else) rather than reading a Sheet tab. The code's own comment
says *"minimal embedded map; production reads Industry_Tiers tab"* —
**UNRESOLVED / discrepancy flagged**: this implies an `Industry_Tiers` Sheet
tab is the intended real source, but this workflow does not actually read
it. Worth confirming with the workflow owner whether that tab exists and is
meant to be wired in, or whether the comment is stale.

**Interest scoring — CONFIRMED exclusion.** `interestFromSignal()` returns
zero components whenever `source==='cognism'` or the signal is
CRM-known-only from HubSpot — the code comment states *"NO interest from
enrichment/CRM-known."* Interest is decayed by recency
(`decay_le7d`/`decay_le30d`/`decay_gt30d`, config-driven, live values
UNRESOLVED) with a multi-source corroboration bonus.

**Five-component account score — CONFIRMED formula, config key names
confirmed, live numeric values UNRESOLVED:**

- `fit_score = fit_industry_<TIER> + fit_size + fit_region + fit_persona`.
  `fit_region` fires **only if region === 'emea'** — the target-region list
  is hardcoded to exactly one region, nothing else qualifies.
- `interest_score` = decayed interest points + corroboration bonus.
- `identity_score` = config value keyed by `identity_resolution`.
- `actionability_score = action_email + action_linkedin + action_phone +
  action_owner`. **CONFIRMED, notable:** for `action_phone`
  ("voice-eligible"), the region-`us` branch is **hardcoded to `false`
  unconditionally** — no US voice is ever actionable in this model,
  regardless of any consent flag. Non-US requires
  `dpo_voice_cleared==='true' OR consent_call==='true'`.
- `timing_score` — recency/velocity bonus, **hardcoded point values (8/5/2
  for recency buckets, +4 repeat visit, +3 multi-source)**, unlike every
  other score group, which is config-driven.
- `risk_score` — `+999` if region unknown/blank, **independently** `+999` if
  `do_not_contact==='true'` (so both together produce `1998`). **CONFIRMED —
  this exactly explains the risk-sentinel values (999, 1998) already
  documented as FIT-08 in §3.1**, previously observed only in fixture data.
  The sentinel is excluded from the final subtraction, so it never actually
  reduces the visible score — it is a pure gate consumed in `decide()`
  (below), not a score penalty.
- `total_score` tiers: ≥70 `outbound_now`; ≥45 `sales_review`; ≥25
  `nurture`; else `low` — a **different threshold set and vocabulary** than
  `ICP 03v2`'s tiers (§2A.3), confirming these are two independent tier
  systems, not shared config.

**MQL gate (`isMQL`) — CONFIRMED, all of the following required:** not
region-unknown; identity is claimable (company_level / reconstructed_contact
/ identified_contact / known_crm_contact); `match_confidence` in
(`high`,`medium`) — **`low` can never become MQL**; `fit_score >=
cfg.FIT_MIN`; `interest_score >= cfg.INTEREST_MIN`; `interest_sources_count
>= 1`; `actionability_score > 0`; not suppressed, not excluded, no open
opportunity, not an existing customer, no owner already assigned.

**Hard disqualifiers — CONFIRMED inside this shadow model, independent of
score:**
- `do_not_contact==='true'` → hard `Suppressed` block.
- Internal domain (currently only `druidai.com`) → hard `Suppressed` block.
- `competitor_flag==='true'` → hard `Suppressed` block. **Confirmed as a
  real, coded hard disqualifier inside `ICP Account Shadow`** — overturning
  the prior "mock-only / dead field" classification of ELIG-11 only for
  this shadow model. `ICP 03v2` ignores the field entirely, so it is not
  enforced by the authoritative per-signal logic inspected in §2A.3.
  Whether any other operational workflow enforces it remains UNRESOLVED.
- `partner_flag==='true'` → diverted to `Owner Alert`, can never become MQL.
- `match_confidence==='low'` → capped at `Sales Review`, can never become
  MQL.

**Suppression — CONFIRMED, and weaker than a canonical implementation
should be.** There is **no separate suppression/DNC list lookup** anywhere
in this workflow (or in any of the other 4 inspected). The only suppression
signal is the per-account `do_not_contact` field, accumulated via
`if (s[k]) acc[k] = lc(s[k])` on each incoming signal. Because an
empty/omitted value is falsy in JavaScript, an **omitted** `do_not_contact`
on a later signal does **not** overwrite a prior value — accumulation is
sticky against omission. However, any later signal that **explicitly**
supplies a non-empty, contradictory value (e.g. the literal string
`'false'`, which is itself truthy) **does** overwrite the field, including
overwriting a prior `'true'`. **INFERRED risk (structure-level, not
confirmed via execution):** suppression is therefore non-sticky against an
explicit contradictory value — a later signal that explicitly asserts
`do_not_contact: false` could un-suppress a previously-suppressed account.
This replaces the prior UNVERIFIED status of ELIG-08 with a confirmed
absence of a dedicated suppression mechanism, plus a flagged correctness
concern (reversible by an explicit contradictory value, not by omission)
for the canonical evaluator to close.

**`sales_review_reason` assignment — CONFIRMED for 5 of 7 enum values.**
The full decision tree (`decide()`), in exact precedence order:

1. suppressed or excluded → `Suppressed`
2. partner account → `Owner Alert`
3. existing customer → `Owner Alert`
4. open opportunity → `Pipeline Assist`
5. `isMQL` → `MQL`
6. known CRM contact or has an owner → `Owner Alert`
   (`owner_can_promote_to_mql: true`)
7. `match_confidence==='low'` → `Sales Review`,
   `sales_review_reason='low_confidence_match'`
8. region unknown and identity claimable → `Sales Review`,
   `sales_review_reason='region_unknown'`
9. identity claimable and: strong fit+interest but zero actionability →
   `Sales Review`, `sales_review_reason='no_lawful_channel'`; or actionable
   and interested but below the MQL bar → `Sales Review`,
   `sales_review_reason` = `'low_fit_high_activity'` (if fit is the limiting
   factor) or `'below_mql_threshold'` (otherwise)
10. anonymous → `Retarget`
11. fallback → `Nurture`

**UNRESOLVED:** two enum values present in the frontend's
`SALES_REVIEW_REASONS` (`gtmContract.js:120`) —
`strong_account_needs_review` and `manual_review_required` — are never
produced anywhere in this workflow. Either they are dead enum values, or a
different workflow/version assigns them; not resolved by this inspection.

**Engine config reads — CONFIRMED.** `ICP_Config.account_queue_write`
(`on`/`off`, default `off`) gates whether this workflow's `ICP_Account_Queue`
write runs at all. `engine_mode`/`us_voice_cleared` are read and stamped
onto the queue-projection row but do **not** gate whether
`ICP_Account_Records`/`ICP_Shadow_Diff` are written — those always run.

**Fields written — CONFIRMED tab names (document ID and row values not
reproduced):** `ICP_Signal_Events` (append, deduped by a hash of
source+timestamp+domain+email+page+type), `ICP_Account_Records`
(upsert by account_key; ~70 columns including all 5 score components,
`score_components_json`, `recommended_output`, `mql_flag`,
`sales_review_reason`, `gate_status`, `block_reason`), `ICP_Shadow_Diff`
(append; diffs this model's output against the legacy per-signal model's
equivalent, per event), and conditionally `ICP_Account_Queue` (upsert by
account_key; an operator-facing projection matching the five-component
shape already observed in this repo's own fixtures, confirming this
workflow is the real source of that shape).

### 2A.5 `GTM Config` — confirmed rules

- **CONFIRMED — authorization.** Compares the request's `x-gtm-secret`
  header against `ICP_Config.webhook_secret`, case-sensitive exact match; an
  empty configured secret always fails.
- **CONFIRMED — full allowlisted config surface (keys and permitted values,
  nothing else can be written through this endpoint):**
  ```
  engine_mode:          live | recommend_only | paused
  us_voice_cleared:     true | false
  queue_source:         signal_queue | account_queue
  account_queue_write:  on | off
  ```
  `queue_source` was already a known, canonical frontend/config concept
  (OPS-02 in §3.6 — the repo already reads and displays it). The **new**
  finding here is that `GTM Config` exposes it as an allowlisted, writable
  key with exactly two permitted values (`signal_queue` / `account_queue`)
  — confirming it as a real n8n-side config write target, not just a
  frontend-read field. This inspection also newly confirms
  `account_queue_write` as a real, gated key — the same key that gates
  `ICP Account Shadow`'s queue write (§2A.4). No other config keys can be
  written through this workflow.
- **CONFIRMED — rejection reasons, in priority order:** `bad_secret` →
  `key_not_allowed` → `invalid_value` → `ok`.
- **CONFIRMED — audit gap.** The audit-log write (`ICP_Config_Log`) only
  happens after a successful `ICP_Config` write; **rejected/unauthorized
  config-change attempts are never logged anywhere.** No persisted trail
  exists for failed attempts today — worth carrying into the canonical
  config-audit design in Package 2/3.

### 2A.6 Cross-cutting conflicts newly found in this inspection unit

**CONFLICT-04 (new) — inconsistent US-voice policy between the two scoring
engines.** `ICP Account Shadow`'s `actionability_score` hard-excludes **all**
US-region voice contact regardless of consent (§2A.4). `ICP 03v2`'s
`retell_eligible` gate instead treats `stream==='us'` as one of two ways to
satisfy the voice-consent condition (the other being
`dpo_voice_cleared==='true'`) — i.e. it does not categorically exclude US
voice. These are two different rules about the same question, each coded
into a currently-active workflow, encoded independently. This needs an explicit
product/legal decision (see Phase 0 status table above and §11), not more
reading.

**CONFLICT-05 (new) — `Industry_Tiers` reference without a reader.** See
§2A.4 above — a code comment references an `Industry_Tiers` Sheet tab that
this workflow does not actually read, using a hardcoded 4-tier map instead.
Needs confirmation of intent, not further code reading.

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
| FIT-10 | `total_score = fit_score + interest_score + identity_score + actionability_score + timing_score`. `risk_score` is a separate decision gate and is not included in or subtracted from `total_score` | Originally observed only in fixture data (`mockData.js:79-80`); **now CONFIRMED against live n8n workflow structure** — this is exactly `ICP Account Shadow`'s `score()` function (§2A.4), not `ICP 03v2`'s formula, which instead sums 9 independent weighted boolean checks into one flat `account_score` (§2A.3) | **CONFIRMED (n8n workflow structure) for `ICP Account Shadow`; still UNVERIFIED as "what the cockpit actually renders today"** | — | — | — | CONFIRMED (n8n) for the shadow model / UNVERIFIED for live cockpit feed | — | The mock fixture's five-component shape matches `ICP Account Shadow`'s output exactly, **not** `ICP 03v2`'s. But `ICP Account Shadow` is explicitly shadow-only and its `ICP_Account_Queue` write is gated off by default (§2A.4) — so this fixture may be modeled on a shape n8n is not yet live-serving. Which formula (if either) the cockpit renders today still depends on the unresolved live value of `ICP_Config.queue_source` (§11 Q11) and remains UNRESOLVED without reading live Sheet data |

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
| ELIG-08 | Suppression / DNC | Only *displayed* — `sheets.ts:1100-1115` (`GET /api/sheets/suppression`, raw passthrough of `ICP_Suppression` tab), `settings.tsx:288-346` (do-not-contact table); referenced as `block_reason` values `"suppressed_or_dnc"`/`"do_not_contact"` (`gtmContract.js:340`), and in fixtures (`mockData.js:85`, `scenarioFixtures.js:159`) | none in this repo computes a suppression match | — | — | — | **CONFIRMED (n8n workflow structure), and weaker than a canonical implementation should be** — see §2A.4. There is no separate suppression/DNC list lookup in any of the 5 inspected workflows; the only suppression signal is the per-account `do_not_contact` field, and it is non-sticky against an explicit later contradictory value (not against omission) | Phase 1 must define a canonical, sticky `suppression` mechanism — the current n8n behavior (single boolean flag, overwritable by an explicit contradictory later signal) should not be carried forward as-is into the canonical evaluator |
| ELIG-09 | Internal/test-account exclusion | Only observed as `block_reason:"excluded:internal"` + `gate_detail.internal_exclusion` in one fixture row (`mockData.js:36-38`); `sample-lead.tsx:55-58` preset `is_internal:true` sends a raw flag to n8n's shadow test-signal endpoint | none in this repo detects an internal domain | — | — | — | **CONFIRMED in `ICP Account Shadow` workflow structure; operational enforcement in the authoritative per-signal engine (`ICP 03v2`) is UNRESOLVED** — see §2A.4, `resolveAccount()`. The confirmed shadow-model rule is a **hardcoded single-domain set (`{'druidai.com'}`)**, not a general domain-suffix rule or Sheet-driven allowlist. `ICP 03v2` (§2A.3) does not read or branch on any internal-domain flag at all | Shadow-model behavior: hard exclude on one hardcoded domain. Production behavior: UNRESOLVED. Future canonical design: a configurable internal-domain list, decided independently of which workflow currently enforces it |
| ELIG-10 | Personal/free-email handling | Only observed as `sample-lead.tsx:60-63` preset `personal_email:true`, forwarded raw to n8n; string `"free_email"` has zero matches anywhere in the codebase | none in this repo | — | — | — | **CONFIRMED in `ICP Account Shadow`: a free-email contact does not form a company account in that model. Whether the authoritative per-signal flow applies the same rule is UNRESOLVED.** See §2A.4, `resolveAccount()` — the signal is diverted to a `no_account` row instead of being scored. Free-email domain list source: Sheet tab `ICP_Free_Email_Domains`, column `domain` (live contents UNRESOLVED). `ICP 03v2` (§2A.3) has no equivalent check anywhere in its code | Shadow-model behavior: hard "no account" rule, sourced from a Sheet-tab domain list. Production behavior: UNRESOLVED. Future canonical design: carry the "no account" rule forward, sourced from a versioned free-email domain list rather than a live-edited Sheet tab |
| ELIG-11 | Competitor handling | `competitor_flag:"false"` exists on exactly one fixture row (`mockData.js:79`) | never read or branched on anywhere in `gtm-shared` or the frontend | — | — | — | **CONFIRMED in `ICP Account Shadow` as a hard disqualifier in that shadow model. It is ignored by `ICP 03v2`, so it must not be described as a live operational disqualifier.** This overturns the previous "mock-only / dead field" classification only for the shadow model — `ICP Account Shadow`'s `decide()` (§2A.4) treats `competitor_flag==='true'` as `Suppressed`/`block_reason='excluded'`; `ICP 03v2` and this repository's frontend/api-server never read the field at all | Shadow-model behavior: hard disqualifier. Production behavior: field is not read, so not enforced. Future canonical design: decide whether competitor exclusion becomes a real, evaluator-owned hard disqualifier, and resolve the `ICP 03v2`/`ICP Account Shadow` inconsistency as part of that decision |
| ELIG-12 | Open-opportunity effect on prospecting | Prospecting-side handling is entirely indirect: `NO_PROSPECT` already includes "Pipeline Assist", which n8n assigns when `open_opportunity` is true (UNVERIFIED how). Only `researchEligibility.js:34-37` reads `row.open_opportunity` directly | `researchEligibility.js:34-37` (research-purpose derivation only) | — | — | — | canonical (research-purpose derivation only); **UNVERIFIED for the prospecting-side rule itself** | Canonical routing policy (Phase 3) must own this explicitly rather than relying on n8n having already baked it into `recommended_output` |
| ELIG-13 | Existing-customer effect on prospecting | Same pattern as ELIG-12 — indirect via `recommended_output==="Suppressed"`; direct read only in `researchEligibility.js:38-41` | `researchEligibility.js:38-41` | — | — | — | canonical (research-purpose derivation only); **UNVERIFIED for the prospecting-side rule itself** | Same recommendation as ELIG-12 |
| ELIG-14 | Account-owner (`hubspot_owner`) effect | Read directly only by `researchEligibility.js:42-45` (owner_support/account_expansion purposes) and displayed; "Owner Alert"/"Pipeline Assist" routing itself is n8n-assigned | `researchEligibility.js:42-45` | — | — | — | canonical (research-purpose derivation only); **UNVERIFIED for the routing-side rule itself** | Phase 3 (decision/routing policy) must own owner-based routing explicitly |

### 3.4 Routing

| ID | Rule | Source | Layer | Classification | Notes |
|---|---|---|---|---|---|
| ROUTE-01 | `buttonsForOutput()` — output type → available actions | `gtmContract.js:129-140` | frontend (shared lib) | canonical | Single source of truth for which buttons an output type offers |
| ROUTE-02 | `OUTPUT_TYPES` enum + labels | `gtmContract.js:119,236-244` | frontend (shared lib) | canonical | MQL / Sales Review / Pipeline Assist / Owner Alert / Nurture / Retarget / Suppressed |
| ROUTE-03 | `SALES_REVIEW_REASONS` enum + labels | `gtmContract.js:120,247-255` | frontend (shared lib) | canonical (display). **CONFIRMED in `ICP Account Shadow` workflow structure for 5 of the 7 enum values** (`low_confidence_match`, `region_unknown`, `no_lawful_channel`, `low_fit_high_activity`, `below_mql_threshold` — exact assignment logic and precedence in §2A.4). **`strong_account_needs_review` and `manual_review_required` are not produced anywhere in the 5 workflows inspected.** Because `ICP Account Shadow` is shadow-only, this confirms only that logic *exists* for these 5 reasons in the shadow model — **whether/how the authoritative per-signal engine (`ICP 03v2`) assigns `sales_review_reason` at all is UNRESOLVED: the `ICP 03v2` code inspected in §2A.3 does not set this field anywhere** |
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

**There is still no scoring model implemented in this repository** — that
part of the original finding stands. What has changed since the first
(repository-only) pass:

- A **display contract** for five score components (fit/interest/identity/
  actionability/timing), a total score, a score tier, and a risk score,
  all authored by n8n and rendered without recomputation (§3.1, FIT-01
  through FIT-09).
- **The five-component `total_score` formula is no longer merely a data
  point from two fixture rows.** It is now **CONFIRMED against live n8n
  workflow structure** (§2A.4, second inspection unit): `total_score =
  fit_score + interest_score + identity_score + actionability_score +
  timing_score` is exactly `ICP Account Shadow`'s `score()` function.
  **This is explicitly not `ICP 03v2`'s formula** — `ICP 03v2` instead sums
  9 independent weighted boolean checks into one flat `account_score`
  (§2A.3). Because `ICP Account Shadow` is shadow-only, confirming this
  formula's structure does not by itself confirm it is what the cockpit
  renders today — see below.
- **Live Google Sheet values for config-driven weights and thresholds
  remain UNRESOLVED.** However, code fallback defaults and hardcoded
  numeric rules are confirmed where present. In particular, `ICP Account
  Shadow` hardcodes total-score tier cutoffs of 70 / 45 / 25 and timing
  values of 8 / 5 / 2, while other components read values from
  `ICP_Scoring_Config`. `ICP 03v2`'s config-driven live values remain
  unresolved, although its code fallback defaults are documented in §2A.3.
  The tier values themselves (`outbound_now`, `sales_review`, `nurture`,
  and a `low` value the code anticipates but no current fixture carries —
  `gtmContract.js:535-539`) are an **observed enum**, not a derivation
  rule.
- **Which scoring model feeds the cockpit today remains UNRESOLVED.**
  `ICP_Config.queue_source` controls which Sheets tab this repository's
  application *reads* (`signal_queue` → `ICP_Review_Queue`, or
  `account_queue` → `ICP_Account_Queue` — `sheets.ts:556-565`); it does not
  by itself control which workflow *writes* data, or whether that tab is
  actively populated with current rows. Separately, `ICP_Config.
  account_queue_write` (§2A.4/§2A.5) controls whether `ICP Account Shadow`
  populates `ICP_Account_Queue` at all — a distinct, independently gated
  concern from `queue_source`. Both tabs carry *different* score shapes:
  `ICP_Review_Queue` has a single `account_score`/`score_tier` pair
  (`QUEUE_COLUMNS`, `gtmContract.js:6-14`); `ICP_Account_Queue` has the
  five-component breakdown (observed in `MOCK_ACCOUNT_QUEUE`,
  `mockData.js:70-86`, and now confirmed as `ICP Account Shadow`'s output
  shape, §2A.4). Resolving which shape operators actually see today
  requires the live values of both config keys **and** inspection of
  representative rows in both tabs (§11 Q11) — none of that Sheet data was
  read in this inspection.

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
rules are visible **from this repository alone**. No n8n workflow JSON
exists in this repo (confirmed by full-tree search). **Workflow JSON on
disk elsewhere and these static route definitions are not proof of live n8n
behavior** — they only prove what this app *sends* and what shape it
*expects back*.

**Update (second inspection unit):** two of these six endpoints —
`/webhook/gtm-config` and `/webhook/icp-account-shadow` — now have their
internal logic documented in §2A.4/§2A.5 from direct n8n workflow
inspection. The other four endpoints' internal logic was not part of this
inspection's scope and remains as stated above.

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

Ranked by importance. Each is tagged with its status after the second
(n8n workflow-structure) inspection unit, and what's still needed to close
it. "RESOLVED" means closed by workflow structure alone. "PARTIALLY
RESOLVED" means the shadow model (`ICP Account Shadow`) now has a confirmed
answer, but the authoritative per-signal path (`ICP 03v2`) and/or live
Sheet data do not. "STILL PENDING" means neither inspection unit closed it.

1. **What is the actual fit/intent scoring formula (weights, thresholds,
   tier cutoffs)?** — **PARTIALLY RESOLVED.** The formula *structure*
   (fields, conditions, which config keys hold each weight) is now
   CONFIRMED for both `ICP 03v2` (§2A.3) and `ICP Account Shadow` (§2A.4).
   **Still pending:** the live numeric *values* of every weight/threshold
   config key — those exist only in Google Sheet data, which was not read.
   — *Needs: Sheets inspection.*
2. **Are `ICP_Review_Queue` (signal_queue) and `ICP_Account_Queue`
   (account_queue) really two different scoring models, or the same model
   with two output shapes?** (§4) — **RESOLVED at the workflow-structure
   level.** CONFIRMED (§2A.0): they are two independently coded engines,
   not a schema variance of one model. `ICP 03v2` is the authoritative
   per-signal scoring/routing path when `engine_mode === 'live'`; the
   current live value of `engine_mode` remains unresolved pending Sheets
   inspection. `ICP Account Shadow` is an explicitly shadow-only, parallel
   per-account model with no live routing authority, regardless of
   `engine_mode`.
3. **What is the real suppression/DNC matching rule?** (ELIG-08) —
   **PARTIALLY RESOLVED.** CONFIRMED (§2A.4): no dedicated suppression/DNC
   list exists in `ICP Account Shadow`; the only signal is a per-account
   `do_not_contact` flag, reversible only by a later signal's *explicit*
   contradictory value, not by omission. **Still pending:** whether the
   authoritative `ICP 03v2` per-signal engine does anything with
   suppression beyond the `do_not_contact` check already folded into its
   Retell/`retell_eligible` gate (§2A.3) — no separate suppression-list
   read was found there either, but this needs explicit confirmation
   rather than inference.
4. **What is the real internal-account exclusion rule?** (ELIG-09) —
   **PARTIALLY RESOLVED.** CONFIRMED in `ICP Account Shadow` workflow
   structure (§2A.4): a hardcoded single domain (`druidai.com`). **Still
   pending:** whether/how the authoritative `ICP 03v2` per-signal engine
   enforces internal-account exclusion — no such check was found in its
   code, but this remains UNRESOLVED rather than confirmed-absent.
5. **What is the real personal/free-email handling rule, if any?**
   (ELIG-10) — **PARTIALLY RESOLVED.** CONFIRMED in `ICP Account Shadow`
   (§2A.4): a free-email contact never forms a company account in that
   model. **Still pending:** whether the authoritative `ICP 03v2`
   per-signal flow applies an equivalent rule — none was found in its code.
6. **Is competitor handling (`competitor_flag`) a real, active rule in
   production, or a dead/planned field?** (ELIG-11) — **PARTIALLY
   RESOLVED.** CONFIRMED as a real, coded hard disqualifier inside `ICP
   Account Shadow` (§2A.4) — no longer a dead/mock-only field. **Still
   pending:** `ICP 03v2` ignores the field entirely, so it is not enforced
   by the authoritative per-signal logic inspected in §2A.3. Whether any
   other operational workflow enforces it remains UNRESOLVED.
7. **What is LinkedIn's legal-basis/consent policy?** (CONFLICT-02) —
   **STILL PENDING — product/legal decision, not an inspection gap.** Not
   resolved by either inspection unit; flagged so it isn't silently carried
   forward into the canonical evaluator as "no rule = no restriction."
8. **What determines each `sales_review_reason` value?** —
   **PARTIALLY RESOLVED.** CONFIRMED in `ICP Account Shadow` workflow
   structure (§2A.4) for 5 of 7 enum values, in exact precedence order.
   **Still pending:** `strong_account_needs_review` and
   `manual_review_required` are not produced anywhere in the 5 workflows
   inspected; and — because `ICP Account Shadow` is shadow-only — whether
   the authoritative `ICP 03v2` per-signal engine assigns
   `sales_review_reason` at all remains UNRESOLVED: no such field is set
   anywhere in the `ICP 03v2` code inspected (§2A.3).
9. **Does `gate_status` (`"warning"`/`"failed"`) have any effect on the
   account-queue path today**, given `buttonDisabledPhaseC()` never reads it
   (CONFLICT-01)? — **STILL PENDING.** `ICP Account Shadow` does compute
   `gate_status` (`passed`/`warning`/`failed`) as part of its decision
   output (§2A.4), but since that workflow is shadow-only and its
   `ICP_Account_Queue` write is gated off by default, this does not resolve
   whether *live* account-queue rows carry a meaningful `gate_status`
   today. — *Needs: Sheets inspection of live `ICP_Account_Queue`/
   `ICP_Review_Queue` rows.*
10. **Is `/webhook/icp-personalize-execute` (the `preview` endpoint)
    actually used anywhere**, live or planned? — **CURRENTLY UNIMPLEMENTED
    in the inspected surface.** No workflow among the 78 inventoried
    workflows exposes this webhook path, and no call site exists in this
    repository. Whether it is planned, externally invoked, or genuinely
    obsolete remains **UNRESOLVED** — this inspection can confirm
    implementation absence in the inspected n8n instance and repository,
    but it cannot prove product intent or the absence of external callers.
11. **What is the current live value of `ICP_Config.queue_source`** in
    production? — **STILL PENDING.** Not resolved by either inspection
    unit; requires reading live Sheet data. This remains the single most
    important open question for scoping how urgent DUP-01/ROUTE-05
    retirement is, and for determining which of the two confirmed scoring
    engines (§2A.0) the cockpit is actually rendering today. Also still
    pending: the live value of `ICP_Config.account_queue_write`, and
    representative rows from both `ICP_Review_Queue` and
    `ICP_Account_Queue` — `queue_source` alone does not prove a queue is
    actively populated (§4).
12. **Are there any manually-maintained scoring/threshold values living
    inside the Google Sheet itself** (e.g. an undocumented config tab) that
    no workflow code reads? — **STILL PENDING**, and now more specifically
    scoped: confirm the live contents of `ICP_Config`, `ICP_Scoring_Config`,
    and `Vertical_Map`, and confirm whether an `Industry_Tiers` tab exists
    at all (see Q14 below) — *Needs: Sheets inspection.*
13. **(New) Does `ICP 03v2`'s configured call to the HubSpot-writer webhook
    result in a successful, live HubSpot write?** — **STILL PENDING.** The
    workflow inventory (first inspection unit) found no *active* `ICP 04 -
    HubSpot Sync Writer` workflow. The outbound call is configured and
    gated by `engine_live` (§2A.3), but successful downstream persistence
    is UNRESOLVED. — *Needs: confirming the live downstream endpoint and/or
    execution history (execution history was explicitly out of scope for
    this inspection).*
14. **(New) Does an `Industry_Tiers` Google Sheet tab actually exist, and is
    it meant to feed `ICP Account Shadow`'s industry-tier scoring?**
    (CONFLICT-05, §2A.4/§2A.6) The workflow's own code comment references
    this tab, but the workflow reads a hardcoded 4-tier map instead. —
    *Needs: Sheets inspection to confirm whether the tab exists, and
    confirmation from the workflow owner of intent.*
15. **(New) Which US-voice rule is correct — `ICP Account Shadow`'s
    unconditional exclusion of all US voice, or `ICP 03v2`'s
    `stream==='us'`-qualifies-as-consent rule?** (CONFLICT-04, §2A.6)
    **This is a product/legal decision, not an inspection gap** — flagged
    here alongside Q7 so it is resolved deliberately rather than inherited
    by accident by the canonical evaluator.

---

## 12. Recommended canonical evaluator boundary

Based on this repo plus the confirmed n8n workflow structure in §2A:

**The canonical evaluator (Package 2, Phase 2) should own:**
- Normalized account snapshot → `fit_score`/`fit_tier`,
  `intent_score`/`intent_tier`, replacing **both** current n8n scoring
  implementations — `ICP 03v2`'s flat 9-check `account_score` (§2A.3) and
  `ICP Account Shadow`'s five-component `total_score` (§2A.4) — with one
  owned, versioned, tested implementation. `ICP Account Shadow` provides
  useful confirmed structure (component breakdown, decay, corroboration,
  MQL gating) to evaluate against, but it is **not automatically the future
  canonical formula** — it is a shadow-only model whose own weights and
  thresholds were never confirmed against live Sheet data, and Phase 2 must
  independently decide the canonical formula rather than inherit this one
  by default. Live Sheet-configured weight/threshold values remain
  UNRESOLVED for both engines; that does not block defining and versioning
  the new canonical model, which does not need to reproduce either engine's
  current numbers.
- Eligibility outcome, including identity confidence (ELIG-01, already a
  clean, canonical rule worth carrying forward largely as-is). Suppression,
  internal-domain exclusion, free-email exclusion, and competitor exclusion
  (ELIG-08/09/10/11) are each **confirmed only inside the shadow model**
  (`ICP Account Shadow`, §2A.4) — `ICP 03v2` does not implement equivalents
  for internal-domain/free-email/competitor exclusion, and only partially
  overlaps on suppression (`do_not_contact` inside its Retell gate). The
  canonical evaluator must not automatically carry these shadow-model rules
  forward as-is; Phase 2/3 must explicitly decide, rule by rule, whether to
  retain, modify, or reject each one (e.g. the single hardcoded internal
  domain, the unconditional US-voice exclusion, the non-sticky suppression
  flag) rather than treating "confirmed in the shadow model" as equivalent
  to "correct for the canonical design."
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

1. **Phase 0 (this document):** approve the current-state rule map and
   record the status of the 15 tracked questions in §11. Remaining Sheet/
   config/runtime questions should be scheduled as migration-validation and
   comparison work; they do not block Phase 1 PostgreSQL foundations or
   the design of the new canonical evaluator. Product/legal decisions must
   be resolved before enabling affected live actions.
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

**This document has moved beyond a repository-only artifact.** It now
combines two inspection units: a full repository read (§§1-14 baseline),
and a second, read-only inspection of live n8n workflow *structure* for the
5 active workflows that carry ICP rule logic (§2A). **Phase 0 is still not
complete** — live Google Sheets configuration values, representative queue
records, and several product/legal decisions have not been gathered and
remain outstanding, as tracked below and in §11.

Phase 0 is done when all of the following are true:

- [ ] This document (or its approved revision) is signed off as the
      canonical rule map.
- [ ] The current **live value of `ICP_Config.queue_source`** in production
      is verified directly (not inferred) — this determines whether
      operators are on the signal_queue or account_queue path today, which
      in turn determines how urgent retiring `signalOutputType()`
      (DUP-01/ROUTE-05) actually is. **Still pending** (§11 Q11).
- [ ] The **live `ICP_Config` keys and their current values** are inspected
      in full — not just the four keys this repo's allowlist (`CONFIG_WRITES`)
      already knows about, and not just the four keys `GTM Config` allowlists
      for writes (§2A.5) — to catch any config-driven rule neither the repo
      nor the workflow structure reveals. **Still pending.**
- [ ] The **real columns and representative live rows** from both
      `ICP_Review_Queue` and `ICP_Account_Queue` are pulled and compared,
      to confirm or refute which of the two confirmed scoring engines
      (§2A.0) the cockpit actually renders today. **Still pending** (§11
      Q2, Q11).
- [x] The **actual n8n workflow(s)** that calculate scoring, gates,
      disqualifiers, and routing are identified by name/ID and their
      **structure** reviewed — done for the 5 active, rule-bearing
      workflows (`ICP 01`, `ICP 02v2`, `ICP 03v2`, `ICP Account Shadow`,
      `GTM Config`, see §2A). This resolves Unresolved Questions #1, #2,
      #3, #4, #5, #6, #8, and #10 **at the workflow-structure level only**
      — several remain partially open pending live Sheet data or
      confirmation of the authoritative per-signal path's behavior (see
      §11 for the exact status of each). The remaining ~73 non-ICP
      workflows in the instance were not reviewed at the node level and
      are out of scope for Package 2.
- [ ] The **assignment logic for each `sales_review_reason` value**
      (`no_lawful_channel`, `low_confidence_match`, `region_unknown`,
      `below_mql_threshold`, `strong_account_needs_review`,
      `low_fit_high_activity`, `manual_review_required`) is mapped to the
      n8n condition that produces it. **Partially done:** 5 of 7 values are
      now mapped to exact conditions inside `ICP Account Shadow` (§2A.4);
      `strong_account_needs_review` and `manual_review_required` remain
      unmapped, and whether the authoritative `ICP 03v2` path assigns this
      field at all remains unresolved (§11 Q8).
- [ ] Any **manually maintained thresholds or scoring configuration living
      inside the Google Sheet itself** (e.g. an undocumented config tab, or
      values hand-edited by an operator rather than written by n8n) are
      identified and documented, or their absence is explicitly confirmed.
      **Still pending**, now more specifically scoped to `ICP_Config`,
      `ICP_Scoring_Config`, `Vertical_Map`, and whether `Industry_Tiers`
      exists (§11 Q12, Q14).
- [x] `/webhook/icp-personalize-execute` is classified as **currently
      unimplemented in the inspected surface** — no workflow among the 78
      inventoried in the n8n instance exposes this webhook path, and no
      call site exists in this repo. Whether it is planned, externally
      invoked, or genuinely obsolete remains UNRESOLVED (§11 Q10) — this
      inspection can confirm absence in what was inspected, not product
      intent or external callers.
- [ ] Questions that are genuinely **product/legal decisions rather than
      inspection gaps** — CONFLICT-02 (LinkedIn legal-basis policy),
      CONFLICT-04 (the newly-found US-voice policy conflict between the two
      scoring engines, §2A.6) above all — are explicitly deferred with a
      named owner and a target phase, rather than left open as if more
      repository or n8n reading would resolve them. "Deferred to Phase 3,
      owner: <name>" is an acceptable exit state for these; "unknown" is
      not. **Still pending** — per §13, these must be resolved before
      enabling any live action they affect, independent of when the rest
      of Phase 0 closes.
- [ ] CONFLICT-01 (gate_status handling asymmetry between queue paths) has
      an explicit resolution recorded for Phase 2's evaluator design.
      **Still pending** — not addressed by the second inspection unit.
- [ ] A decision is recorded on whether `signalOutputType()` is migrated as
      a stopgap-preserving compatibility shim or retired outright once
      Phase 2/3 ship.
- [ ] A decision is recorded on whether `mql_flag` becomes a derived
      compatibility field off the routing decision or is retired outright
      (see FIT-09) — it must not be redefined as evaluator-owned
      eligibility output. `ICP 03v2` already implements `mql_flag` as a
      literal derived compatibility field off `routing_action` (§2A.3),
      which is evidence for this direction but not itself the decision.
- [ ] The migration plan in §13 is approved, in particular the Phase 1
      schema scope and the Phase 2 evaluator's input contract.

No application code, n8n workflow, or Google Sheets content was changed to
produce this document — the second inspection unit was strictly read-only
(GET requests only; no execution, activation, or write actions taken).
