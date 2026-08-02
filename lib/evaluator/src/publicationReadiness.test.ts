// Unit tests for evaluatePublicationReadiness/isMeaningfulFitRule — the
// shared classification of whether an IcpProfileConfigV1 has enough
// meaningful Target company (fit) criteria to publish. Consumed by both
// the API server's server-authoritative publishDraft() gate and the
// frontend's pre-publish readiness display, so this module (not either
// caller) is the single source of truth for what "meaningful" means.
//
// Run with: tsx --test src/publicationReadiness.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePublicationReadiness,
  isMeaningfulFitRule,
  isMeaningfulFitLeaf,
  isSupportedFitCriterionLeaf,
} from "./publicationReadiness.js";
import type { IcpProfileConfigV1, WeightedRule } from "./profileConfig.js";

function weightedRule(overrides: Partial<WeightedRule> = {}): WeightedRule {
  return {
    id: "rule_1",
    description: "test rule",
    points: 10,
    condition: { op: "exists", field: "company.domain" },
    ...overrides,
  };
}

function baseConfig(fitRules: WeightedRule[]): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: { rules: fitRules, tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

// ---------------------------------------------------------------------
// isMeaningfulFitRule
// ---------------------------------------------------------------------

test("isMeaningfulFitRule is false for an exists check on company.domain", () => {
  const rule = weightedRule({ condition: { op: "exists", field: "company.domain" } });
  assert.equal(isMeaningfulFitRule(rule), false);
});

test("isMeaningfulFitRule is false for an exists check on company.name", () => {
  const rule = weightedRule({ condition: { op: "exists", field: "company.name" } });
  assert.equal(isMeaningfulFitRule(rule), false);
});

test("isMeaningfulFitRule is false for an exists check on company.industry", () => {
  const rule = weightedRule({ condition: { op: "exists", field: "company.industry" } });
  assert.equal(isMeaningfulFitRule(rule), false);
});

test("isMeaningfulFitRule is false for an exists check on company.country", () => {
  const rule = weightedRule({ condition: { op: "exists", field: "company.country" } });
  assert.equal(isMeaningfulFitRule(rule), false);
});

test("isMeaningfulFitRule is true for an eq match on company.domain", () => {
  const rule = weightedRule({
    condition: { op: "eq", field: "company.domain", value: "acme.com" },
  });
  assert.equal(isMeaningfulFitRule(rule), true);
});

test("isMeaningfulFitRule is true for an in match on company.industry", () => {
  const rule = weightedRule({
    condition: { op: "in", field: "company.industry", values: ["Banking", "Insurance"] },
  });
  assert.equal(isMeaningfulFitRule(rule), true);
});

test("isMeaningfulFitRule is true for an eq match on company.employeeRange", () => {
  const rule = weightedRule({
    condition: { op: "eq", field: "company.employeeRange", value: "51-200" },
  });
  assert.equal(isMeaningfulFitRule(rule), true);
});

test("isMeaningfulFitRule is false when points is 0, even with an otherwise-meaningful condition", () => {
  const rule = weightedRule({
    points: 0,
    condition: { op: "eq", field: "company.industry", value: "Banking" },
  });
  assert.equal(isMeaningfulFitRule(rule), false);
});

test("isMeaningfulFitRule is true when a compound AND contains at least one meaningful leaf", () => {
  const rule = weightedRule({
    condition: {
      op: "and",
      conditions: [
        { op: "exists", field: "company.domain" },
        { op: "eq", field: "company.industry", value: "Banking" },
      ],
    },
  });
  assert.equal(isMeaningfulFitRule(rule), true);
});

test("isMeaningfulFitRule is false when a compound OR contains only exists leaves", () => {
  const rule = weightedRule({
    condition: {
      op: "or",
      conditions: [
        { op: "exists", field: "company.domain" },
        { op: "exists", field: "company.name" },
      ],
    },
  });
  assert.equal(isMeaningfulFitRule(rule), false);
});

test("isMeaningfulFitRule is true through a NOT wrapping a meaningful leaf", () => {
  const rule = weightedRule({
    condition: { op: "not", condition: { op: "eq", field: "company.region", value: "EMEA" } },
  });
  assert.equal(isMeaningfulFitRule(rule), true);
});

// ---------------------------------------------------------------------
// Blank values — a supported shape (isSupportedFitCriterionLeaf) is not
// automatically meaningful (isMeaningfulFitRule/isMeaningfulFitLeaf); a
// still-blank value must never satisfy publication readiness.
// ---------------------------------------------------------------------

test("isSupportedFitCriterionLeaf is true for an eq leaf with a blank value — shape only, independent of the value", () => {
  assert.equal(
    isSupportedFitCriterionLeaf({ op: "eq", field: "company.industry", value: "" }),
    true,
  );
  assert.equal(
    isSupportedFitCriterionLeaf({ op: "eq", field: "company.industry", value: "   " }),
    true,
  );
});

test("isMeaningfulFitLeaf is false for an eq leaf with an empty or whitespace-only value", () => {
  assert.equal(isMeaningfulFitLeaf({ op: "eq", field: "company.industry", value: "" }), false);
  assert.equal(isMeaningfulFitLeaf({ op: "eq", field: "company.industry", value: "   " }), false);
});

test("isMeaningfulFitLeaf is false for an in leaf whose values are all empty/whitespace-only", () => {
  assert.equal(
    isMeaningfulFitLeaf({ op: "in", field: "company.industry", values: ["", "   "] }),
    false,
  );
});

test("isMeaningfulFitLeaf is true for an in leaf with at least one non-blank value mixed with blanks", () => {
  assert.equal(
    isMeaningfulFitLeaf({ op: "in", field: "company.industry", values: ["", "Banking"] }),
    true,
  );
});

test("isMeaningfulFitRule is false for an eq rule with a blank value, even at a real points value", () => {
  const rule = weightedRule({ condition: { op: "eq", field: "company.industry", value: "" } });
  assert.equal(isMeaningfulFitRule(rule), false);
});

test("evaluatePublicationReadiness flags meaningful_target_required when the only fit rule has a blank eq value", () => {
  const reasons = evaluatePublicationReadiness(
    baseConfig([weightedRule({ condition: { op: "eq", field: "company.industry", value: "" } })]),
  );
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0]!.code, "meaningful_target_required");
});

// ---------------------------------------------------------------------
// evaluatePublicationReadiness
// ---------------------------------------------------------------------

test("evaluatePublicationReadiness returns meaningful_target_required when fit has no rules at all", () => {
  const reasons = evaluatePublicationReadiness(baseConfig([]));
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0]!.code, "meaningful_target_required");
});

test("evaluatePublicationReadiness returns meaningful_target_required when every fit rule is an exists-only check", () => {
  const reasons = evaluatePublicationReadiness(
    baseConfig([
      weightedRule({ condition: { op: "exists", field: "company.domain" } }),
      weightedRule({ id: "rule_2", condition: { op: "exists", field: "company.industry" } }),
    ]),
  );
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0]!.code, "meaningful_target_required");
});

test("evaluatePublicationReadiness returns [] when at least one fit rule is a meaningful eq/in match", () => {
  const reasons = evaluatePublicationReadiness(
    baseConfig([
      weightedRule({ condition: { op: "exists", field: "company.domain" } }),
      weightedRule({
        id: "rule_2",
        condition: { op: "in", field: "company.industry", values: ["Banking"] },
      }),
    ]),
  );
  assert.deepEqual(reasons, []);
});

test("evaluatePublicationReadiness is satisfied by a fit-only config (no intent/actionability/eligibility rules)", () => {
  const reasons = evaluatePublicationReadiness(
    baseConfig([weightedRule({ condition: { op: "eq", field: "company.domain", value: "acme.com" } })]),
  );
  assert.deepEqual(reasons, []);
});
