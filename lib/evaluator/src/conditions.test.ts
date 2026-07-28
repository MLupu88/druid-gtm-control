// Unit tests for the closed condition DSL: structural parsing, semantic
// allowlist/type validation, depth bounds, and tri-state evaluation.
//
// Run with: tsx --test lib/evaluator/src/conditions.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  ConditionValidationError,
  MAX_CONDITION_DEPTH,
  conditionDepth,
  dedupeSorted,
  evaluateCondition,
  ruleConditionSchema,
  validateConditionAgainstAllowlist,
  type FieldAllowlist,
  type RuleCondition,
} from "./conditions.js";

const ALLOWLIST: FieldAllowlist = {
  "company.name": "string",
  "company.employeeCount": "number",
  "crm.competitorFlag": "boolean",
  "engagement.sources": "stringArray",
};

// =======================================================================
// Truth tables — each operator, present vs. absent field
// =======================================================================

test("exists is total: match when present, no_match when absent — never unknown", () => {
  const present = evaluateCondition(
    { op: "exists", field: "company.name" },
    { company: { name: "Acme" } },
  );
  assert.equal(present.result, "match");
  assert.deepEqual(present.missingFields, []);

  const absentNull = evaluateCondition(
    { op: "exists", field: "company.name" },
    { company: { name: null } },
  );
  assert.equal(absentNull.result, "no_match");
  assert.deepEqual(absentNull.missingFields, []);

  const absentEntirely = evaluateCondition(
    { op: "exists", field: "company.name" },
    {},
  );
  assert.equal(absentEntirely.result, "no_match");
  assert.deepEqual(absentEntirely.missingFields, []);
});

test("eq: match/no_match when present, unknown + missing field when absent", () => {
  const match = evaluateCondition(
    { op: "eq", field: "company.name", value: "Acme" },
    { company: { name: "Acme" } },
  );
  assert.equal(match.result, "match");

  const noMatch = evaluateCondition(
    { op: "eq", field: "company.name", value: "Acme" },
    { company: { name: "Globex" } },
  );
  assert.equal(noMatch.result, "no_match");

  const unknown = evaluateCondition(
    { op: "eq", field: "company.name", value: "Acme" },
    { company: {} },
  );
  assert.equal(unknown.result, "unknown");
  assert.deepEqual(unknown.missingFields, ["company.name"]);
});

test("in: match/no_match when present, unknown when absent", () => {
  const match = evaluateCondition(
    { op: "in", field: "company.name", values: ["Acme", "Globex"] },
    { company: { name: "Globex" } },
  );
  assert.equal(match.result, "match");

  const noMatch = evaluateCondition(
    { op: "in", field: "company.name", values: ["Acme", "Globex"] },
    { company: { name: "Other" } },
  );
  assert.equal(noMatch.result, "no_match");

  const unknown = evaluateCondition(
    { op: "in", field: "company.name", values: ["Acme"] },
    { company: {} },
  );
  assert.equal(unknown.result, "unknown");
  assert.deepEqual(unknown.missingFields, ["company.name"]);
});

test("gte: match/no_match when present and numeric, unknown when absent or non-numeric", () => {
  const match = evaluateCondition(
    { op: "gte", field: "engagement.count", value: 3 },
    { engagement: { count: 5 } },
  );
  assert.equal(match.result, "match");

  const noMatch = evaluateCondition(
    { op: "gte", field: "engagement.count", value: 3 },
    { engagement: { count: 1 } },
  );
  assert.equal(noMatch.result, "no_match");

  const boundary = evaluateCondition(
    { op: "gte", field: "engagement.count", value: 3 },
    { engagement: { count: 3 } },
  );
  assert.equal(boundary.result, "match");

  const unknownAbsent = evaluateCondition(
    { op: "gte", field: "engagement.count", value: 3 },
    { engagement: {} },
  );
  assert.equal(unknownAbsent.result, "unknown");
  assert.deepEqual(unknownAbsent.missingFields, ["engagement.count"]);

  const unknownWrongType = evaluateCondition(
    { op: "gte", field: "engagement.count", value: 3 },
    { engagement: { count: "not a number" } },
  );
  assert.equal(unknownWrongType.result, "unknown");
});

test("includesAny: match/no_match when present array, unknown when absent or non-array", () => {
  const match = evaluateCondition(
    {
      op: "includesAny",
      field: "engagement.sources",
      values: ["rb2b", "hubspot"],
    },
    { engagement: { sources: ["hubspot", "posthog"] } },
  );
  assert.equal(match.result, "match");

  const noMatch = evaluateCondition(
    { op: "includesAny", field: "engagement.sources", values: ["rb2b"] },
    { engagement: { sources: ["posthog"] } },
  );
  assert.equal(noMatch.result, "no_match");

  const unknownAbsent = evaluateCondition(
    { op: "includesAny", field: "engagement.sources", values: ["rb2b"] },
    { engagement: {} },
  );
  assert.equal(unknownAbsent.result, "unknown");

  const unknownWrongType = evaluateCondition(
    { op: "includesAny", field: "engagement.sources", values: ["rb2b"] },
    { engagement: { sources: "not an array" } },
  );
  assert.equal(unknownWrongType.result, "unknown");
});

// =======================================================================
// Tri-state compound semantics
// =======================================================================

test("not: match<->no_match flip, and not(unknown) remains unknown", () => {
  const notMatch = evaluateCondition(
    { op: "not", condition: { op: "exists", field: "x" } },
    { x: 1 },
  );
  assert.equal(notMatch.result, "no_match");

  const notNoMatch = evaluateCondition(
    { op: "not", condition: { op: "exists", field: "x" } },
    {},
  );
  assert.equal(notNoMatch.result, "match");

  const notUnknown = evaluateCondition(
    { op: "not", condition: { op: "eq", field: "x", value: 1 } },
    {},
  );
  assert.equal(notUnknown.result, "unknown");
  assert.deepEqual(notUnknown.missingFields, ["x"]);

  // Double negation of unknown is still unknown — never flips to a
  // determinate value through repeated negation.
  const doubleNotUnknown = evaluateCondition(
    {
      op: "not",
      condition: { op: "not", condition: { op: "eq", field: "x", value: 1 } },
    },
    {},
  );
  assert.equal(doubleNotUnknown.result, "unknown");
});

test("and: any no_match dominates, all match => match, otherwise unknown", () => {
  const allMatch = evaluateCondition(
    {
      op: "and",
      conditions: [
        { op: "exists", field: "a" },
        { op: "exists", field: "b" },
      ],
    },
    { a: 1, b: 1 },
  );
  assert.equal(allMatch.result, "match");

  const oneNoMatch = evaluateCondition(
    {
      op: "and",
      conditions: [
        { op: "exists", field: "a" },
        { op: "exists", field: "b" },
        { op: "eq", field: "c", value: 1 },
      ],
    },
    { a: 1 }, // b absent (no_match), c absent (unknown)
  );
  assert.equal(oneNoMatch.result, "no_match");

  const matchAndUnknown = evaluateCondition(
    {
      op: "and",
      conditions: [
        { op: "exists", field: "a" },
        { op: "eq", field: "c", value: 1 },
      ],
    },
    { a: 1 }, // c absent -> unknown; no no_match present -> overall unknown
  );
  assert.equal(matchAndUnknown.result, "unknown");
  assert.deepEqual(matchAndUnknown.missingFields, ["c"]);
});

test("or: any match dominates, all no_match => no_match, otherwise unknown", () => {
  const anyMatch = evaluateCondition(
    {
      op: "or",
      conditions: [
        { op: "exists", field: "a" },
        { op: "eq", field: "c", value: 1 },
      ],
    },
    { a: 1 }, // c absent -> unknown, but a matches -> overall match
  );
  assert.equal(anyMatch.result, "match");

  const allNoMatch = evaluateCondition(
    {
      op: "or",
      conditions: [
        { op: "exists", field: "a" },
        { op: "exists", field: "b" },
      ],
    },
    {},
  );
  assert.equal(allNoMatch.result, "no_match");

  const noMatchAndUnknown = evaluateCondition(
    {
      op: "or",
      conditions: [
        { op: "exists", field: "a" },
        { op: "eq", field: "c", value: 1 },
      ],
    },
    {}, // a -> no_match, c -> unknown, no match present -> overall unknown
  );
  assert.equal(noMatchAndUnknown.result, "unknown");
});

test("missingFields are deduplicated and sorted across and/or composition", () => {
  const result = evaluateCondition(
    {
      op: "and",
      conditions: [
        { op: "eq", field: "z", value: 1 },
        {
          op: "or",
          conditions: [
            { op: "eq", field: "a", value: 1 },
            { op: "eq", field: "z", value: 1 },
          ],
        },
      ],
    },
    {},
  );
  assert.deepEqual(result.missingFields, ["a", "z"]);
});

test("dedupeSorted removes duplicates and sorts", () => {
  assert.deepEqual(dedupeSorted(["b", "a", "b", "a", "c"]), ["a", "b", "c"]);
});

// =======================================================================
// Structural (zod) parsing
// =======================================================================

test("ruleConditionSchema accepts every operator shape", () => {
  const samples: RuleCondition[] = [
    { op: "exists", field: "x" },
    { op: "eq", field: "x", value: "a" },
    { op: "in", field: "x", values: ["a", "b"] },
    { op: "gte", field: "x", value: 1 },
    { op: "includesAny", field: "x", values: ["a"] },
    { op: "and", conditions: [{ op: "exists", field: "x" }] },
    { op: "or", conditions: [{ op: "exists", field: "x" }] },
    { op: "not", condition: { op: "exists", field: "x" } },
  ];
  for (const sample of samples) {
    assert.deepEqual(ruleConditionSchema.parse(sample), sample);
  }
});

test("ruleConditionSchema rejects an unknown operator and extra keys", () => {
  assert.throws(() =>
    ruleConditionSchema.parse({ op: "gt", field: "x", value: 1 }),
  );
  assert.throws(() =>
    ruleConditionSchema.parse({ op: "exists", field: "x", extra: true }),
  );
});

test("ruleConditionSchema enforces bounded collection size on in/includesAny/and/or", () => {
  const tooManyValues = Array.from({ length: 9 }, (_, i) => `v${i}`);
  assert.throws(() =>
    ruleConditionSchema.parse({ op: "in", field: "x", values: tooManyValues }),
  );
  assert.throws(() =>
    ruleConditionSchema.parse({
      op: "includesAny",
      field: "x",
      values: tooManyValues,
    }),
  );
  const tooManyConditions = Array.from({ length: 9 }, () => ({
    op: "exists" as const,
    field: "x",
  }));
  assert.throws(() =>
    ruleConditionSchema.parse({ op: "and", conditions: tooManyConditions }),
  );
});

// =======================================================================
// Depth bound
// =======================================================================

function nestedNot(depth: number): RuleCondition {
  let condition: RuleCondition = { op: "exists", field: "company.name" };
  for (let i = 0; i < depth - 1; i++) {
    condition = { op: "not", condition };
  }
  return condition;
}

test("conditionDepth counts leaf as depth 1 and each not/and/or wrapper adds 1", () => {
  assert.equal(conditionDepth({ op: "exists", field: "x" }), 1);
  assert.equal(
    conditionDepth({ op: "not", condition: { op: "exists", field: "x" } }),
    2,
  );
  assert.equal(
    conditionDepth({
      op: "and",
      conditions: [
        { op: "exists", field: "x" },
        { op: "not", condition: { op: "exists", field: "y" } },
      ],
    }),
    3,
  );
});

test("validateConditionAgainstAllowlist accepts a condition at exactly MAX_CONDITION_DEPTH", () => {
  const atLimit = nestedNot(MAX_CONDITION_DEPTH);
  assert.equal(conditionDepth(atLimit), MAX_CONDITION_DEPTH);
  assert.doesNotThrow(() =>
    validateConditionAgainstAllowlist(atLimit, ALLOWLIST, "test"),
  );
});

test("validateConditionAgainstAllowlist rejects a condition exceeding MAX_CONDITION_DEPTH", () => {
  const overLimit = nestedNot(MAX_CONDITION_DEPTH + 1);
  assert.throws(
    () => validateConditionAgainstAllowlist(overLimit, ALLOWLIST, "test"),
    ConditionValidationError,
  );
});

// =======================================================================
// Allowlist / operator-type compatibility
// =======================================================================

test("validateConditionAgainstAllowlist rejects a field not in the allowlist", () => {
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "exists", field: "consent.email" },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
});

test("validateConditionAgainstAllowlist rejects gte against a non-number field", () => {
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "gte", field: "company.name", value: 1 },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
});

test("validateConditionAgainstAllowlist rejects includesAny against a non-array field", () => {
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "includesAny", field: "company.name", values: ["a"] },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
});

test("validateConditionAgainstAllowlist rejects eq/in against a stringArray field", () => {
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "eq", field: "engagement.sources", value: "rb2b" },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "in", field: "engagement.sources", values: ["rb2b"] },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
});

// --- exact value-type-vs-field-type matching -----------------------------

test("boolean field compared with a string value (eq) is rejected", () => {
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "eq", field: "crm.competitorFlag", value: "true" },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
});

test("number field compared with a string value (eq) is rejected", () => {
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "eq", field: "company.employeeCount", value: "200" },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
});

test("mixed-type `in` values are rejected", () => {
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "in", field: "company.name", values: ["Acme", 42] },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        { op: "in", field: "crm.competitorFlag", values: [true, "false"] },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
});

test("correctly typed scalar comparisons (eq/in) are accepted for string, number, and boolean fields", () => {
  assert.doesNotThrow(() =>
    validateConditionAgainstAllowlist(
      { op: "eq", field: "company.name", value: "Acme" },
      ALLOWLIST,
      "test",
    ),
  );
  assert.doesNotThrow(() =>
    validateConditionAgainstAllowlist(
      { op: "in", field: "company.name", values: ["Acme", "Globex"] },
      ALLOWLIST,
      "test",
    ),
  );
  assert.doesNotThrow(() =>
    validateConditionAgainstAllowlist(
      { op: "eq", field: "company.employeeCount", value: 250 },
      ALLOWLIST,
      "test",
    ),
  );
  assert.doesNotThrow(() =>
    validateConditionAgainstAllowlist(
      { op: "in", field: "company.employeeCount", values: [100, 250, 500] },
      ALLOWLIST,
      "test",
    ),
  );
  assert.doesNotThrow(() =>
    validateConditionAgainstAllowlist(
      { op: "eq", field: "crm.competitorFlag", value: true },
      ALLOWLIST,
      "test",
    ),
  );
  assert.doesNotThrow(() =>
    validateConditionAgainstAllowlist(
      { op: "in", field: "crm.competitorFlag", values: [true, false] },
      ALLOWLIST,
      "test",
    ),
  );
});

test("number field compared with a non-finite number is rejected", () => {
  assert.throws(
    () =>
      validateConditionAgainstAllowlist(
        {
          op: "eq",
          field: "company.employeeCount",
          value: Number.POSITIVE_INFINITY,
        },
        ALLOWLIST,
        "test",
      ),
    ConditionValidationError,
  );
});

test("validateConditionAgainstAllowlist recurses into and/or/not to validate every leaf", () => {
  const nested: RuleCondition = {
    op: "and",
    conditions: [
      { op: "exists", field: "company.name" },
      {
        op: "or",
        conditions: [{ op: "eq", field: "consent.email", value: "true" }],
      },
    ],
  };
  assert.throws(
    () => validateConditionAgainstAllowlist(nested, ALLOWLIST, "test"),
    ConditionValidationError,
  );
});
