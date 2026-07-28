// Unit tests for the evaluator-result -> account_evaluations row mapping.
// No database needed.
//
// Run with: tsx --test lib/evaluator-persistence/src/mapping.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluationResult } from "@workspace/evaluator";
import {
  mapEligibilityOutcome,
  mapEvaluationResultToInsertRow,
  mapIdentityConfidence,
  mapIdentityResolutionLevel,
} from "./mapping.js";

test("mapIdentityResolutionLevel maps every evaluator value to the identical DB literal", () => {
  assert.equal(mapIdentityResolutionLevel("anonymous"), "anonymous");
  assert.equal(mapIdentityResolutionLevel("company"), "company");
  assert.equal(mapIdentityResolutionLevel("contact"), "contact");
  assert.equal(
    mapIdentityResolutionLevel("known_crm_contact"),
    "known_crm_contact",
  );
});

test("mapIdentityConfidence maps every evaluator value to the identical DB literal", () => {
  assert.equal(mapIdentityConfidence("low"), "low");
  assert.equal(mapIdentityConfidence("medium"), "medium");
  assert.equal(mapIdentityConfidence("high"), "high");
});

test("mapEligibilityOutcome maps every evaluator value to the identical DB literal", () => {
  assert.equal(mapEligibilityOutcome("eligible"), "eligible");
  assert.equal(mapEligibilityOutcome("restricted"), "restricted");
  assert.equal(mapEligibilityOutcome("ineligible"), "ineligible");
});

function syntheticResult(): EvaluationResult {
  return {
    fitScore: 42,
    fitTier: "high",
    intentScore: 7,
    intentTier: "warm",
    identityResolutionLevel: "contact",
    identityConfidence: "high",
    actionabilityScore: 3,
    eligibilityOutcome: "eligible",
    scoreComponents: [
      { ruleId: "r1", dimension: "fit", label: "Rule 1", points: 42 },
    ],
    matchedRules: [
      {
        ruleId: "identity.direct_person_evidence",
        dimension: "identity",
        description: "...",
      },
    ],
    missingInputs: [{ field: "company.industry", affects: ["fit"] }],
    hardDisqualifiers: [],
    eligibilityRestrictions: [],
  };
}

test("mapEvaluationResultToInsertRow converts numeric scores to strings", () => {
  const row = mapEvaluationResultToInsertRow(syntheticResult(), {
    accountId: "acc-1",
    snapshotId: "snap-1",
    profileVersionId: "pv-1",
    profileConfigSnapshot: { configSchemaVersion: "v1" },
    evaluatorVersionId: "ev-1",
    evaluationMode: "production",
    createdBy: "operator-1",
  });
  assert.equal(row.fitScore, "42");
  assert.equal(typeof row.fitScore, "string");
  assert.equal(row.intentScore, "7");
  assert.equal(row.actionabilityScore, "3");
});

test("mapEvaluationResultToInsertRow always sets status completed and errorDetail null", () => {
  const row = mapEvaluationResultToInsertRow(syntheticResult(), {
    accountId: "acc-1",
    snapshotId: "snap-1",
    profileVersionId: "pv-1",
    profileConfigSnapshot: {},
    evaluatorVersionId: "ev-1",
    evaluationMode: "preview",
    createdBy: null,
  });
  assert.equal(row.status, "completed");
  assert.equal(row.errorDetail, null);
});

test("mapEvaluationResultToInsertRow passes through every array field unchanged", () => {
  const result = syntheticResult();
  const row = mapEvaluationResultToInsertRow(result, {
    accountId: "acc-1",
    snapshotId: "snap-1",
    profileVersionId: "pv-1",
    profileConfigSnapshot: {},
    evaluatorVersionId: "ev-1",
    evaluationMode: "preview",
    createdBy: null,
  });
  assert.deepEqual(row.scoreComponents, result.scoreComponents);
  assert.deepEqual(row.matchedRules, result.matchedRules);
  assert.deepEqual(row.missingInputs, result.missingInputs);
  assert.deepEqual(row.hardDisqualifiers, result.hardDisqualifiers);
  assert.deepEqual(row.eligibilityRestrictions, result.eligibilityRestrictions);
});

test("mapEvaluationResultToInsertRow carries the exact context IDs, mode, and profile config snapshot through untouched", () => {
  const config = {
    configSchemaVersion: "v1",
    note: "exact object identity matters",
  };
  const row = mapEvaluationResultToInsertRow(syntheticResult(), {
    accountId: "acc-42",
    snapshotId: "snap-42",
    profileVersionId: "pv-42",
    profileConfigSnapshot: config,
    evaluatorVersionId: "ev-42",
    evaluationMode: "production",
    createdBy: "operator-42",
  });
  assert.equal(row.accountId, "acc-42");
  assert.equal(row.snapshotId, "snap-42");
  assert.equal(row.profileVersionId, "pv-42");
  assert.equal(row.evaluatorVersionId, "ev-42");
  assert.equal(row.evaluationMode, "production");
  assert.equal(row.createdBy, "operator-42");
  assert.equal(row.profileConfigSnapshot, config); // same reference, not a copy
});
