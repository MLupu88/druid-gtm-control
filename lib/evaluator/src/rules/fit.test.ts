// Unit tests for fit scoring: additive rule matching, tier boundaries,
// and unknown-condition handling.
//
// Run with: tsx --test lib/evaluator/src/rules/fit.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFit } from "./fit.js";
import type { FitConfig } from "../profileConfig.js";

const CONFIG: FitConfig = {
  rules: [
    {
      id: "has_domain",
      description: "Has a company domain",
      points: 10,
      condition: { op: "exists", field: "company.domain" },
    },
    {
      id: "target_industry",
      description: "Industry is Insurance",
      points: 20,
      condition: { op: "eq", field: "company.industry", value: "Insurance" },
    },
  ],
  tiers: [
    { code: "low", minScore: 0 },
    { code: "mid", minScore: 10 },
    { code: "high", minScore: 30 },
  ],
};

test("sums points only for matched rules", () => {
  const result = evaluateFit(CONFIG, {
    company: { domain: "acme.com", industry: "Insurance" },
  });
  assert.equal(result.score, 30);
  assert.equal(result.scoreComponents.length, 2);
  assert.equal(result.matchedRules.length, 2);
});

test("no rules match => score 0, floor tier", () => {
  const result = evaluateFit(CONFIG, {
    company: { domain: null, industry: "Retail" },
  });
  assert.equal(result.score, 0);
  assert.equal(result.tier, "low");
  assert.deepEqual(result.scoreComponents, []);
});

test("an unknown condition contributes zero points and records a missing input, not a guess", () => {
  const result = evaluateFit(CONFIG, { company: {} });
  assert.equal(result.score, 0);
  assert.equal(result.scoreComponents.length, 0);
  const fields = result.missingInputs.map((m) => m.field);
  assert.ok(fields.includes("company.industry"));
  for (const entry of result.missingInputs) {
    assert.deepEqual(entry.affects, ["fit"]);
  }
});

test("tier boundary is inclusive at exactly minScore, exclusive one below", () => {
  const atBoundary = evaluateFit(CONFIG, {
    company: { domain: "acme.com", industry: "Retail" },
  }); // score 10
  assert.equal(atBoundary.score, 10);
  assert.equal(atBoundary.tier, "mid");

  const belowBoundary = evaluateFit(
    { ...CONFIG, rules: [{ ...CONFIG.rules[0]!, points: 9 }] },
    { company: { domain: "acme.com" } },
  );
  assert.equal(belowBoundary.score, 9);
  assert.equal(belowBoundary.tier, "low");
});

test("matched rules preserve config declaration order", () => {
  const result = evaluateFit(CONFIG, {
    company: { domain: "acme.com", industry: "Insurance" },
  });
  assert.deepEqual(
    result.matchedRules.map((r) => r.ruleId),
    ["has_domain", "target_industry"],
  );
});
