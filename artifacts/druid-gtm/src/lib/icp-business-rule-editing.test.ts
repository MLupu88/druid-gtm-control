// Tests for ./icp-business-rule-editing.ts — pure array-editing helpers
// behind the ICP draft editor's Business view. No DOM needed (this
// package has no jsdom/testing-library — see ./accounts-api.limit.test.ts).
//
// Run with: tsx --test src/lib/icp-business-rule-editing.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IcpProfileConfigV1Schema,
  isSimpleFitRule,
  isSimpleIntentRule,
} from "@workspace/evaluator";
import type { WeightedRule } from "@workspace/evaluator";
import {
  partitionRules,
  updateRuleById,
  removeRuleById,
  duplicateRuleAfterId,
  duplicateSimpleRule,
  appendRule,
  newSimpleFitRule,
  newSimpleIntentRule,
} from "./icp-business-rule-editing.js";

function weightedRule(overrides: Partial<WeightedRule> = {}): WeightedRule {
  return {
    id: "rule_1",
    description: "test rule",
    points: 5,
    condition: { op: "eq", field: "company.industry", value: "Banking" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// partitionRules
// ---------------------------------------------------------------------

test("partitionRules splits into simple/advanced, preserving each partition's original order", () => {
  const simpleA = weightedRule({ id: "a" });
  const advancedB = weightedRule({
    id: "b",
    condition: { op: "exists", field: "company.domain" },
  });
  const simpleC = weightedRule({ id: "c" });

  const { simple, advanced } = partitionRules([simpleA, advancedB, simpleC], isSimpleFitRule);

  assert.deepEqual(
    simple.map((r) => r.id),
    ["a", "c"],
  );
  assert.deepEqual(
    advanced.map((r) => r.id),
    ["b"],
  );
});

test("partitionRules places every rule in exactly one partition — total count is preserved", () => {
  const rules = [
    weightedRule({ id: "a" }),
    weightedRule({ id: "b", condition: { op: "exists", field: "company.domain" } }),
  ];
  const { simple, advanced } = partitionRules(rules, isSimpleFitRule);
  assert.equal(simple.length + advanced.length, rules.length);
});

// ---------------------------------------------------------------------
// updateRuleById
// ---------------------------------------------------------------------

test("updateRuleById replaces only the matching rule, leaving every other rule untouched (including advanced ones)", () => {
  const advanced = weightedRule({
    id: "advanced-1",
    condition: { op: "exists", field: "company.domain" },
  });
  const target = weightedRule({ id: "target-1" });
  const updated = weightedRule({ id: "target-1", description: "renamed" });

  const result = updateRuleById([advanced, target], "target-1", updated);

  assert.equal(result.length, 2);
  assert.equal(result[0], advanced);
  assert.equal(result[1], updated);
});

test("updateRuleById throws when the replacement's id does not match the target id, rather than silently changing identity", () => {
  const rules = [weightedRule({ id: "target-1" })];
  assert.throws(() => {
    updateRuleById(rules, "target-1", weightedRule({ id: "different-id" }));
  }, /does not match/);
});

// ---------------------------------------------------------------------
// removeRuleById
// ---------------------------------------------------------------------

test("removeRuleById removes only the matching rule, preserving every other rule (including advanced ones)", () => {
  const advanced = weightedRule({
    id: "advanced-1",
    condition: { op: "exists", field: "company.domain" },
  });
  const target = weightedRule({ id: "target-1" });

  const result = removeRuleById([advanced, target], "target-1");

  assert.deepEqual(result, [advanced]);
});

test("removeRuleById is a no-op when the id doesn't exist", () => {
  const rules = [weightedRule({ id: "a" })];
  assert.deepEqual(removeRuleById(rules, "missing"), rules);
});

// ---------------------------------------------------------------------
// duplicateRuleAfterId
// ---------------------------------------------------------------------

test("duplicateRuleAfterId inserts the duplicate immediately after the source rule", () => {
  const a = weightedRule({ id: "a" });
  const b = weightedRule({ id: "b" });
  const duplicateOfA = weightedRule({ id: "a-copy" });

  const result = duplicateRuleAfterId([a, b], "a", duplicateOfA);

  assert.deepEqual(
    result.map((r) => r.id),
    ["a", "a-copy", "b"],
  );
});

test("duplicateRuleAfterId returns the array unchanged (never a silent append) when the source id doesn't exist", () => {
  const rules = [weightedRule({ id: "a" })];
  const duplicate = weightedRule({ id: "orphan-copy" });

  const result = duplicateRuleAfterId(rules, "missing-source", duplicate);

  assert.deepEqual(result, rules);
  assert.equal(result.length, 1);
});

// ---------------------------------------------------------------------
// duplicateSimpleRule
// ---------------------------------------------------------------------

test("duplicateSimpleRule assigns a fresh id, different from the source rule's", () => {
  const source = weightedRule({ id: "source-1" });
  const duplicate = duplicateSimpleRule(source);
  assert.notEqual(duplicate.id, source.id);
});

test("duplicateSimpleRule's condition deep-equals the source's but is not the same object reference", () => {
  const source = weightedRule({
    condition: { op: "in", field: "company.industry", values: ["Banking", "Insurance"] },
  });
  const duplicate = duplicateSimpleRule(source);

  assert.deepEqual(duplicate.condition, source.condition);
  assert.notEqual(duplicate.condition, source.condition);
});

test("duplicateSimpleRule preserves description and points unchanged", () => {
  const source = weightedRule({ description: "Targets Banking", points: 15 });
  const duplicate = duplicateSimpleRule(source);
  assert.equal(duplicate.description, "Targets Banking");
  assert.equal(duplicate.points, 15);
});

test("duplicateSimpleRule produces a rule that remains valid under IcpProfileConfigV1Schema", () => {
  const source = weightedRule({
    condition: { op: "eq", field: "company.industry", value: "Banking" },
  });
  const duplicate = duplicateSimpleRule(source);
  const config = {
    configSchemaVersion: "v1" as const,
    fit: { rules: [source, duplicate], tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
  assert.equal(IcpProfileConfigV1Schema.safeParse(config).success, true);
});

// ---------------------------------------------------------------------
// appendRule
// ---------------------------------------------------------------------

test("appendRule adds to the end without touching existing rules", () => {
  const existing = [weightedRule({ id: "a" })];
  const added = weightedRule({ id: "b" });
  assert.deepEqual(appendRule(existing, added), [existing[0], added]);
});

// ---------------------------------------------------------------------
// newSimpleFitRule / newSimpleIntentRule
// ---------------------------------------------------------------------

test("newSimpleFitRule produces a rule that passes isSimpleFitRule (renders as an editable business row, not Advanced)", () => {
  assert.equal(isSimpleFitRule(newSimpleFitRule()), true);
});

test("newSimpleIntentRule produces a rule that passes isSimpleIntentRule (renders as an editable business row, not Advanced)", () => {
  assert.equal(isSimpleIntentRule(newSimpleIntentRule()), true);
});

test("newSimpleFitRule and newSimpleIntentRule each produce a schema-valid WeightedRule shape on their own", () => {
  // Only the rule shape itself, embedded in an otherwise-minimal valid
  // config, to confirm neither constructor produces something the real
  // schema would reject.
  const configWithFit = {
    configSchemaVersion: "v1" as const,
    fit: { rules: [newSimpleFitRule()], tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
  assert.equal(IcpProfileConfigV1Schema.safeParse(configWithFit).success, true);

  const configWithIntent = {
    configSchemaVersion: "v1" as const,
    fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules: [newSimpleIntentRule()], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
  assert.equal(IcpProfileConfigV1Schema.safeParse(configWithIntent).success, true);
});

test("newSimpleFitRule generates a fresh, valid rule id on every call", () => {
  const a = newSimpleFitRule();
  const b = newSimpleFitRule();
  assert.notEqual(a.id, b.id);
});
