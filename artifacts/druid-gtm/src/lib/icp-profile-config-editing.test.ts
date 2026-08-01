// Tests for ./icp-profile-config-editing.ts — pure editing helpers behind
// the ICP draft editor. No DOM needed.
//
// Run with: tsx --test src/lib/icp-profile-config-editing.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { IcpProfileConfigV1Schema, FIT_FIELD_ALLOWLIST } from "@workspace/evaluator";
import {
  generateRuleId,
  buildStarterProfileConfig,
  defaultLeafCondition,
  newWeightedRule,
  duplicateWeightedRule,
  newConditionRule,
  duplicateConditionRule,
  newTier,
  replaceItemAt,
  removeItemAt,
  moveItem,
  isGroupCondition,
  isNotCondition,
  addConditionChild,
  replaceConditionChildAt,
  removeConditionChildAt,
} from "./icp-profile-config-editing.js";

// ---------------------------------------------------------------------
// generateRuleId
// ---------------------------------------------------------------------

const RULE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

test("generateRuleId produces an id matching RuleIdSchema's identifier pattern", () => {
  const id = generateRuleId("rule");
  assert.match(id, RULE_ID_PATTERN);
  assert.ok(id.length <= 64);
  assert.ok(id.startsWith("rule_"));
});

test("generateRuleId respects the requested prefix", () => {
  assert.ok(generateRuleId("hard_disqualifier").startsWith("hard_disqualifier_"));
  assert.ok(generateRuleId("restriction").startsWith("restriction_"));
});

test("generateRuleId never produces the same id twice in practice", () => {
  const ids = new Set(Array.from({ length: 20 }, () => generateRuleId()));
  assert.equal(ids.size, 20);
});

// ---------------------------------------------------------------------
// buildStarterProfileConfig
// ---------------------------------------------------------------------

test("buildStarterProfileConfig produces a config that passes the real canonical schema", () => {
  const config = buildStarterProfileConfig();
  const parsed = IcpProfileConfigV1Schema.safeParse(config);
  assert.equal(parsed.success, true);
});

test("buildStarterProfileConfig never invents rules — every rule collection starts empty", () => {
  const config = buildStarterProfileConfig();
  assert.deepEqual(config.fit.rules, []);
  assert.deepEqual(config.intent.rules, []);
  assert.deepEqual(config.actionability.rules, []);
  assert.deepEqual(config.eligibility.hardDisqualifiers, []);
  assert.deepEqual(config.eligibility.restrictions, []);
});

test("buildStarterProfileConfig includes exactly the required floor tier for fit and intent", () => {
  const config = buildStarterProfileConfig();
  assert.equal(config.fit.tiers.length, 1);
  assert.equal(config.fit.tiers[0]?.minScore, 0);
  assert.equal(config.intent.tiers.length, 1);
  assert.equal(config.intent.tiers[0]?.minScore, 0);
});

// ---------------------------------------------------------------------
// defaultLeafCondition / newWeightedRule / newConditionRule
// ---------------------------------------------------------------------

test("defaultLeafCondition is an 'exists' check against the first allowed field — never a guessed comparison value", () => {
  const condition = defaultLeafCondition(FIT_FIELD_ALLOWLIST);
  assert.equal(condition.op, "exists");
  assert.equal(condition.field, Object.keys(FIT_FIELD_ALLOWLIST)[0]);
});

test("newWeightedRule starts at 0 points with an empty description and a valid id", () => {
  const rule = newWeightedRule(FIT_FIELD_ALLOWLIST);
  assert.equal(rule.points, 0);
  assert.equal(rule.description, "");
  assert.match(rule.id, RULE_ID_PATTERN);
});

test("duplicateWeightedRule preserves every field except id, which gets a fresh one", () => {
  const original = newWeightedRule(FIT_FIELD_ALLOWLIST);
  const edited = { ...original, description: "Has a domain", points: 10 };
  const duplicate = duplicateWeightedRule(edited);
  assert.notEqual(duplicate.id, edited.id);
  assert.equal(duplicate.description, edited.description);
  assert.equal(duplicate.points, edited.points);
  assert.deepEqual(duplicate.condition, edited.condition);
});

test("newConditionRule (eligibility) has no points field at all", () => {
  const rule = newConditionRule(FIT_FIELD_ALLOWLIST, "hard_disqualifier");
  assert.ok(!("points" in rule));
  assert.match(rule.id, RULE_ID_PATTERN);
});

test("duplicateConditionRule preserves description/condition and mints a fresh id", () => {
  const original = newConditionRule(FIT_FIELD_ALLOWLIST, "restriction");
  const edited = { ...original, description: "EU-only restriction" };
  const duplicate = duplicateConditionRule(edited, "restriction");
  assert.notEqual(duplicate.id, edited.id);
  assert.equal(duplicate.description, edited.description);
});

// ---------------------------------------------------------------------
// newTier
// ---------------------------------------------------------------------

test("newTier leaves code blank for the author to name, unlike rule ids", () => {
  const tier = newTier();
  assert.equal(tier.code, "");
  assert.equal(tier.minScore, 0);
});

// ---------------------------------------------------------------------
// Generic array helpers
// ---------------------------------------------------------------------

test("replaceItemAt replaces only the targeted index, leaving the rest untouched", () => {
  const result = replaceItemAt([1, 2, 3], 1, 99);
  assert.deepEqual(result, [1, 99, 3]);
});

test("removeItemAt removes only the targeted index", () => {
  const result = removeItemAt(["a", "b", "c"], 0);
  assert.deepEqual(result, ["b", "c"]);
});

test("moveItem swaps with the next item when moving forward", () => {
  const result = moveItem(["a", "b", "c"], 0, 1);
  assert.deepEqual(result, ["b", "a", "c"]);
});

test("moveItem swaps with the previous item when moving backward", () => {
  const result = moveItem(["a", "b", "c"], 2, -1);
  assert.deepEqual(result, ["a", "c", "b"]);
});

test("moveItem is a no-op at either boundary", () => {
  assert.deepEqual(moveItem(["a", "b"], 0, -1), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 1, 1), ["a", "b"]);
});

// ---------------------------------------------------------------------
// Condition-tree editing
// ---------------------------------------------------------------------

test("isGroupCondition/isNotCondition correctly discriminate and/or/not from leaf conditions", () => {
  assert.equal(isGroupCondition({ op: "and", conditions: [] }), true);
  assert.equal(isGroupCondition({ op: "or", conditions: [] }), true);
  assert.equal(isGroupCondition({ op: "not", condition: { op: "exists", field: "x" } }), false);
  assert.equal(isGroupCondition({ op: "exists", field: "x" }), false);
  assert.equal(isNotCondition({ op: "not", condition: { op: "exists", field: "x" } }), true);
  assert.equal(isNotCondition({ op: "and", conditions: [] }), false);
});

test("addConditionChild appends without mutating the original group", () => {
  const group = { op: "and" as const, conditions: [{ op: "exists" as const, field: "a" }] };
  const updated = addConditionChild(group, { op: "exists", field: "b" });
  assert.equal(group.conditions.length, 1);
  assert.equal(updated.conditions.length, 2);
  assert.equal(updated.conditions[1]?.op, "exists");
});

test("replaceConditionChildAt replaces exactly the targeted child", () => {
  const group = {
    op: "or" as const,
    conditions: [
      { op: "exists" as const, field: "a" },
      { op: "exists" as const, field: "b" },
    ],
  };
  const updated = replaceConditionChildAt(group, 1, { op: "gte", field: "c", value: 5 });
  assert.deepEqual(updated.conditions[0], { op: "exists", field: "a" });
  assert.deepEqual(updated.conditions[1], { op: "gte", field: "c", value: 5 });
});

test("removeConditionChildAt removes exactly the targeted child", () => {
  const group = {
    op: "and" as const,
    conditions: [
      { op: "exists" as const, field: "a" },
      { op: "exists" as const, field: "b" },
    ],
  };
  const updated = removeConditionChildAt(group, 0);
  assert.equal(updated.conditions.length, 1);
  assert.equal(updated.conditions[0]?.field, "b");
});
