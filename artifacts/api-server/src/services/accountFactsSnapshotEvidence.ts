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
  MANUAL_OPERATOR_FACT_SOURCE,
  type Account,
  type AccountFact,
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

export const AccountFactsSnapshotEvidenceV1Schema = z
  .object({
    schemaVersion: z.literal(ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION),
    account: z.object({ id: z.string().uuid() }).strict(),
    identity: IdentityEvidenceListSchema,
    evidence: ManualFactEvidenceListSchema,
  })
  .strict();
export type AccountFactsSnapshotEvidenceV1 = z.infer<
  typeof AccountFactsSnapshotEvidenceV1Schema
>;

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
