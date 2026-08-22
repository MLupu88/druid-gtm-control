// LS7 — centralized definition registry for inline explainability.
// Every DefinitionHint (../components/definition-hint.tsx) reads from
// this single map, so a term's wording is defined exactly once and
// reused everywhere it appears — never a second, independently-worded
// tooltip hardcoded on some other page.
//
// Every entry here is grounded directly in existing code/contracts —
// see the file comment on each term below for its source. LS7 does not
// invent, rename, or reinterpret any scoring/evaluation/canonical
// semantics; this file only explains what already exists.

export interface DefinitionEntry {
  /** The exact term/label as it appears in the UI. */
  term: string;
  /** What the term means, in plain language. */
  meaning: string;
  /** How the value is produced: calculated (deterministic, rule/query-based), manual (operator-entered), or a specific canonical source. Never "AI-inferred" for anything that isn't. */
  basis: string;
}

// Field vocabulary/semantics verified against:
// - lib/evaluator/src/types.ts (Dimension, IdentityResolutionLevel,
//   IdentityConfidence, EligibilityOutcome, EvaluationResult)
// - artifacts/api-server/src/services/mqlDecisionReadiness.ts
// - artifacts/api-server/src/services/overviewMetrics.ts /
//   overviewCharts.ts (LS3/LS5's own canonical definitions +
//   terminology correction)
// - artifacts/druid-gtm/src/pages/reports.tsx's AttributionSummary
export const DEFINITIONS = {
  observations_captured: {
    term: "Observations captured",
    meaning:
      "The count of canonical observation records Mission Control has recorded in the last 7 UTC calendar days, across every provider and observation type.",
    basis:
      "Calculated — a direct Postgres count. Not a count of distinct external events: one visit, refresh, or research run can produce more than one observation row.",
  },
  accounts_needing_attention: {
    term: "Accounts needing attention",
    meaning:
      "Accounts that currently have at least one open, unresolved attention item. An account with several open items still counts once.",
    basis: "Calculated — reflects current state, not a time window.",
  },
  observations_by_source: {
    term: "Observations by source",
    meaning:
      "How this week's canonical observation volume breaks down by provider (e.g. RB2B, HubSpot, Client Radar).",
    basis:
      "Calculated — a raw row count per provider. Providers differ in how many observation rows one real event produces, so this is a volume view, not a comparable count of external events per provider.",
  },
  icp_fit: {
    term: "Fit",
    meaning:
      "How closely this account's firmographic profile matches the active ICP profile's configured fit criteria, expressed as a score and tier.",
    basis:
      "Calculated by the evaluator from the account's snapshot data and the ICP profile's rules — never manually entered, never AI-inferred.",
  },
  intent: {
    term: "Intent",
    meaning:
      "How closely this account's engagement/behavioral evidence matches the ICP profile's configured intent criteria, expressed as a score and tier.",
    basis:
      "Calculated by the evaluator from recorded engagement evidence and the ICP profile's rules — never manually entered, never AI-inferred.",
  },
  actionability: {
    term: "Actionability score",
    meaning:
      "Whether enough contact and consent evidence exists to act on this account (e.g. reach out to a known person), independent of fit or intent.",
    basis: "Calculated by the evaluator from the account's snapshot data.",
  },
  identity_resolution: {
    term: "Identity resolution",
    meaning:
      "How much Mission Control currently knows about who this account/visitor is, from least to most resolved: anonymous, company, contact, known CRM contact.",
    basis: "Calculated by the evaluator from the evaluation's snapshot evidence.",
  },
  identity_confidence: {
    term: "Identity confidence",
    meaning: "How confident the evaluator is in that identity resolution level: low, medium, or high.",
    basis: "Calculated by the evaluator from the evaluation's snapshot evidence.",
  },
  eligibility: {
    term: "Eligibility",
    meaning:
      "Whether this account is eligible, restricted, or ineligible for action, based on the ICP profile's hard disqualifier and restriction rules (e.g. do-not-contact, consent).",
    basis: "Calculated by the evaluator — never manually overridden here.",
  },
  decision_readiness: {
    term: "Decision readiness",
    meaning:
      "Whether this account's latest completed, official evaluation currently has enough trustworthy, evidence-backed data to support a Promote to MQL decision. When not ready, the specific reasons are always listed.",
    basis:
      "Calculated server-side from the evaluation's snapshot and ICP profile configuration — never manually set, and re-checked every time, not cached from a past state.",
  },
  campaign_attribution: {
    term: "Attribution",
    meaning:
      "For each data source, how many records for this period were successfully matched to a specific campaign (attributed) versus not matched (unattributed).",
    basis: "Calculated from the campaign reporting data for the selected period.",
  },
} as const satisfies Record<string, DefinitionEntry>;

export type DefinitionKey = keyof typeof DEFINITIONS;
