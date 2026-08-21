// Versioned, validated evidence envelope frozen into
// account_snapshots.rawInput for the "gtm-account-current-state-v2"
// source (see ./icpEvaluationResolvers.ts, which builds it, and
// ./mqlDecisionReadiness.ts, which is the ONLY place that reads it back
// to decide evidence-backedness — see that module's own comment on why
// evidence must never be derived from normalizedInput value presence).
//
// This is a snapshot-provenance concept, deliberately kept out of
// lib/evaluator: the evaluator package must stay free of any vocabulary
// about what a snapshot `source` string or its rawInput shape means (see
// ./mqlDecisionReadiness.ts's own module comment for the same
// discipline applied to evidence-backed-field resolution).
//
// Field-aware by construction, not just by convention: company.region's
// evidence value is typed to the closed 'us'|'emea'|'other' set via a
// discriminated union member, so a malformed or out-of-vocabulary region
// value (including the confirmed-vs-unknown "unknown" sentinel) can
// never even be constructed as a valid envelope, let alone persisted
// inside an immutable snapshot.

import { z } from "zod/v4";
import { NonBlankString } from "@workspace/evaluator";
import {
  ACCOUNT_FACT_FIELDS,
  EvidenceReferenceSchema,
  MANUAL_OPERATOR_FACT_SOURCE,
  RESOLVED_FACT_CANONICAL_FIELDS,
  type Account,
  type AccountFact,
  type ResolvedFact,
  type ResolvedFactCanonicalField,
} from "@workspace/db/schema";
import { ManualRegionValueSchema } from "./accountFactValueValidation.js";

export const ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION =
  "account-facts-snapshot-v1";

// Distinct from MANUAL_OPERATOR_FACT_SOURCE — identity evidence
// (company.domain/company.name) comes from the accounts row itself, not
// from an account_facts assertion, so it is attributed to a different,
// equally explicit source label.
export const ACCOUNT_RECORD_IDENTITY_SOURCE = "account-record-v1";

const IdentityEvidenceV1Schema = z
  .object({
    field: z.enum(["company.domain", "company.name"]),
    value: NonBlankString,
    source: z.literal(ACCOUNT_RECORD_IDENTITY_SOURCE),
  })
  .strict();
export type IdentityEvidenceV1 = z.infer<typeof IdentityEvidenceV1Schema>;

const MANUAL_FACT_FREE_TEXT_FIELDS = ACCOUNT_FACT_FIELDS.filter(
  (field) => field !== "company.region",
);

function manualFreeTextEvidenceEntrySchema(field: (typeof MANUAL_FACT_FREE_TEXT_FIELDS)[number]) {
  return z
    .object({
      field: z.literal(field),
      value: NonBlankString,
      accountFactId: z.string().uuid(),
      source: z.literal(MANUAL_OPERATOR_FACT_SOURCE),
      recordedBy: NonBlankString,
      observedAt: z.string(),
      recordedAt: z.string(),
    })
    .strict();
}

const manualRegionEvidenceEntrySchema = z
  .object({
    field: z.literal("company.region"),
    value: ManualRegionValueSchema,
    accountFactId: z.string().uuid(),
    source: z.literal(MANUAL_OPERATOR_FACT_SOURCE),
    recordedBy: NonBlankString,
    observedAt: z.string(),
    recordedAt: z.string(),
  })
  .strict();

// Discriminated on `field`: each of the five Slice 1 fields is its own
// variant, so company.region's value can only ever be validated against
// (and therefore only ever stored as) 'us' | 'emea' | 'other' — never a
// blank/null/empty string and never the "unknown" sentinel.
const ManualFactEvidenceEntrySchema = z.discriminatedUnion("field", [
  manualRegionEvidenceEntrySchema,
  ...MANUAL_FACT_FREE_TEXT_FIELDS.map(manualFreeTextEvidenceEntrySchema),
]);
export type ManualFactEvidenceV1 = z.infer<typeof ManualFactEvidenceEntrySchema>;

function uniqueByField<T extends { field: string }>(entries: T[]): boolean {
  return new Set(entries.map((entry) => entry.field)).size === entries.length;
}

const IdentityEvidenceListSchema = z
  .array(IdentityEvidenceV1Schema)
  .max(2)
  .refine(uniqueByField, { message: "identity evidence fields must be unique" });

const ManualFactEvidenceListSchema = z
  .array(ManualFactEvidenceEntrySchema)
  .max(5)
  .refine(uniqueByField, { message: "manual fact evidence fields must be unique" });

// Milestone 3G — the frozen Milestone 3F resolution result for ONE
// canonical field, at the exact moment this snapshot was created. This
// is ADDITIVE to the envelope (see AccountFactsSnapshotEvidenceV1Schema
// below): `identity`/`evidence` above are untouched and keep meaning
// exactly what they always have (manual account_facts + account-record
// identity only) — this new array is where 3F's reconciliation result
// (manual facts AND provider observations, already combined) is frozen,
// for gtm-account-current-state-v3 snapshots only (see
// ../services/canonicalFactEvaluatorInput.ts, the only builder).
//
// selectedEvidence/supportingEvidence/conflictingEvidence reuse
// @workspace/db/schema's own EvidenceReference shape verbatim (never
// redefined) — these are pointers into observations/account_facts, never
// copies of the underlying evidence itself, matching resolved_facts.ts's
// own provenance discipline. canonicalValue is nullable: a 'conflict'
// row may carry one (a policy-justified winner) or not; 'unresolved'
// never does — see factReconciliation.ts's own state contract, preserved
// here unchanged so a historical snapshot can always answer "why did the
// evaluator see this value" even when that value was null.
const ResolvedFactEvidenceEntrySchema = z
  .object({
    canonicalField: z.enum(RESOLVED_FACT_CANONICAL_FIELDS),
    resolutionState: z.enum(["single_source", "agreement", "conflict", "unresolved"]),
    canonicalValue: z.unknown().nullable(),
    policyVersion: NonBlankString,
    selectedEvidence: EvidenceReferenceSchema.nullable(),
    supportingEvidence: z.array(EvidenceReferenceSchema),
    conflictingEvidence: z.array(EvidenceReferenceSchema),
    resolvedAt: z.string(),
  })
  .strict();
export type ResolvedFactEvidenceV1 = z.infer<typeof ResolvedFactEvidenceEntrySchema>;

function uniqueByCanonicalField(entries: ResolvedFactEvidenceV1[]): boolean {
  return new Set(entries.map((entry) => entry.canonicalField)).size === entries.length;
}

const ResolvedFactEvidenceListSchema = z
  .array(ResolvedFactEvidenceEntrySchema)
  .max(RESOLVED_FACT_CANONICAL_FIELDS.length)
  .refine(uniqueByCanonicalField, {
    message: "resolved fact evidence canonicalFields must be unique",
  });

export const AccountFactsSnapshotEvidenceV1Schema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION),
    account: z.object({ id: z.string().uuid() }).strict(),
    identity: IdentityEvidenceListSchema,
    evidence: ManualFactEvidenceListSchema,
    // Optional: absent on every v1/v2 snapshot ever persisted (backward
    // compatible re-parse — see ../services/mqlDecisionReadiness.ts,
    // which never reads this field and therefore needs no change),
    // always present (though possibly empty) on v3 snapshots.
    resolvedFacts: ResolvedFactEvidenceListSchema.optional(),
  })
  .strict();
export type AccountFactsSnapshotEvidenceV1 = z.infer<
  typeof AccountFactsSnapshotEvidenceV1Schema
>;

/**
 * Pure: converts one canonicalField's resolveAccountCanonicalField()
 * result into this envelope's frozen evidence shape. Sorted by
 * canonicalField for a deterministic snapshot regardless of the
 * Promise.all resolution order ../services/canonicalFactEvaluatorInput.ts
 * computed them in.
 */
export function buildResolvedFactEvidenceEntries(
  resolvedByField: ReadonlyMap<ResolvedFactCanonicalField, ResolvedFact>,
): ResolvedFactEvidenceV1[] {
  return [...resolvedByField.values()]
    .map((row) => ({
      canonicalField: row.canonicalField as ResolvedFactCanonicalField,
      resolutionState: row.resolutionState,
      canonicalValue: row.canonicalValue,
      policyVersion: row.policyVersion,
      selectedEvidence: row.selectedObservationId
        ? ({ kind: "observation", id: row.selectedObservationId } as const)
        : row.selectedManualAccountFactId
          ? ({ kind: "manual_account_fact", id: row.selectedManualAccountFactId } as const)
          : null,
      supportingEvidence: row.supportingEvidence as ResolvedFactEvidenceV1["supportingEvidence"],
      conflictingEvidence: row.conflictingEvidence as ResolvedFactEvidenceV1["conflictingEvidence"],
      resolvedAt: row.resolvedAt.toISOString(),
    }))
    .sort((a, b) => a.canonicalField.localeCompare(b.canonicalField));
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Builds and validates the frozen evidence envelope for one new
 * "gtm-account-current-state-v2" snapshot. `currentFacts` is expected to
 * be the set of account_fact_current-winning account_facts rows for this
 * account (at most one per Slice 1 field) — see
 * ./icpEvaluationResolvers.ts's createCurrentAccountSnapshot, the only
 * caller. Building this from already-CHECK-constrained account_facts
 * rows should always produce a schema-valid envelope; a parse failure
 * here indicates a genuine bug (e.g. a future field added to
 * account_facts without a matching envelope variant), not bad input, so
 * it throws rather than returning a result type.
 */
export function buildAccountFactsSnapshotEvidence(
  account: Pick<Account, "id" | "companyDomain" | "companyName">,
  currentFacts: readonly AccountFact[],
): AccountFactsSnapshotEvidenceV1 {
  const identity: IdentityEvidenceV1[] = [];
  if (isNonBlankString(account.companyDomain)) {
    identity.push({
      field: "company.domain",
      value: account.companyDomain,
      source: ACCOUNT_RECORD_IDENTITY_SOURCE,
    });
  }
  if (isNonBlankString(account.companyName)) {
    identity.push({
      field: "company.name",
      value: account.companyName,
      source: ACCOUNT_RECORD_IDENTITY_SOURCE,
    });
  }

  const evidence = currentFacts.map((fact) => ({
    field: fact.field,
    value: fact.value,
    accountFactId: fact.id,
    source: fact.source,
    recordedBy: fact.recordedBy,
    observedAt: fact.observedAt.toISOString(),
    recordedAt: fact.recordedAt.toISOString(),
  }));

  return AccountFactsSnapshotEvidenceV1Schema.parse({
    schemaVersion: ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
    account: { id: account.id },
    identity,
    evidence,
  });
}
