// Milestone 3G — the ONE adapter between Milestone 3F's canonical fact
// resolution and the evaluator's NormalizedAccountInputV1 input contract.
//
// Recomputes canonical truth at the evaluation boundary (never reads a
// possibly-stale existing resolved_facts row, never introduces a
// background worker — see NEXT_SESSION.md's 3G checkpoint for why): for
// every field in EVALUATOR_CANONICAL_FIELDS, calls
// ../services/factResolutionRun.ts's resolveAccountCanonicalField, which
// itself already combines the account's current manual account_facts
// fact (highest authority when present) with every bound
// firmographic_fact/crm_state observation — this module never re-reads
// account_facts/account_fact_current a second time to layer manual
// evidence on top again; 3F already did that.
//
// Field-name mapping, in ONE place: 3F's canonicalField vocabulary
// (crm.owner, crm.openOpportunity, ...) is provider-neutral; the
// evaluator's own NormalizedCrmV1Schema (lib/evaluator, unmodified by
// this milestone) still names one field `hubspotOwner` — a pre-existing,
// historical field name this milestone does not rename (that would be a
// scoring-model/evaluator-schema change, out of 3G's scope; see
// factResolutionPolicy.ts's own comment on the equivalent provider-
// prefixing tradeoff already accepted in 3C). This module adapts across
// that one naming gap; it never branches on a provider's identity to do
// so, and lib/evaluator itself is never touched.
//
// crm.lifecycleStage is deliberately NOT in EVALUATOR_CANONICAL_FIELDS:
// NormalizedCrmV1Schema has no field for it at all, and no
// FIT_FIELD_ALLOWLIST/ACTIONABILITY_FIELD_ALLOWLIST/
// ELIGIBILITY_FIELD_ALLOWLIST entry references it either (lib/evaluator/
// src/profileConfig.ts) — the existing ICP model has no semantic place
// for it. Computing and freezing a resolution for a field nothing ever
// reads would be scope creep, not integration; a future evaluator schema
// change (out of 3G) would be required first.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import type { ResolvedFact, ResolvedFactCanonicalField } from "@workspace/db/schema";
import type { NormalizedAccountInputV1, RegionV1 } from "@workspace/evaluator";
import { resolveAccountCanonicalField } from "./factResolutionRun.js";
import { ManualRegionValueSchema } from "./accountFactValueValidation.js";

type Db = NodePgDatabase<typeof schema>;

// Exactly the 9 canonical fields with a real place in the evaluator's
// input shape today — see module comment for why crm.lifecycleStage is
// excluded.
export const EVALUATOR_CANONICAL_FIELDS: readonly ResolvedFactCanonicalField[] = [
  "company.industry",
  "company.country",
  "company.region",
  "company.employeeRange",
  "company.revenueRange",
  "crm.owner",
  "crm.openOpportunity",
  "crm.existingCustomer",
  "crm.competitorFlag",
  "crm.partnerFlag",
];

/**
 * Recomputes 3F canonical resolution for every evaluator-relevant field,
 * in parallel (no field depends on another), and persists one new
 * resolved_facts row per field (append-only — see factResolutionRun.ts).
 * Returned Map is keyed by canonicalField so callers never depend on
 * resolution/array order.
 */
export async function resolveEvaluatorCanonicalFacts(
  db: Db,
  accountId: string,
): Promise<Map<ResolvedFactCanonicalField, ResolvedFact>> {
  const results = await Promise.all(
    EVALUATOR_CANONICAL_FIELDS.map((canonicalField) =>
      resolveAccountCanonicalField({ db, accountId, canonicalField }),
    ),
  );
  const byField = new Map<ResolvedFactCanonicalField, ResolvedFact>();
  for (const row of results) {
    byField.set(row.canonicalField as ResolvedFactCanonicalField, row);
  }
  return byField;
}

// A resolved value counts as usable evaluator evidence in exactly two
// states — single_source and agreement (always non-null canonicalValue
// by factReconciliation.ts's own contract), and conflict ONLY when a
// policy-justified winner exists (canonicalValue non-null). unresolved,
// and conflict-with-no-winner, both correctly fall through to `null` /
// the evaluator's existing "unknown" representation below — never a
// guess, matching factReconciliation.ts's state contract exactly.
function usableCanonicalValue(row: ResolvedFact | undefined): unknown | null {
  if (!row) return null;
  if (row.resolutionState === "unresolved") return null;
  if (row.resolutionState === "conflict" && row.canonicalValue === null) return null;
  return row.canonicalValue;
}

function stringFieldOrNull(row: ResolvedFact | undefined): string | null {
  const value = usableCanonicalValue(row);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// Booleans have no tri-state "unknown" representation in
// NormalizedCrmV1Schema (unlike consent's TriStateFlagV1) — this
// module does not add one (that would be an evaluator schema change).
// Preserves the exact convention buildNormalizedAccountInputFromAccount
// already documents for these fields: `true` only when POSITIVELY
// confirmed, `false` for every other case (no evidence, unresolved,
// unjustified conflict) — a conservative default, never an asserted
// negative. See that function's own "SAFETY BOUNDARY" module comment.
function booleanFieldOrFalse(row: ResolvedFact | undefined): boolean {
  return usableCanonicalValue(row) === true;
}

function regionFieldOrUnknown(row: ResolvedFact | undefined): RegionV1 {
  const value = usableCanonicalValue(row);
  if (typeof value !== "string") return "unknown";
  // Only a manual account_fact can ever produce a company.region
  // candidate today (no provider observation type exists for it — see
  // NEXT_SESSION.md's 3E.3 checkpoint), so a resolved value here is
  // already guaranteed to be a valid ManualRegionValueSchema member by
  // construction; parsing (not merely trusting) throws loudly on a
  // genuine data-integrity violation instead of silently defaulting,
  // mirroring icpEvaluationResolvers.ts's own pre-3G behavior exactly.
  return ManualRegionValueSchema.parse(value);
}

/**
 * Pure overlay: takes an already-built sparse NormalizedAccountInputV1
 * (the caller's job — see ../services/icpEvaluationResolvers.ts's
 * buildNormalizedAccountInputFromAccount, unchanged and reused as-is,
 * never duplicated here) and replaces its company and crm fields with
 * 3F's resolved canonical values. engagement/contact/consent/
 * doNotContact pass through UNCHANGED — 3G introduces no new evidence
 * for those; RB2B behavioral_signal/Client Radar research_intelligence
 * are excluded from ICP fact input entirely (see module comment and
 * factReconciliation.ts's own class boundary). Deliberately takes an
 * already-built base object rather than an Account row, so this module
 * never needs to import ../services/icpEvaluationResolvers.ts (which
 * itself imports this module to orchestrate snapshot creation) — a
 * one-directional dependency, not a cycle.
 */
export function applyResolvedFactsToNormalizedInput(
  base: NormalizedAccountInputV1,
  resolvedByField: ReadonlyMap<ResolvedFactCanonicalField, ResolvedFact>,
  source: string,
): NormalizedAccountInputV1 {
  return {
    ...base,
    company: {
      ...base.company,
      industry: stringFieldOrNull(resolvedByField.get("company.industry")),
      country: stringFieldOrNull(resolvedByField.get("company.country")),
      region: regionFieldOrUnknown(resolvedByField.get("company.region")),
      employeeRange: stringFieldOrNull(resolvedByField.get("company.employeeRange")),
      revenueRange: stringFieldOrNull(resolvedByField.get("company.revenueRange")),
    },
    crm: {
      ...base.crm,
      hubspotOwner: stringFieldOrNull(resolvedByField.get("crm.owner")),
      openOpportunity: booleanFieldOrFalse(resolvedByField.get("crm.openOpportunity")),
      existingCustomer: booleanFieldOrFalse(resolvedByField.get("crm.existingCustomer")),
      competitorFlag: booleanFieldOrFalse(resolvedByField.get("crm.competitorFlag")),
      partnerFlag: booleanFieldOrFalse(resolvedByField.get("crm.partnerFlag")),
    },
    source,
  };
}
