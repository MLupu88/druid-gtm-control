// Unit tests for evaluateMqlDecisionReadiness — the pure classifier
// deciding whether an already-completed evaluation's fit/intent
// conditions (worth more than zero points) are all resolvable from
// evidence-backed data alone. Deliberately exercises the "a compound
// condition may resolve even when one branch is unevidenced" truth table
// (an irrelevant unevidenced branch must never block readiness) and the
// "fields must only list what is actually responsible" requirement.
//
// Run with: tsx --test src/mqlDecisionReadiness.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMqlDecisionReadiness } from "./mqlDecisionReadiness.js";
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

function baseConfig(
  overrides: Partial<{
    fitRules: WeightedRule[];
    intentRules: WeightedRule[];
  }> = {},
): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: overrides.fitRules ?? [weightedRule({ id: "fit_domain" })],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: {
      rules: overrides.intentRules ?? [],
      tiers: [{ code: "floor", minScore: 0 }],
    },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

const EVIDENCE_BACKED = new Set(["company.domain", "company.name"]);

// =======================================================================
// intent_not_configured
// =======================================================================

test("intent_not_configured when there are zero intent rules", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({ intentRules: [] }),
    { company: { domain: "acme.com" } },
    EVIDENCE_BACKED,
  );
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => r.code === "intent_not_configured"));
});

test("intent_not_configured when every intent rule is worth zero points", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      intentRules: [
        weightedRule({
          id: "intent_zero",
          points: 0,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { company: { domain: "acme.com" } },
    EVIDENCE_BACKED,
  );
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => r.code === "intent_not_configured"));
});

test("no intent_not_configured when at least one intent rule is worth > 0 points", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_domain",
          condition: { op: "exists", field: "company.domain" },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { company: { domain: "acme.com" }, engagement: { repeatVisit: true } },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  assert.equal(
    result.reasons.some((r) => r.code === "intent_not_configured"),
    false,
  );
});

test("at least one positive-point intent rule proceeds to condition-aware evidence evaluation — its condition is actually resolved, not merely counted", () => {
  // Deliberately: engagement.repeatVisit is NOT in the evidence-backed
  // set, so if the rule is genuinely evaluated (not skipped once
  // intent_not_configured is ruled out), it must surface
  // required_condition_unresolved for this exact ruleId. If a positive-
  // point intent rule were only counted (to decide intent_not_configured)
  // and never actually run through resolveConditionAgainstEvidence, this
  // reason would never appear.
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      intentRules: [
        weightedRule({
          id: "intent_unresolved",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { company: { domain: "acme.com" } },
    EVIDENCE_BACKED,
  );
  assert.equal(
    result.reasons.some((r) => r.code === "intent_not_configured"),
    false,
  );
  const reason = result.reasons.find(
    (r) =>
      r.code === "required_condition_unresolved" && r.dimension === "intent",
  );
  assert.ok(
    reason,
    "expected the positive-point intent rule's condition to have been evaluated, not skipped",
  );
  assert.equal(reason!.ruleId, "intent_unresolved");
  assert.deepEqual(reason!.fields, ["engagement.repeatVisit"]);
});

// =======================================================================
// Zero-point rules never affect readiness
// =======================================================================

test("a zero-point fit rule referencing an unevidenced field never blocks readiness", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_domain",
          points: 10,
          condition: { op: "exists", field: "company.domain" },
        }),
        weightedRule({
          id: "fit_industry_unweighted",
          points: 0,
          condition: { op: "eq", field: "company.industry", value: "Banking" },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { company: { domain: "acme.com" }, engagement: { repeatVisit: true } },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  assert.deepEqual(result.reasons, []);
  assert.equal(result.ready, true);
});

// =======================================================================
// The corrected compound-condition behaviour: an irrelevant unevidenced
// branch must not block a condition that already resolved via another
// branch.
// =======================================================================

test("AND(evidence-backed no_match, unevidenced) resolves no_match and does not block readiness", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_and",
          points: 10,
          condition: {
            op: "and",
            conditions: [
              { op: "eq", field: "company.domain", value: "other.com" },
              { op: "eq", field: "company.employeeRange", value: "50-200" },
            ],
          },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    {
      company: { domain: "acme.com" }, // present, evidence-backed, real value -> no_match against "other.com"
      engagement: { repeatVisit: true },
    },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  // company.employeeRange is unevidenced but irrelevant: the AND already
  // resolved to no_match via company.domain alone.
  assert.deepEqual(result.reasons, []);
  assert.equal(result.ready, true);
});

test("OR(evidence-backed match, unevidenced) resolves match and does not block readiness", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_or",
          points: 10,
          condition: {
            op: "or",
            conditions: [
              { op: "eq", field: "company.domain", value: "acme.com" },
              { op: "eq", field: "company.industry", value: "Banking" },
            ],
          },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { company: { domain: "acme.com" }, engagement: { repeatVisit: true } },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  assert.deepEqual(result.reasons, []);
  assert.equal(result.ready, true);
});

test("nested: AND(OR(no_match evidence-backed, unknown unevidenced), no_match evidence-backed) resolves no_match via the outer AND and is not blocked", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_nested",
          points: 10,
          condition: {
            op: "and",
            conditions: [
              {
                op: "or",
                conditions: [
                  { op: "eq", field: "company.domain", value: "other.com" },
                  { op: "eq", field: "company.industry", value: "Banking" },
                ],
              },
              { op: "eq", field: "company.name", value: "Not Acme" },
            ],
          },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    {
      company: { domain: "acme.com", name: "Acme" },
      engagement: { repeatVisit: true },
    },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  assert.deepEqual(result.reasons, []);
  assert.equal(result.ready, true);
});

// =======================================================================
// required_condition_unresolved — root genuinely unresolved
// =======================================================================

test("a single unevidenced leaf at the root is required_condition_unresolved with that field listed", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_industry",
          points: 10,
          condition: { op: "eq", field: "company.industry", value: "Banking" },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { company: { industry: null }, engagement: { repeatVisit: true } },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  const reason = result.reasons.find(
    (r) => r.code === "required_condition_unresolved" && r.dimension === "fit",
  );
  assert.ok(reason, "expected a fit required_condition_unresolved reason");
  assert.equal(reason!.ruleId, "fit_industry");
  assert.deepEqual(reason!.fields, ["company.industry"]);
  assert.equal(result.ready, false);
});

test("NOT(unevidenced) is unresolved and reports the field", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_not",
          points: 10,
          condition: {
            op: "not",
            condition: { op: "eq", field: "company.industry", value: "Banking" },
          },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { engagement: { repeatVisit: true } },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  const reason = result.reasons.find(
    (r) => r.code === "required_condition_unresolved" && r.ruleId === "fit_not",
  );
  assert.ok(reason);
  assert.deepEqual(reason!.fields, ["company.industry"]);
});

test("AND(unknown, unknown) reports both responsible fields", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_double_unknown",
          points: 10,
          condition: {
            op: "and",
            conditions: [
              { op: "eq", field: "company.industry", value: "Banking" },
              { op: "eq", field: "company.employeeRange", value: "50-200" },
            ],
          },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { engagement: { repeatVisit: true } },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  const reason = result.reasons.find(
    (r) =>
      r.code === "required_condition_unresolved" &&
      r.ruleId === "fit_double_unknown",
  );
  assert.ok(reason);
  assert.deepEqual(reason!.fields, [
    "company.employeeRange",
    "company.industry",
  ]);
});

test("a genuinely-missing evidence-backed field (present in evidence set but null on the account) is reported like any other unresolved field", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_domain_eq",
          points: 10,
          condition: { op: "eq", field: "company.domain", value: "acme.com" },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { company: { domain: null }, engagement: { repeatVisit: true } },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  const reason = result.reasons.find((r) => r.ruleId === "fit_domain_eq");
  assert.ok(reason);
  assert.deepEqual(reason!.fields, ["company.domain"]);
});

// =======================================================================
// Fully resolved, evidence-backed-only profile is ready
// =======================================================================

test("ready: true when every > 0 point fit/intent rule resolves from evidence-backed data alone", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_domain",
          points: 10,
          condition: { op: "exists", field: "company.domain" },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    { company: { domain: "acme.com" }, engagement: { repeatVisit: true } },
    new Set(["company.domain", "company.name", "engagement.repeatVisit"]),
  );
  assert.deepEqual(result.reasons, []);
  assert.equal(result.ready, true);
});

test("the sparse gtm-account-current-state-v1 shape (only company.domain/name evidence-backed) is not ready against a realistic fit+intent profile", () => {
  const result = evaluateMqlDecisionReadiness(
    baseConfig({
      fitRules: [
        weightedRule({
          id: "fit_industry",
          points: 10,
          condition: { op: "eq", field: "company.industry", value: "Banking" },
        }),
      ],
      intentRules: [
        weightedRule({
          id: "intent_repeat",
          points: 5,
          condition: { op: "exists", field: "engagement.repeatVisit" },
        }),
      ],
    }),
    {
      company: { domain: "acme.com", name: "Acme", industry: null },
      engagement: {
        sources: [],
        pagesVisited: [],
        distinctSourceCount: 0,
        repeatVisit: false,
        lastSeenAt: null,
      },
    },
    EVIDENCE_BACKED,
  );
  assert.equal(result.ready, false);
  assert.ok(
    result.reasons.some(
      (r) => r.code === "required_condition_unresolved" && r.dimension === "fit",
    ),
  );
  assert.ok(
    result.reasons.some(
      (r) =>
        r.code === "required_condition_unresolved" && r.dimension === "intent",
    ),
  );
});
