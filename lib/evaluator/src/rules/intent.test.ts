// Unit tests for intent scoring — same mechanism as fit, exercised
// against engagement-shaped fields to confirm the dimension label is
// correctly threaded through (not just reusing fit's fixtures).
//
// Run with: tsx --test lib/evaluator/src/rules/intent.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIntent } from "./intent.js";
import type { IntentConfig } from "../profileConfig.js";

const CONFIG: IntentConfig = {
  rules: [
    {
      id: "repeat_visitor",
      description: "Repeat visitor",
      points: 5,
      condition: { op: "eq", field: "engagement.repeatVisit", value: true },
    },
    {
      id: "multi_source",
      description: "3+ distinct sources",
      points: 15,
      condition: {
        op: "gte",
        field: "engagement.distinctSourceCount",
        value: 3,
      },
    },
  ],
  tiers: [
    { code: "cold", minScore: 0 },
    { code: "warm", minScore: 5 },
    { code: "hot", minScore: 20 },
  ],
};

test("sums points only for matched rules and tags missing inputs with the intent dimension", () => {
  const result = evaluateIntent(CONFIG, { engagement: { repeatVisit: true } });
  assert.equal(result.score, 5);
  assert.equal(result.tier, "warm");
  const missing = result.missingInputs.find(
    (m) => m.field === "engagement.distinctSourceCount",
  );
  assert.ok(missing);
  assert.deepEqual(missing!.affects, ["intent"]);
});

test("gte boundary is inclusive (rule condition threshold of 3, not a tier threshold)", () => {
  const result = evaluateIntent(CONFIG, {
    engagement: { repeatVisit: false, distinctSourceCount: 3 },
  });
  assert.equal(result.score, 15);
  assert.equal(result.tier, "warm");
});

test("all rules matched sums to the top tier", () => {
  const result = evaluateIntent(CONFIG, {
    engagement: { repeatVisit: true, distinctSourceCount: 5 },
  });
  assert.equal(result.score, 20);
  assert.equal(result.tier, "hot");
});

test("score components carry the intent dimension label", () => {
  const result = evaluateIntent(CONFIG, {
    engagement: { repeatVisit: true, distinctSourceCount: 5 },
  });
  for (const component of result.scoreComponents) {
    assert.equal(component.dimension, "intent");
  }
  for (const rule of result.matchedRules) {
    assert.equal(rule.dimension, "intent");
  }
});
