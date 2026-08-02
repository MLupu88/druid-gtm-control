// Field-aware value validation for manual account facts (Unit 2 Slice 1).
// Single source of truth shared by ../routes/accountFacts.ts (request-body
// validation), ./accountFacts.ts (defense-in-depth before insert), and
// ./accountFactsSnapshotEvidence.ts (the frozen evidence envelope) — every
// caller that needs "is this a valid value for this field" imports this
// module rather than re-deriving an equivalent check.
//
// Deliberately introduces NO new taxonomy, country library, or
// normalization subsystem: company.region reuses the evaluator's own
// RegionV1 vocabulary (narrowed — see ManualRegionValueSchema below);
// every other Slice 1 field reuses the evaluator's own NonBlankString
// primitive verbatim. No curated pick-list exists anywhere in this repo
// for industry/country/employeeRange/revenueRange today (ICP authoring
// itself edits these as free text — see
// artifacts/druid-gtm/src/components/icp-business-rule-rows.tsx), so
// trimmed/non-blank/length-capped is the full extent of "existing
// definitions" available to reuse for those four fields.

import { z } from "zod/v4";
import { NonBlankString, RegionV1 } from "@workspace/evaluator";
import type { AccountFactField } from "@workspace/db/schema";

// The only Slice 1 field with a closed value set. Deliberately excludes
// "unknown": RegionV1's "unknown" member represents the ABSENCE of
// evidence (see lib/evaluator/src/types.ts and
// icpEvaluationResolvers.ts's default `region: "unknown"`), never a
// value an operator can truthfully "confirm" as a fact.
export const ManualRegionValueSchema = RegionV1.exclude(["unknown"]);
export type ManualRegionValue = z.infer<typeof ManualRegionValueSchema>;

export const ACCOUNT_FACT_VALUE_SCHEMA_BY_FIELD: Readonly<
  Record<AccountFactField, z.ZodType<string>>
> = {
  "company.region": ManualRegionValueSchema,
  "company.industry": NonBlankString,
  "company.country": NonBlankString,
  "company.employeeRange": NonBlankString,
  "company.revenueRange": NonBlankString,
};

/**
 * Validates `value` against the field-specific schema above. `field`
 * must already be a recognized AccountFactField (enforced by the type
 * system at every call site — ../routes/accountFacts.ts's request schema
 * validates the raw string first via z.enum(ACCOUNT_FACT_FIELDS)).
 */
export function parseAccountFactValue(field: AccountFactField, value: unknown) {
  return ACCOUNT_FACT_VALUE_SCHEMA_BY_FIELD[field].safeParse(value);
}
