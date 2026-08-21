// Milestone 3F — the ONE explicit, versioned fact-reconciliation policy.
//
// Deterministic rules only, no LLM, no per-call if/else branching on
// provider name anywhere else in this milestone's code — every provider-
// or field-specific decision this policy makes lives here, reviewable in
// one place, and is threaded through factReconciliation.ts as data, never
// hardcoded there.
//
// Manual account_facts authority (rule 1 below) is NOT expressed via
// providerAuthority — it is unconditional and field-scoped by
// construction (a manual candidate can only ever exist for the five
// fields account_facts.ts itself supports; see factResolutionRun.ts's
// loadManualCandidate), so it needs no ranking table entry. providerAuthority
// only ranks NON-manual (provider) candidates against each other, and
// only for fields where this repo has an actual verified reason to trust
// one provider over another for that specific semantic field — see
// NEXT_SESSION.md's 3A.5 findings, not a generic "HubSpot is always
// right" stance.
//
// Today exactly one provider (HubSpot) emits firmographic_fact/crm_state
// observations at all (Client Radar is research_intelligence-only, RB2B
// is behavioral_signal-only — both excluded from this reconciliation
// entirely, see factReconciliation.ts's own header comment). The
// single-entry lists below are therefore not yet exercised by real
// multi-provider conflicts; factReconciliation.test.ts exercises the
// authority tie-break logic itself with synthetic provider names via a
// caller-supplied policy override, so the RULE is tested even though real
// data can't yet trigger it.

import type { ResolvedFactCanonicalField } from "@workspace/db/schema";

export interface FactResolutionPolicyV1 {
  readonly version: string;
  // Ranked, index 0 = most authoritative provider for that field among
  // NON-manual candidates. A provider absent from a field's list (or a
  // field absent from this map entirely) has no claimed authority for
  // that field and can only win a conflict via the defensible-recency
  // fallback, never source authority.
  readonly providerAuthority: Readonly<
    Partial<Record<ResolvedFactCanonicalField, readonly string[]>>
  >;
  // Fields where >=2 candidates carrying DIFFERENT raw representations
  // cannot be safely compared without a repository-defined normalization
  // this repo does not have (see factReconciliation.ts's comparison
  // logic) — company.employeeRange/company.revenueRange today, because
  // account_fact_value_validation.ts confirms no band taxonomy exists
  // anywhere in this repo for either field.
  readonly nonComparableFields: ReadonlySet<ResolvedFactCanonicalField>;
}

const HUBSPOT_ONLY = ["hubspot"] as const;

export const FACT_RECONCILIATION_POLICY_V1: FactResolutionPolicyV1 = {
  version: "fact-reconciliation-policy-v1",
  providerAuthority: {
    "company.industry": HUBSPOT_ONLY,
    "company.country": HUBSPOT_ONLY,
    "company.region": HUBSPOT_ONLY,
    "company.employeeRange": HUBSPOT_ONLY,
    "company.revenueRange": HUBSPOT_ONLY,
    "crm.owner": HUBSPOT_ONLY,
    "crm.lifecycleStage": HUBSPOT_ONLY,
    "crm.openOpportunity": HUBSPOT_ONLY,
    "crm.existingCustomer": HUBSPOT_ONLY,
    "crm.competitorFlag": HUBSPOT_ONLY,
    "crm.partnerFlag": HUBSPOT_ONLY,
  },
  nonComparableFields: new Set(["company.employeeRange", "company.revenueRange"]),
};
