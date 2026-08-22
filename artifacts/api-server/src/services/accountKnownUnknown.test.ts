// Milestone 4C — unit tests for ./accountKnownUnknown.ts's pure
// classification. No DB, no network.
//
// Run with: tsx --test src/services/accountKnownUnknown.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { AccountTruthFieldDTO } from "./accountTruth.js";
import { classifyAccountTruth } from "./accountKnownUnknown.js";

function truthField(overrides: Partial<AccountTruthFieldDTO> = {}): AccountTruthFieldDTO {
  return {
    canonicalField: "company.industry",
    canonicalValue: null,
    resolutionState: "unresolved",
    policyVersion: "v1",
    rationale: "no candidate evidence available",
    computedAt: "2026-08-22T00:00:00.000Z",
    selectedEvidence: null,
    supportingEvidence: [],
    conflictingEvidence: [],
    canonicalDisplayValue: null,
    ...overrides,
  };
}

test("classifyAccountTruth: a field with a resolved value (single_source) is Known, hasConflictingEvidence: false", () => {
  const result = classifyAccountTruth([
    truthField({ canonicalField: "company.industry", canonicalValue: "Banking", resolutionState: "single_source" }),
  ]);
  assert.equal(result.known.length, 1);
  assert.equal(result.known[0]?.hasConflictingEvidence, false);
  assert.deepEqual(result.conflicting, []);
  assert.deepEqual(result.unknown, []);
});

test("classifyAccountTruth: agreement (multiple sources agree) is Known, hasConflictingEvidence: false", () => {
  const result = classifyAccountTruth([
    truthField({ canonicalValue: "Banking", resolutionState: "agreement" }),
  ]);
  assert.equal(result.known[0]?.hasConflictingEvidence, false);
});

test("classifyAccountTruth: conflict WITH a safe winner is Known, but hasConflictingEvidence: true — never silently erased", () => {
  const result = classifyAccountTruth([
    truthField({ canonicalField: "crm.owner", canonicalValue: "Alex Savin", resolutionState: "conflict" }),
  ]);
  assert.equal(result.known.length, 1);
  assert.equal(result.known[0]?.canonicalValue, "Alex Savin");
  assert.equal(result.known[0]?.hasConflictingEvidence, true);
  assert.deepEqual(result.conflicting, []);
});

test("classifyAccountTruth: conflict with NO safe winner is Conflicting, never merged into Known or Unknown", () => {
  const result = classifyAccountTruth([
    truthField({ canonicalField: "crm.owner", canonicalValue: null, resolutionState: "conflict" }),
  ]);
  assert.deepEqual(result.known, []);
  assert.equal(result.conflicting.length, 1);
  assert.equal(result.conflicting[0]?.canonicalField, "crm.owner");
  assert.deepEqual(result.unknown, []);
});

test("classifyAccountTruth: unresolved (no candidate evidence) is Unknown", () => {
  const result = classifyAccountTruth([
    truthField({ canonicalField: "company.region", canonicalValue: null, resolutionState: "unresolved" }),
  ]);
  assert.deepEqual(result.known, []);
  assert.deepEqual(result.conflicting, []);
  assert.deepEqual(result.unknown, ["company.region"]);
});

test("classifyAccountTruth: all 11 fields, each landing in exactly one bucket", () => {
  const fields = [
    truthField({ canonicalField: "company.industry", canonicalValue: "Banking", resolutionState: "single_source" }),
    truthField({ canonicalField: "company.country", canonicalValue: "UAE", resolutionState: "agreement" }),
    truthField({ canonicalField: "company.region", canonicalValue: null, resolutionState: "unresolved" }),
    truthField({ canonicalField: "company.employeeRange", canonicalValue: null, resolutionState: "unresolved" }),
    truthField({ canonicalField: "company.revenueRange", canonicalValue: null, resolutionState: "unresolved" }),
    truthField({ canonicalField: "crm.owner", canonicalValue: "Alex Savin", resolutionState: "conflict" }),
    truthField({ canonicalField: "crm.lifecycleStage", canonicalValue: null, resolutionState: "conflict" }),
    truthField({ canonicalField: "crm.openOpportunity", canonicalValue: null, resolutionState: "unresolved" }),
    truthField({ canonicalField: "crm.existingCustomer", canonicalValue: null, resolutionState: "unresolved" }),
    truthField({ canonicalField: "crm.competitorFlag", canonicalValue: null, resolutionState: "unresolved" }),
    truthField({ canonicalField: "crm.partnerFlag", canonicalValue: null, resolutionState: "unresolved" }),
  ];
  const result = classifyAccountTruth(fields);
  assert.equal(result.known.length, 3); // industry, country, owner(conflict-with-winner)
  assert.equal(result.conflicting.length, 1); // lifecycleStage
  assert.equal(result.unknown.length, 7);
  assert.equal(result.known.filter((f) => f.hasConflictingEvidence).length, 1);
});
