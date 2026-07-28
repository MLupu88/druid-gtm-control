// Unit tests for IcpProfileConfigV1 validation: uniqueness, tier
// requirements, dimension field allowlists, and bounded rule counts.
//
// Run with: tsx --test lib/evaluator/src/profileConfig.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  ConditionRuleSchema,
  EligibilityConfigSchema,
  FitConfigSchema,
  IcpProfileConfigV1Schema,
  MAX_RULES_PER_DIMENSION,
  WeightedRuleSchema,
  type IcpProfileConfigV1,
} from "./profileConfig.js";

function fitRule(id: string, points: number, field = "company.domain") {
  return {
    id,
    description: `rule ${id}`,
    points,
    condition: { op: "exists" as const, field },
  };
}

function conditionRule(id: string) {
  return {
    id,
    description: `rule ${id}`,
    condition: { op: "eq" as const, field: "doNotContact", value: true },
  };
}

const MINIMAL_FIT_CONFIG = {
  rules: [fitRule("has_domain", 10)],
  tiers: [
    { code: "floor", minScore: 0 },
    { code: "qualified", minScore: 10 },
  ],
};

// Explicitly typed so empty arrays like actionability.rules,
// eligibility.hardDisqualifiers, and eligibility.restrictions are typed
// against IcpProfileConfigV1's real shape rather than being inferred as
// never[] (which would make later test mutations fail to typecheck).
function minimalConfig(): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: MINIMAL_FIT_CONFIG,
    intent: {
      rules: [],
      tiers: [{ code: "floor", minScore: 0 }],
    },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

test("a well-formed minimal profile config parses successfully", () => {
  const parsed = IcpProfileConfigV1Schema.parse(minimalConfig());
  assert.equal(parsed.configSchemaVersion, "v1");
});

test("identity is not part of the profile config shape", () => {
  const config = minimalConfig() as Record<string, unknown>;
  assert.equal("identity" in config, false);
  // Adding one should be rejected by .strict() — proves identity truly
  // cannot be authored through this schema, not just "happens to be
  // absent from the fixture".
  assert.throws(() =>
    IcpProfileConfigV1Schema.parse({ ...config, identity: {} }),
  );
});

// =======================================================================
// Rule id / tier code uniqueness
// =======================================================================

test("duplicate rule ids within a dimension are rejected", () => {
  const config = minimalConfig();
  config.fit = {
    ...config.fit,
    rules: [fitRule("dup", 5), fitRule("dup", 10)],
  };
  assert.throws(() => IcpProfileConfigV1Schema.parse(config));
});

test("duplicate tier codes within a dimension are rejected", () => {
  const config = minimalConfig();
  config.fit = {
    ...config.fit,
    tiers: [
      { code: "floor", minScore: 0 },
      { code: "floor", minScore: 20 },
    ],
  };
  assert.throws(() => IcpProfileConfigV1Schema.parse(config));
});

// =======================================================================
// Tier minScore requirements
// =======================================================================

test("a fit/intent tier set without a floor tier at minScore 0 is rejected", () => {
  const config = minimalConfig();
  config.fit = { ...config.fit, tiers: [{ code: "qualified", minScore: 10 }] };
  assert.throws(() => IcpProfileConfigV1Schema.parse(config));
});

test("duplicate tier minScore within a dimension is rejected", () => {
  const config = minimalConfig();
  config.fit = {
    ...config.fit,
    tiers: [
      { code: "floor", minScore: 0 },
      { code: "mid", minScore: 10 },
      { code: "high", minScore: 10 },
    ],
  };
  assert.throws(() => IcpProfileConfigV1Schema.parse(config));
});

test("distinct tier minScore thresholds within a dimension are accepted", () => {
  const config = minimalConfig();
  config.fit = {
    ...config.fit,
    tiers: [
      { code: "floor", minScore: 0 },
      { code: "mid", minScore: 10 },
      { code: "high", minScore: 25 },
    ],
  };
  assert.doesNotThrow(() => IcpProfileConfigV1Schema.parse(config));
});

// =======================================================================
// Non-negative finite integer points / minScore
// =======================================================================

test("negative points are rejected", () => {
  assert.throws(() => WeightedRuleSchema.parse(fitRule("negative", -1)));
});

test("non-integer points are rejected", () => {
  assert.throws(() => WeightedRuleSchema.parse(fitRule("fractional", 1.5)));
});

test("non-finite points are rejected", () => {
  assert.throws(() =>
    WeightedRuleSchema.parse(fitRule("infinite", Number.POSITIVE_INFINITY)),
  );
});

// =======================================================================
// Dimension field allowlists enforced at parse time
// =======================================================================

test("a fit rule referencing an intent-only field is rejected at config parse time", () => {
  const config = minimalConfig();
  config.fit = {
    ...config.fit,
    rules: [
      {
        id: "bad",
        description: "wrong dimension",
        points: 5,
        condition: { op: "exists", field: "engagement.sources" },
      },
    ],
  };
  assert.throws(() => IcpProfileConfigV1Schema.parse(config));
});

test("an actionability rule referencing a consent field is rejected (actionability must exclude legal/consent facts)", () => {
  const config = minimalConfig();
  config.actionability = {
    rules: [
      {
        id: "bad",
        description: "consent leak",
        points: 5,
        condition: { op: "eq", field: "consent.email", value: "true" },
      },
    ],
  };
  assert.throws(() => IcpProfileConfigV1Schema.parse(config));
});

test("an eligibility rule referencing an engagement field is rejected", () => {
  const config = minimalConfig();
  config.eligibility = {
    hardDisqualifiers: [
      {
        id: "bad",
        description: "wrong dimension",
        condition: { op: "exists", field: "engagement.sources" },
      },
    ],
    restrictions: [],
  };
  assert.throws(() => IcpProfileConfigV1Schema.parse(config));
});

// =======================================================================
// Bounded condition nesting/collection sizes are enforced through config parsing
// =======================================================================

test("a condition exceeding the nesting depth bound is rejected at config parse time", () => {
  let condition: import("./conditions.js").RuleCondition = {
    op: "exists",
    field: "company.domain",
  };
  for (let i = 0; i < 7; i++) condition = { op: "not", condition };
  const config = minimalConfig();
  config.fit = {
    ...config.fit,
    rules: [{ id: "too_deep", description: "too deep", points: 5, condition }],
  };
  assert.throws(() => IcpProfileConfigV1Schema.parse(config));
});

// =======================================================================
// Eligibility combined rule-count bound (hardDisqualifiers + restrictions)
// =======================================================================

test("50 combined eligibility rules (hardDisqualifiers + restrictions) are accepted", () => {
  const hardDisqualifiers = Array.from({ length: 25 }, (_, i) =>
    conditionRule(`disq_${i}`),
  );
  const restrictions = Array.from({ length: 25 }, (_, i) =>
    conditionRule(`restr_${i}`),
  );
  assert.equal(
    hardDisqualifiers.length + restrictions.length,
    MAX_RULES_PER_DIMENSION,
  );
  assert.doesNotThrow(() =>
    EligibilityConfigSchema.parse({ hardDisqualifiers, restrictions }),
  );
});

test("51 combined eligibility rules (hardDisqualifiers + restrictions) are rejected", () => {
  const hardDisqualifiers = Array.from({ length: 26 }, (_, i) =>
    conditionRule(`disq_${i}`),
  );
  const restrictions = Array.from({ length: 25 }, (_, i) =>
    conditionRule(`restr_${i}`),
  );
  assert.equal(
    hardDisqualifiers.length + restrictions.length,
    MAX_RULES_PER_DIMENSION + 1,
  );
  assert.throws(() =>
    EligibilityConfigSchema.parse({ hardDisqualifiers, restrictions }),
  );
});

test("EligibilityConfigSchema rejects a duplicate id shared across hardDisqualifiers and restrictions", () => {
  assert.throws(() =>
    EligibilityConfigSchema.parse({
      hardDisqualifiers: [conditionRule("shared")],
      restrictions: [conditionRule("shared")],
    }),
  );
});

test("ConditionRuleSchema round-trips a valid rule", () => {
  const rule = conditionRule("valid");
  assert.deepEqual(ConditionRuleSchema.parse(rule), rule);
});

test("FitConfigSchema rejects more than MAX_RULES_PER_DIMENSION rules", () => {
  const rules = Array.from({ length: MAX_RULES_PER_DIMENSION + 1 }, (_, i) =>
    fitRule(`rule_${i}`, 1),
  );
  assert.throws(() =>
    FitConfigSchema.parse({ rules, tiers: [{ code: "floor", minScore: 0 }] }),
  );
});
