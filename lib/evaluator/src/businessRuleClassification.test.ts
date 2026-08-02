// Run with: tsx --test src/businessRuleClassification.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  WEIGHT_PRESET_VALUES,
  WEIGHT_PRESET_ORDER,
  weightPresetForPoints,
  isSimpleFitRule,
  isSimpleIntentRule,
  isSimpleActionabilityRule,
  isSimpleEligibilityRule,
} from "./businessRuleClassification.js";
import type { ConditionRule, WeightedRule } from "./profileConfig.js";

function weightedRule(overrides: Partial<WeightedRule> = {}): WeightedRule {
  return {
    id: "rule_1",
    description: "test rule",
    points: WEIGHT_PRESET_VALUES.supporting,
    condition: { op: "eq", field: "company.industry", value: "Banking" },
    ...overrides,
  };
}

function conditionRule(overrides: Partial<ConditionRule> = {}): ConditionRule {
  return {
    id: "rule_1",
    description: "test rule",
    condition: { op: "eq", field: "doNotContact", value: true },
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Weight presets
// ---------------------------------------------------------------------

test("WEIGHT_PRESET_VALUES documents exactly the three business preset weights", () => {
  assert.deepEqual(WEIGHT_PRESET_VALUES, { supporting: 5, important: 15, critical: 30 });
  assert.deepEqual(WEIGHT_PRESET_ORDER, ["supporting", "important", "critical"]);
});

test("weightPresetForPoints maps a preset's exact documented value back to its key, and reports no match for a custom value", () => {
  assert.equal(weightPresetForPoints(WEIGHT_PRESET_VALUES.supporting), "supporting");
  assert.equal(weightPresetForPoints(WEIGHT_PRESET_VALUES.important), "important");
  assert.equal(weightPresetForPoints(WEIGHT_PRESET_VALUES.critical), "critical");
  assert.equal(weightPresetForPoints(10), null);
});

// ---------------------------------------------------------------------
// isSimpleFitRule
// ---------------------------------------------------------------------

test("isSimpleFitRule is true for a preset-weighted eq on a meaningful company field", () => {
  assert.equal(
    isSimpleFitRule(weightedRule({ condition: { op: "eq", field: "company.industry", value: "Banking" } })),
    true,
  );
});

test("isSimpleFitRule is true for a preset-weighted in on a meaningful company field", () => {
  assert.equal(
    isSimpleFitRule(
      weightedRule({ condition: { op: "in", field: "company.region", values: ["EMEA", "NA"] } }),
    ),
    true,
  );
});

test("isSimpleFitRule is true for a preset-weighted eq with a still-blank value — shape only, so a freshly added business row keeps rendering as editable, not 'Advanced', while the author is still typing", () => {
  assert.equal(
    isSimpleFitRule(weightedRule({ condition: { op: "eq", field: "company.industry", value: "" } })),
    true,
  );
});

test("isSimpleFitRule is false for an exists condition, even at a preset weight", () => {
  assert.equal(
    isSimpleFitRule(weightedRule({ condition: { op: "exists", field: "company.domain" } })),
    false,
  );
});

test("isSimpleFitRule is false for a top-level AND condition", () => {
  assert.equal(
    isSimpleFitRule(
      weightedRule({
        condition: {
          op: "and",
          conditions: [{ op: "eq", field: "company.industry", value: "Banking" }],
        },
      }),
    ),
    false,
  );
});

test("isSimpleFitRule is false for a top-level OR condition", () => {
  assert.equal(
    isSimpleFitRule(
      weightedRule({
        condition: {
          op: "or",
          conditions: [{ op: "eq", field: "company.industry", value: "Banking" }],
        },
      }),
    ),
    false,
  );
});

test("isSimpleFitRule is false for a top-level NOT condition", () => {
  assert.equal(
    isSimpleFitRule(
      weightedRule({
        condition: { op: "not", condition: { op: "eq", field: "company.industry", value: "Banking" } },
      }),
    ),
    false,
  );
});

test("isSimpleFitRule is false for a custom (non-preset) points value", () => {
  assert.equal(
    isSimpleFitRule(
      weightedRule({ points: 7, condition: { op: "eq", field: "company.industry", value: "Banking" } }),
    ),
    false,
  );
});

test("isSimpleFitRule is false for a structurally valid eq condition on a field outside the seven meaningful fit fields (e.g. an eligibility/CRM field)", () => {
  // crm.existingCustomer is a real, schema-legal RuleCondition field for
  // ELIGIBILITY rules, not fit — this exercises isSimpleFitRule's own
  // "is this field one of the seven meaningful company fields" check,
  // independent of whether a real profile would ever place this
  // condition inside a fit rule at all.
  assert.equal(
    isSimpleFitRule(
      weightedRule({ condition: { op: "eq", field: "crm.existingCustomer", value: true } }),
    ),
    false,
  );
});

// ---------------------------------------------------------------------
// isSimpleIntentRule
// ---------------------------------------------------------------------

test("isSimpleIntentRule is true for includesAny on engagement.sources", () => {
  assert.equal(
    isSimpleIntentRule(
      weightedRule({ condition: { op: "includesAny", field: "engagement.sources", values: ["ads"] } }),
    ),
    true,
  );
});

test("isSimpleIntentRule is true for includesAny on engagement.pagesVisited", () => {
  assert.equal(
    isSimpleIntentRule(
      weightedRule({
        condition: { op: "includesAny", field: "engagement.pagesVisited", values: ["/pricing"] },
      }),
    ),
    true,
  );
});

test("isSimpleIntentRule is true for gte on engagement.distinctSourceCount", () => {
  assert.equal(
    isSimpleIntentRule(
      weightedRule({ condition: { op: "gte", field: "engagement.distinctSourceCount", value: 3 } }),
    ),
    true,
  );
});

test("isSimpleIntentRule is true for eq on engagement.repeatVisit with a boolean value", () => {
  assert.equal(
    isSimpleIntentRule(
      weightedRule({ condition: { op: "eq", field: "engagement.repeatVisit", value: true } }),
    ),
    true,
  );
});

test("isSimpleIntentRule is false for eq on engagement.repeatVisit with a non-boolean value — defensive runtime coverage for a shape real profile schema validation (field-type checking) would normally reject before this classifier ever sees it", () => {
  const rule = weightedRule({ condition: { op: "eq", field: "engagement.repeatVisit", value: "true" } });
  assert.equal(isSimpleIntentRule(rule), false);
});

test("isSimpleIntentRule is false for any condition on engagement.lastSeenAt, regardless of operator", () => {
  assert.equal(
    isSimpleIntentRule(weightedRule({ condition: { op: "exists", field: "engagement.lastSeenAt" } })),
    false,
  );
  assert.equal(
    isSimpleIntentRule(
      weightedRule({ condition: { op: "eq", field: "engagement.lastSeenAt", value: "2026-01-01" } }),
    ),
    false,
  );
});

test("isSimpleIntentRule is false for an unsupported shape on an otherwise-supported field (exists on engagement.sources, not includesAny)", () => {
  assert.equal(
    isSimpleIntentRule(weightedRule({ condition: { op: "exists", field: "engagement.sources" } })),
    false,
  );
});

test("isSimpleIntentRule is false for a compound condition", () => {
  assert.equal(
    isSimpleIntentRule(
      weightedRule({
        condition: {
          op: "or",
          conditions: [{ op: "includesAny", field: "engagement.sources", values: ["ads"] }],
        },
      }),
    ),
    false,
  );
});

test("isSimpleIntentRule is false for a custom (non-preset) points value", () => {
  assert.equal(
    isSimpleIntentRule(
      weightedRule({
        points: 7,
        condition: { op: "includesAny", field: "engagement.sources", values: ["ads"] },
      }),
    ),
    false,
  );
});

// ---------------------------------------------------------------------
// isSimpleActionabilityRule / isSimpleEligibilityRule — always false
// this release, regardless of how simple the rule looks.
// ---------------------------------------------------------------------

test("isSimpleActionabilityRule is always false in this release, even for a preset-weighted leaf condition", () => {
  assert.equal(
    isSimpleActionabilityRule(
      weightedRule({ condition: { op: "exists", field: "contact.email" } }),
    ),
    false,
  );
});

test("isSimpleEligibilityRule is always false in this release, even for a simple leaf condition", () => {
  assert.equal(
    isSimpleEligibilityRule(conditionRule({ condition: { op: "eq", field: "doNotContact", value: true } })),
    false,
  );
});
