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
  accountAliases,
  accountDecisions,
  accountEvaluations,
  accountPeople,
  accounts,
  accountSnapshots,
  decisionPolicyVersions,
  evaluatorVersions,
  icpProfileActivationEvents,
  icpProfiles,
  icpProfileVersions,
  identityResolutionEvents,
  insertAccountAliasSchema,
  insertAccountDecisionSchema,
  insertAccountEvaluationSchema,
  insertAccountPersonSchema,
  insertAccountSchema,
  insertAccountSnapshotSchema,
  insertDecisionPolicyVersionSchema,
  insertEvaluatorVersionSchema,
  insertIcpProfileActivationEventSchema,
  insertIcpProfileSchema,
  insertIcpProfileVersionSchema,
  insertIdentityResolutionEventSchema,
  insertPersonSchema,
  insertSignalSchema,
  people,
  signals,
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

test("accountEvaluations exports the expected columns, including evaluationMode and profileConfigSnapshot", () => {
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
    "profileConfigSnapshot",
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
    profileConfigSnapshot: { configSchemaVersion: "v1" },
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

test("accountEvaluations insert schema requires profileConfigSnapshot to be an object", () => {
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
      profileConfigSnapshot: ["not", "an", "object"],
    }),
  );
  assert.throws(() =>
    // profileConfigSnapshot has no DB default — omitting it must fail,
    // unlike the jsonb array fields above which default to [].
    insertAccountEvaluationSchema.parse(base),
  );
  const parsed = insertAccountEvaluationSchema.parse({
    ...base,
    profileConfigSnapshot: { configSchemaVersion: "v1" },
  });
  assert.deepEqual(parsed.profileConfigSnapshot, { configSchemaVersion: "v1" });
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

// ---------------------------------------------------------------------
// GTM V2 Unit 1 — Operational Identity and Signal Contracts.
// ---------------------------------------------------------------------

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

test("accountAliases exports the expected columns", () => {
  assert.deepEqual(columnNames(accountAliases), [
    "accountId",
    "aliasType",
    "createdAt",
    "id",
    "isStrong",
    "normalizationStrategy",
    "normalizedValue",
    "rawValue",
    "source",
  ]);
});

test("accountAliases insert schema rejects blank aliasType/rawValue/normalizedValue/source", () => {
  const base = {
    accountId: ZERO_UUID,
    aliasType: "domain",
    rawValue: "example.com",
    normalizedValue: "example.com",
    normalizationStrategy: "domain" as const,
    isStrong: true,
    source: "test",
  };
  assert.throws(() => insertAccountAliasSchema.parse({ ...base, aliasType: "   " }));
  assert.throws(() => insertAccountAliasSchema.parse({ ...base, rawValue: "" }));
  assert.throws(() => insertAccountAliasSchema.parse({ ...base, normalizedValue: "" }));
  assert.throws(() => insertAccountAliasSchema.parse({ ...base, source: "   " }));
  const parsed = insertAccountAliasSchema.parse(base);
  assert.equal(parsed.normalizedValue, "example.com");
});

test("accountAliases insert schema accepts all three normalizationStrategy values", () => {
  const base = {
    accountId: ZERO_UUID,
    rawValue: "value",
    source: "test",
    isStrong: false,
  };
  for (const [aliasType, normalizationStrategy, normalizedValue] of [
    ["domain", "domain", "example.com"],
    ["company_name", "case_insensitive", "acme inc"],
    ["hubspot_company_id", "exact", "AbC123"],
  ] as const) {
    const parsed = insertAccountAliasSchema.parse({
      ...base,
      aliasType,
      normalizationStrategy,
      normalizedValue,
    });
    assert.equal(parsed.normalizationStrategy, normalizationStrategy);
  }
});

test("people exports the expected columns (title is not one of them)", () => {
  assert.deepEqual(columnNames(people), [
    "createdAt",
    "externalId",
    "externalIdSource",
    "fullName",
    "id",
    "linkedinUrl",
    "updatedAt",
    "workEmail",
  ]);
});

test("people insert schema rejects an all-null (identityless) row", () => {
  assert.throws(() =>
    insertPersonSchema.parse({
      fullName: null,
      workEmail: null,
      linkedinUrl: null,
      externalId: null,
      externalIdSource: null,
    }),
  );
});

test("people insert schema accepts a row with exactly one identity attribute", () => {
  const parsed = insertPersonSchema.parse({
    fullName: null,
    workEmail: "jordan@example.com",
    linkedinUrl: null,
    externalId: null,
    externalIdSource: null,
  });
  assert.equal(parsed.workEmail, "jordan@example.com");
});

test("accountPeople exports the expected columns, including title", () => {
  assert.deepEqual(columnNames(accountPeople), [
    "accountId",
    "firstSeenAt",
    "id",
    "isCurrent",
    "lastSeenAt",
    "personId",
    "relationshipType",
    "source",
    "title",
  ]);
});

test("accountPeople insert schema allows omitting isCurrent/firstSeenAt/lastSeenAt (DB-defaulted)", () => {
  const parsed = insertAccountPersonSchema.parse({
    accountId: ZERO_UUID,
    personId: ZERO_UUID,
    source: "test",
  });
  assert.equal("isCurrent" in parsed, false);
  assert.equal("firstSeenAt" in parsed, false);
});

test("signals exports the expected columns — observedResolutionLevel, no accountId/personId", () => {
  const names = columnNames(signals);
  assert.deepEqual(names, [
    "campaignId",
    "campaignName",
    "companyDomain",
    "companyName",
    "createdAt",
    "id",
    "normalizedPayload",
    "observedResolutionLevel",
    "occurredAt",
    "rawPayload",
    "schemaVersion",
    "signalType",
    "source",
    "sourceEventId",
  ]);
  for (const forbidden of ["accountId", "personId", "resolutionLevel"]) {
    assert.equal(
      names.includes(forbidden),
      false,
      `signals must not expose ${forbidden} — it never claims a canonical binding`,
    );
  }
});

test("signals insert schema rejects non-object rawPayload/normalizedPayload", () => {
  const base = {
    source: "hubspot",
    sourceEventId: "evt-1",
    occurredAt: new Date(),
    signalType: "page_view",
    observedResolutionLevel: "anonymous" as const,
    schemaVersion: "v1",
    rawPayload: {},
    normalizedPayload: {},
  };
  assert.throws(() =>
    insertSignalSchema.parse({ ...base, rawPayload: ["not", "an", "object"] }),
  );
  assert.throws(() =>
    insertSignalSchema.parse({
      ...base,
      normalizedPayload: ["not", "an", "object"],
    }),
  );
  const parsed = insertSignalSchema.parse(base);
  assert.deepEqual(parsed.rawPayload, {});
});

test("identityResolutionEvents exports the expected columns", () => {
  assert.deepEqual(columnNames(identityResolutionEvents), [
    "accountId",
    "accountMatchAction",
    "candidateMatches",
    "confidence",
    "createdAt",
    "id",
    "matchedAliasType",
    "matchedAliasValue",
    "outcome",
    "personId",
    "personMatchAction",
    "reason",
    "resolutionLevel",
    "resolutionMethod",
    "resolverVersion",
    "signalId",
  ]);
});

test("identityResolutionEvents insert schema requires resolutionMethod/resolverVersion non-blank", () => {
  const base = {
    signalId: ZERO_UUID,
    outcome: "unresolved" as const,
    resolutionLevel: "anonymous" as const,
    resolutionMethod: "domain_alias_match",
    confidence: "low" as const,
    resolverVersion: "2026.01.0",
  };
  assert.throws(() =>
    insertIdentityResolutionEventSchema.parse({ ...base, resolutionMethod: "  " }),
  );
  assert.throws(() =>
    insertIdentityResolutionEventSchema.parse({ ...base, resolverVersion: "" }),
  );
  const parsed = insertIdentityResolutionEventSchema.parse(base);
  assert.equal(parsed.outcome, "unresolved");
});

test("identityResolutionEvents insert schema restricts outcome/confidence/match-actions to their enums", () => {
  const base = {
    signalId: ZERO_UUID,
    resolutionLevel: "anonymous" as const,
    resolutionMethod: "domain_alias_match",
    confidence: "low" as const,
    resolverVersion: "2026.01.0",
  };
  assert.throws(() =>
    insertIdentityResolutionEventSchema.parse({ ...base, outcome: "made_up" }),
  );
  assert.throws(() =>
    insertIdentityResolutionEventSchema.parse({
      ...base,
      outcome: "unresolved",
      confidence: "certain",
    }),
  );
  assert.throws(() =>
    insertIdentityResolutionEventSchema.parse({
      ...base,
      outcome: "unresolved",
      accountMatchAction: "guessed",
    }),
  );
});
