// Run with: tsx --test src/configClassification.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { isIntentConfigured } from "./configClassification.js";
import type { IcpProfileConfigV1, WeightedRule } from "./profileConfig.js";

function weightedRule(overrides: Partial<WeightedRule> = {}): WeightedRule {
  return {
    id: "rule_1",
    description: "test rule",
    points: 10,
    condition: { op: "exists", field: "engagement.sources" },
    ...overrides,
  };
}

function configWithIntentRules(rules: WeightedRule[]): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules, tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

test("isIntentConfigured is false when intent.rules is empty", () => {
  assert.equal(isIntentConfigured(configWithIntentRules([])), false);
});

test("isIntentConfigured is true when intent.rules has at least one rule", () => {
  assert.equal(isIntentConfigured(configWithIntentRules([weightedRule()])), true);
});
