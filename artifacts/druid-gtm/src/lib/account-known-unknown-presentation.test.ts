// Milestone 4C — unit tests for ./account-known-unknown-presentation.ts's
// pure classification. No DOM, no React.
//
// Run with: tsx --test src/lib/account-known-unknown-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountTruthField } from "@/lib/account-truth-api";
import { classifyAccountTruthFields, unknownFieldLine } from "./account-known-unknown-presentation.js";

function truthField(overrides: Partial<AccountTruthField> = {}): AccountTruthField {
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

test("classifyAccountTruthFields: a resolved field is Known, hasConflictingEvidence: false", () => {
  const result = classifyAccountTruthFields([
    truthField({ canonicalField: "company.industry", canonicalValue: "Banking", resolutionState: "single_source" }),
  ]);
  assert.equal(result.known.length, 1);
  assert.equal(result.known[0]?.label, "Industry");
  assert.equal(result.known[0]?.value, "Banking");
  assert.equal(result.known[0]?.hasConflictingEvidence, false);
});

test("classifyAccountTruthFields prefers canonicalDisplayValue over the raw canonicalValue", () => {
  const result = classifyAccountTruthFields([
    truthField({ canonicalField: "crm.owner", canonicalValue: "89684655", canonicalDisplayValue: "Mark van der Ree" }),
  ]);
  assert.equal(result.known[0]?.value, "Mark van der Ree");
});

test("classifyAccountTruthFields: a conflict WITH a safe winner is Known but flags hasConflictingEvidence — never silently erased", () => {
  const result = classifyAccountTruthFields([
    truthField({ canonicalField: "crm.owner", canonicalValue: "Alex Savin", resolutionState: "conflict" }),
  ]);
  assert.equal(result.known.length, 1);
  assert.equal(result.known[0]?.value, "Alex Savin");
  assert.equal(result.known[0]?.hasConflictingEvidence, true);
  assert.deepEqual(result.conflicting, []);
});

test("classifyAccountTruthFields: a conflict with NO safe winner is Conflicting, distinct from Unknown", () => {
  const result = classifyAccountTruthFields([
    truthField({ canonicalField: "crm.owner", canonicalValue: null, resolutionState: "conflict" }),
  ]);
  assert.deepEqual(result.known, []);
  assert.equal(result.conflicting.length, 1);
  assert.equal(result.conflicting[0]?.label, "Owner");
  assert.deepEqual(result.unknown, []);
});

test("classifyAccountTruthFields: unresolved is Unknown", () => {
  const result = classifyAccountTruthFields([
    truthField({ canonicalField: "company.region", canonicalValue: null, resolutionState: "unresolved" }),
  ]);
  assert.deepEqual(result.known, []);
  assert.deepEqual(result.conflicting, []);
  assert.deepEqual(result.unknown, ["company.region"]);
});

test("unknownFieldLine uses human product language, never implementation terms", () => {
  const line = unknownFieldLine("company.region");
  assert.ok(line.includes("region"));
  assert.ok(!line.toLowerCase().includes("resolutionstate"));
  assert.ok(!line.toLowerCase().includes("unresolved"));
  assert.equal(line, "We don't yet know the account's region.");
});
