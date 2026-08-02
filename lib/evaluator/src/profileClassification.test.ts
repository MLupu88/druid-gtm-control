// Run with: tsx --test src/profileClassification.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { classifyProfileConfig, targetCriteria } from "./profileClassification.js";
import type { IcpProfileConfigV1, WeightedRule } from "./profileConfig.js";

function weightedRule(overrides: Partial<WeightedRule> = {}): WeightedRule {
  return {
    id: "rule_1",
    description: "test rule",
    points: 10,
    condition: { op: "eq", field: "company.industry", value: "Banking" },
    ...overrides,
  };
}

function baseConfig(overrides: Partial<IcpProfileConfigV1> = {}): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
    ...overrides,
  };
}

const LEGACY_STARTER_CONFIG: unknown = {
  configSchemaVersion: "v1",
  fit: {
    rules: [
      {
        id: "has_domain",
        description: "Has a domain",
        points: 10,
        condition: { op: "exists", field: "company.domain" },
      },
    ],
    tiers: [{ code: "base", minScore: 0 }],
  },
  intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
  actionability: { rules: [] },
  eligibility: { hardDisqualifiers: [], restrictions: [] },
};

// ---------------------------------------------------------------------
// classifyProfileConfig
// ---------------------------------------------------------------------

test("classifyProfileConfig returns no_active_definition for a null config", () => {
  assert.equal(classifyProfileConfig(null), "no_active_definition");
});

test("classifyProfileConfig returns legacy_starter for the exact legacy signature", () => {
  assert.equal(
    classifyProfileConfig(LEGACY_STARTER_CONFIG as IcpProfileConfigV1),
    "legacy_starter",
  );
});

test("classifyProfileConfig returns incomplete when fit has no rules at all", () => {
  assert.equal(classifyProfileConfig(baseConfig()), "incomplete");
});

test("classifyProfileConfig returns incomplete for a bare exists-only fit rule that doesn't match the legacy signature (different points)", () => {
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ condition: { op: "exists", field: "company.domain" }, points: 5 })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.equal(classifyProfileConfig(config), "incomplete");
});

test("classifyProfileConfig returns fit_only when meaningful fit criteria exist but no intent rules", () => {
  assert.equal(
    classifyProfileConfig(baseConfig({ fit: { rules: [weightedRule()], tiers: [{ code: "base", minScore: 0 }] } })),
    "fit_only",
  );
});

test("classifyProfileConfig returns fit_plus_intent when both meaningful fit and at least one intent rule exist", () => {
  assert.equal(
    classifyProfileConfig(
      baseConfig({
        fit: { rules: [weightedRule()], tiers: [{ code: "base", minScore: 0 }] },
        intent: {
          rules: [
            {
              id: "recent_visit",
              description: "recent visit",
              points: 5,
              condition: { op: "exists", field: "engagement.sources" },
            },
          ],
          tiers: [{ code: "floor", minScore: 0 }],
        },
      }),
    ),
    "fit_plus_intent",
  );
});

test("classifyProfileConfig returns incomplete when the only fit rule has a blank eq value — a supported shape is not automatically meaningful", () => {
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ condition: { op: "eq", field: "company.industry", value: "" } })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.equal(classifyProfileConfig(config), "incomplete");
});

test("classifyProfileConfig works identically for a draft config, not just an active version's", () => {
  // No "active version" concept here at all — just a config, confirming
  // the function makes no active-only assumption.
  const draftConfig = baseConfig({
    fit: { rules: [weightedRule()], tiers: [{ code: "base", minScore: 0 }] },
  });
  assert.equal(classifyProfileConfig(draftConfig), "fit_only");
});

// ---------------------------------------------------------------------
// targetCriteria
// ---------------------------------------------------------------------

test("targetCriteria returns [] for a null config", () => {
  assert.deepEqual(targetCriteria(null), []);
});

test("targetCriteria extracts a direct eq leaf on a meaningful field", () => {
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ condition: { op: "eq", field: "company.industry", value: "Banking" } })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), [
    { field: "company.industry", operator: "eq", values: ["Banking"] },
  ]);
});

test("targetCriteria omits a rule whose eq value is blank", () => {
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ condition: { op: "eq", field: "company.industry", value: "  " } })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), []);
});

test("targetCriteria omits a rule whose in values are all blank", () => {
  const config = baseConfig({
    fit: {
      rules: [
        weightedRule({ condition: { op: "in", field: "company.industry", values: ["", "   "] } }),
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), []);
});

test("targetCriteria filters blank entries out of a mixed in array's values, keeping the rule since it's still meaningful", () => {
  const config = baseConfig({
    fit: {
      rules: [
        weightedRule({
          condition: { op: "in", field: "company.industry", values: ["", "Banking", "  "] },
        }),
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), [
    { field: "company.industry", operator: "in", values: ["Banking"] },
  ]);
});

test("targetCriteria ignores exists conditions", () => {
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ condition: { op: "exists", field: "company.domain" } })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), []);
});

test("targetCriteria ignores zero-point rules", () => {
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ points: 0 })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), []);
});

test("targetCriteria ignores negative-point rules", () => {
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ points: -5 })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), []);
});

test("targetCriteria does NOT recurse into compound conditions — 'industry = Banking AND domain exists' contributes nothing", () => {
  const config = baseConfig({
    fit: {
      rules: [
        weightedRule({
          condition: {
            op: "and",
            conditions: [
              { op: "eq", field: "company.industry", value: "Banking" },
              { op: "exists", field: "company.domain" },
            ],
          },
        }),
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), []);
});

test("targetCriteria never flattens a NOT-wrapped criterion into a positive one — 'not (industry = Banking)' contributes nothing", () => {
  const config = baseConfig({
    fit: {
      rules: [
        weightedRule({
          condition: { op: "not", condition: { op: "eq", field: "company.industry", value: "Banking" } },
        }),
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), []);
});

test("targetCriteria normalizes eq to a one-element values array", () => {
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ condition: { op: "eq", field: "company.region", value: "EMEA" } })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  const [criterion] = targetCriteria(config);
  assert.deepEqual(criterion!.values, ["EMEA"]);
});

test("targetCriteria deduplicates identical in criteria authored with values in a different order", () => {
  const config = baseConfig({
    fit: {
      rules: [
        weightedRule({
          id: "rule_a",
          condition: { op: "in", field: "company.industry", values: ["Banking", "Insurance"] },
        }),
        weightedRule({
          id: "rule_b",
          condition: { op: "in", field: "company.industry", values: ["Insurance", "Banking"] },
        }),
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.equal(targetCriteria(config).length, 1);
});

test("targetCriteria deduplicates a repeated value within a single in list", () => {
  const config = baseConfig({
    fit: {
      rules: [
        weightedRule({
          condition: { op: "in", field: "company.industry", values: ["Banking", "Banking"] },
        }),
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  assert.deepEqual(targetCriteria(config), [
    { field: "company.industry", operator: "in", values: ["Banking"] },
  ]);
});

test("targetCriteria returns criteria sorted deterministically by field", () => {
  const config = baseConfig({
    fit: {
      rules: [
        weightedRule({ id: "rule_region", condition: { op: "eq", field: "company.region", value: "EMEA" } }),
        weightedRule({ id: "rule_industry", condition: { op: "eq", field: "company.industry", value: "Banking" } }),
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  const fields = targetCriteria(config).map((c) => c.field);
  assert.deepEqual(fields, ["company.industry", "company.region"]);
});

test("targetCriteria never returns a values array that is the same reference as the original config's", () => {
  const originalValues = ["Banking", "Insurance"];
  const config = baseConfig({
    fit: {
      rules: [weightedRule({ condition: { op: "in", field: "company.industry", values: originalValues } })],
      tiers: [{ code: "base", minScore: 0 }],
    },
  });
  const [criterion] = targetCriteria(config);
  assert.notEqual(criterion!.values, originalValues);
});
