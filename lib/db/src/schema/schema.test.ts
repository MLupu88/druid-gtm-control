// Structural tests for the Package 2 ICP profile/evaluation schema.
// These never touch a database — they assert on the shape of the
// Drizzle table objects and Zod insert schemas themselves, so a
// regression (an accidentally renamed/removed column, a loosened
// validation rule) is caught even in environments with no Postgres
// available. Real constraint/trigger behavior is covered separately by
// integrity.integration.test.ts, which requires a live database.
//
// Run with: tsx --test lib/db/src/schema/schema.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import {
  accountDecisions,
  accountEvaluations,
  accounts,
  accountSnapshots,
  decisionPolicyVersions,
  evaluatorVersions,
  icpProfileActivationEvents,
  icpProfiles,
  icpProfileVersions,
  insertAccountDecisionSchema,
  insertAccountEvaluationSchema,
  insertAccountSchema,
  insertAccountSnapshotSchema,
  insertDecisionPolicyVersionSchema,
  insertEvaluatorVersionSchema,
  insertIcpProfileActivationEventSchema,
  insertIcpProfileSchema,
  insertIcpProfileVersionSchema,
} from "./index.js";

function columnNames(table: Parameters<typeof getTableColumns>[0]) {
  return Object.keys(getTableColumns(table)).sort();
}

test("icpProfiles exports the expected columns", () => {
  assert.deepEqual(columnNames(icpProfiles), [
    "activeVersionId",
    "archivedAt",
    "createdAt",
    "createdBy",
    "description",
    "id",
    "name",
  ]);
});

test("icpProfileVersions exports the expected columns", () => {
  assert.deepEqual(columnNames(icpProfileVersions), [
    "config",
    "createdAt",
    "createdBy",
    "id",
    "notes",
    "profileId",
    "publishedAt",
    "status",
    "versionNumber",
  ]);
});

test("icpProfileVersions insert schema always creates drafts (status/publishedAt are not insertable)", () => {
  const parsed = insertIcpProfileVersionSchema.parse({
    profileId: "00000000-0000-0000-0000-000000000000",
    versionNumber: 1,
    config: { weights: {} },
  });
  assert.equal("status" in parsed, false);
  assert.equal("publishedAt" in parsed, false);
});

test("icpProfileActivationEvents exports the expected columns", () => {
  assert.deepEqual(columnNames(icpProfileActivationEvents), [
    "eventType",
    "id",
    "performedAt",
    "performedBy",
    "previousActiveVersionId",
    "profileId",
    "reason",
    "versionId",
  ]);
});

test("evaluatorVersions insert schema trims and requires a non-empty version", () => {
  const parsed = insertEvaluatorVersionSchema.parse({
    version: "  2026.08.0  ",
  });
  assert.equal(parsed.version, "2026.08.0");
  assert.throws(() => insertEvaluatorVersionSchema.parse({ version: "   " }));
});

test("decisionPolicyVersions insert schema trims and requires a non-empty version", () => {
  const parsed = insertDecisionPolicyVersionSchema.parse({
    version: "  2026.08.0  ",
  });
  assert.equal(parsed.version, "2026.08.0");
  assert.throws(() => insertDecisionPolicyVersionSchema.parse({ version: "" }));
});

test("accounts exports the expected columns", () => {
  assert.deepEqual(columnNames(accounts), [
    "accountKey",
    "companyDomain",
    "companyName",
    "createdAt",
    "id",
    "updatedAt",
  ]);
});

test("accounts insert schema rejects a blank account key", () => {
  assert.throws(() => insertAccountSchema.parse({ accountKey: "   " }));
  const parsed = insertAccountSchema.parse({ accountKey: " dom:example.com " });
  assert.equal(parsed.accountKey, "dom:example.com");
});

test("accountSnapshots exports the expected columns", () => {
  assert.deepEqual(columnNames(accountSnapshots), [
    "accountId",
    "capturedAt",
    "createdAt",
    "id",
    "normalizedInput",
    "rawInput",
    "schemaVersion",
    "source",
  ]);
});

test("accountEvaluations exports the expected columns, including evaluationMode", () => {
  assert.deepEqual(columnNames(accountEvaluations), [
    "accountId",
    "actionabilityScore",
    "createdAt",
    "createdBy",
    "eligibilityOutcome",
    "eligibilityRestrictions",
    "errorDetail",
    "evaluationMode",
    "evaluatorVersionId",
    "fitScore",
    "fitTier",
    "hardDisqualifiers",
    "id",
    "identityConfidence",
    "identityResolutionLevel",
    "intentScore",
    "intentTier",
    "matchedRules",
    "missingInputs",
    "profileVersionId",
    "scoreComponents",
    "snapshotId",
    "status",
  ]);
});

test("accountEvaluations does not expose any routing/decision-shaped column", () => {
  const names = columnNames(accountEvaluations);
  for (const forbidden of [
    "routingOutput",
    "routingReason",
    "gateStatus",
    "channelAvailability",
    "overallDecisionGate",
  ]) {
    assert.equal(
      names.includes(forbidden),
      false,
      `account_evaluations must not own ${forbidden} — that belongs on account_decisions`,
    );
  }
});

test("accountEvaluations insert schema rejects non-array jsonb collection fields", () => {
  const base = {
    accountId: "00000000-0000-0000-0000-000000000000",
    snapshotId: "00000000-0000-0000-0000-000000000000",
    profileVersionId: "00000000-0000-0000-0000-000000000000",
    evaluatorVersionId: "00000000-0000-0000-0000-000000000000",
    evaluationMode: "production" as const,
    status: "failed" as const,
    errorDetail: "evaluator threw",
  };
  assert.throws(() =>
    insertAccountEvaluationSchema.parse({
      ...base,
      eligibilityRestrictions: { not: "an array" },
    }),
  );
  const parsed = insertAccountEvaluationSchema.parse({
    ...base,
    eligibilityRestrictions: [],
  });
  assert.deepEqual(parsed.eligibilityRestrictions, []);
});

test("accountDecisions exports the expected columns", () => {
  assert.deepEqual(columnNames(accountDecisions), [
    "accountEvaluationId",
    "blockers",
    "channelAvailability",
    "createdAt",
    "createdBy",
    "decisionPolicyVersionId",
    "id",
    "operationalContextSnapshot",
    "overallDecisionGate",
    "routingOutput",
    "routingReason",
  ]);
});

test("accountDecisions insert schema rejects a non-object operational context snapshot", () => {
  const base = {
    accountEvaluationId: "00000000-0000-0000-0000-000000000000",
    decisionPolicyVersionId: "00000000-0000-0000-0000-000000000000",
    routingOutput: "mql" as const,
    overallDecisionGate: "actionable" as const,
  };
  assert.throws(() =>
    insertAccountDecisionSchema.parse({
      ...base,
      operationalContextSnapshot: ["not", "an", "object"],
    }),
  );
  const parsed = insertAccountDecisionSchema.parse({
    ...base,
    operationalContextSnapshot: {},
  });
  assert.deepEqual(parsed.operationalContextSnapshot, {});
});

test("insertIcpProfileSchema omits activeVersionId (never settable at profile creation)", () => {
  const parsed = insertIcpProfileSchema.parse({
    name: "Enterprise Banking ICP",
  });
  assert.equal("activeVersionId" in parsed, false);
});

test("insertIcpProfileActivationEventSchema round-trips an activation event shape", () => {
  const parsed = insertIcpProfileActivationEventSchema.parse({
    profileId: "00000000-0000-0000-0000-000000000000",
    eventType: "activated",
    versionId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(parsed.eventType, "activated");
});
