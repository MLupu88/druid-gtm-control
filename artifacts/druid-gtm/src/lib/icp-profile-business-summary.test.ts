// Tests for ./icp-profile-business-summary.ts — deterministic
// business-language derivations for the ICP draft editor. No DOM needed.
//
// Run with: tsx --test src/lib/icp-profile-business-summary.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { IcpProfileConfigV1, WeightedRule, Tier } from "@workspace/evaluator";
import {
  sumRulePoints,
  ruleSharePercent,
  unreachableBands,
  allBandsCollapseToFallback,
  humanizeBandLabel,
  summarizeBands,
  describeCondition,
  describeWeightedRuleSentence,
  describeEligibilityRuleSentence,
  collectConditionFields,
  fieldsReferencedByRules,
  isGenericIdentityOnlyRule,
  deriveConfigWarnings,
  buildIcpProfileSummary,
} from "./icp-profile-business-summary.js";
import { WEIGHT_PRESET_VALUES, weightPresetForPoints } from "./icp-profile-config-editing.js";

function rule(overrides: Partial<WeightedRule> = {}): WeightedRule {
  return {
    id: "rule_1",
    description: "",
    points: 10,
    condition: { op: "exists", field: "company.industry" },
    ...overrides,
  };
}

function emptyConfig(): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "not_yet_qualified", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "no_observed_intent", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

// ---------------------------------------------------------------------
// Points as weights, never a score out of 100
// ---------------------------------------------------------------------

test("sumRulePoints totals every rule's points in a dimension", () => {
  assert.equal(sumRulePoints([rule({ points: 10 }), rule({ points: 15 })]), 25);
  assert.equal(sumRulePoints([]), 0);
});

test("ruleSharePercent computes a rule's share of the dimension's current total", () => {
  assert.equal(ruleSharePercent(10, 40), 25);
  assert.equal(ruleSharePercent(20, 40), 50);
});

test("ruleSharePercent returns null (never a fabricated 0%) when the dimension has no points at all", () => {
  assert.equal(ruleSharePercent(0, 0), null);
});

test("describeWeightedRuleSentence describes points as a weight being awarded, never as a score out of 100", () => {
  const sentence = describeWeightedRuleSentence("fit", rule({ points: 20 }));
  assert.ok(sentence.includes("Award 20 fit points"));
  assert.ok(!sentence.toLowerCase().includes("out of 100"));
  assert.ok(!sentence.includes("/100"));
});

// ---------------------------------------------------------------------
// Unreachable-band / fallback-collapse warnings
// ---------------------------------------------------------------------

test("unreachableBands flags a non-fallback band whose threshold exceeds the total configured positive rule weights (a safe upper bound)", () => {
  const tiers: Tier[] = [
    { code: "low", minScore: 0 },
    { code: "high", minScore: 100 },
  ];
  const unreachable = unreachableBands(tiers, 40);
  assert.equal(unreachable.length, 1);
  assert.equal(unreachable[0]?.code, "high");
});

test("unreachableBands never flags the fallback (minScore 0) band — it always applies, by definition", () => {
  const tiers: Tier[] = [{ code: "low", minScore: 0 }];
  assert.deepEqual(unreachableBands(tiers, 0), []);
});

test("unreachableBands returns nothing when the threshold exactly equals the total configured positive rule weights (the boundary is not 'exceeds')", () => {
  const tiers: Tier[] = [
    { code: "low", minScore: 0 },
    { code: "high", minScore: 40 },
  ];
  assert.deepEqual(unreachableBands(tiers, 40), []);
});

test("allBandsCollapseToFallback is true when every non-fallback band's threshold exceeds the total configured positive rule weights", () => {
  const tiers: Tier[] = [
    { code: "low", minScore: 0 },
    { code: "mid", minScore: 50 },
    { code: "high", minScore: 100 },
  ];
  assert.equal(allBandsCollapseToFallback(tiers, 10), true);
});

test("allBandsCollapseToFallback is false once at least one non-fallback band's threshold is within the total configured positive rule weights (not proven unreachable)", () => {
  const tiers: Tier[] = [
    { code: "low", minScore: 0 },
    { code: "mid", minScore: 10 },
    { code: "high", minScore: 100 },
  ];
  assert.equal(allBandsCollapseToFallback(tiers, 10), false);
});

test("allBandsCollapseToFallback is false for a single-band config — nothing to collapse into", () => {
  assert.equal(allBandsCollapseToFallback([{ code: "only", minScore: 0 }], 0), false);
});

test("deriveConfigWarnings reports an unreachable-band warning by name", () => {
  const config = emptyConfig();
  config.fit.rules = [rule({ points: 10 })];
  config.fit.tiers = [
    { code: "not_yet_qualified", minScore: 0 },
    { code: "qualified", minScore: 100 },
  ];
  const warnings = deriveConfigWarnings(config);
  const match = warnings.find((w) => w.id.startsWith("fit-band-unreachable-"));
  assert.ok(match, "expected an unreachable fit band warning");
  assert.ok(match!.message.includes("Qualified"));
  assert.ok(match!.message.includes("100"));
  assert.ok(match!.message.includes("cannot be reached with the currently configured rule weights"));
  // Never overclaims a precise "achievable"/"reachable" ceiling — only
  // that the configured rule WEIGHTS (a safe upper bound) fall short.
  assert.ok(!match!.message.toLowerCase().includes("achievable"));
});

// ---------------------------------------------------------------------
// Empty-dimension / generic-identity-only guidance
// ---------------------------------------------------------------------

test("deriveConfigWarnings warns when there are no fit rules", () => {
  const warnings = deriveConfigWarnings(emptyConfig());
  assert.ok(warnings.some((w) => w.id === "no-fit-rules"));
});

test("deriveConfigWarnings warns when there are no intent rules", () => {
  const warnings = deriveConfigWarnings(emptyConfig());
  assert.ok(warnings.some((w) => w.id === "no-intent-rules"));
});

test("deriveConfigWarnings warns when there are no actionability rules", () => {
  const warnings = deriveConfigWarnings(emptyConfig());
  assert.ok(warnings.some((w) => w.id === "no-actionability-rules"));
});

test("deriveConfigWarnings warns when no eligibility guardrails exist", () => {
  const warnings = deriveConfigWarnings(emptyConfig());
  assert.ok(warnings.some((w) => w.id === "no-eligibility-guardrails"));
});

test("isGenericIdentityOnlyRule is true only when every referenced field is company.domain/company.name", () => {
  assert.equal(
    isGenericIdentityOnlyRule(rule({ condition: { op: "exists", field: "company.domain" } })),
    true,
  );
  assert.equal(
    isGenericIdentityOnlyRule(
      rule({
        condition: {
          op: "and",
          conditions: [
            { op: "exists", field: "company.domain" },
            { op: "exists", field: "company.name" },
          ],
        },
      }),
    ),
    true,
  );
  assert.equal(
    isGenericIdentityOnlyRule(rule({ condition: { op: "exists", field: "company.industry" } })),
    false,
  );
});

test("deriveConfigWarnings warns when every configured fit rule is generic-identity-only", () => {
  const config = emptyConfig();
  config.fit.rules = [rule({ condition: { op: "exists", field: "company.domain" } })];
  const warnings = deriveConfigWarnings(config);
  assert.ok(warnings.some((w) => w.id === "generic-fit-only"));
  // Genuinely no-rules and generic-only are mutually exclusive states.
  assert.ok(!warnings.some((w) => w.id === "no-fit-rules"));
});

test("deriveConfigWarnings does NOT warn generic-fit-only once a real fit criterion exists alongside identity fields", () => {
  const config = emptyConfig();
  config.fit.rules = [
    rule({ id: "r1", condition: { op: "exists", field: "company.domain" } }),
    rule({ id: "r2", condition: { op: "exists", field: "company.industry" } }),
  ];
  const warnings = deriveConfigWarnings(config);
  assert.ok(!warnings.some((w) => w.id === "generic-fit-only"));
});

// ---------------------------------------------------------------------
// Weight preset mapping (re-exported from icp-profile-config-editing.ts)
// ---------------------------------------------------------------------

test("weightPresetForPoints maps documented preset values deterministically", () => {
  assert.equal(weightPresetForPoints(WEIGHT_PRESET_VALUES.supporting), "supporting");
  assert.equal(weightPresetForPoints(WEIGHT_PRESET_VALUES.important), "important");
  assert.equal(weightPresetForPoints(WEIGHT_PRESET_VALUES.critical), "critical");
});

test("weightPresetForPoints returns null for a value that isn't one of the three documented presets", () => {
  assert.equal(weightPresetForPoints(7), null);
  assert.equal(weightPresetForPoints(0), null);
});

// ---------------------------------------------------------------------
// Rule sentence generation
// ---------------------------------------------------------------------

test("describeCondition renders 'in' as an Oxford-joined 'is one of' sentence", () => {
  const text = describeCondition({
    op: "in",
    field: "company.industry",
    values: ["Banking", "Insurance"],
  });
  assert.equal(text, "Industry is one of Banking or Insurance");
});

test("describeCondition renders three or more 'in' values with an Oxford comma", () => {
  const text = describeCondition({
    op: "in",
    field: "company.industry",
    values: ["Banking", "Insurance", "Healthcare"],
  });
  assert.equal(text, "Industry is one of Banking, Insurance, or Healthcare");
});

test("describeWeightedRuleSentence matches the documented example shape", () => {
  const sentence = describeWeightedRuleSentence(
    "fit",
    rule({ points: 20, condition: { op: "in", field: "company.industry", values: ["Banking", "Insurance"] } }),
  );
  assert.equal(sentence, "Award 20 fit points when Industry is one of Banking or Insurance.");
});

test("describeEligibilityRuleSentence phrases a boolean-true restriction as a natural predicate", () => {
  const sentence = describeEligibilityRuleSentence("restriction", {
    id: "restriction_1",
    description: "",
    condition: { op: "eq", field: "crm.existingCustomer", value: true },
  });
  assert.equal(sentence, "Restrict outreach when the account is an existing customer.");
});

test("describeEligibilityRuleSentence phrases a hard disqualifier with 'Disqualify outright'", () => {
  const sentence = describeEligibilityRuleSentence("hardDisqualifier", {
    id: "hard_disqualifier_1",
    description: "",
    condition: { op: "eq", field: "crm.competitorFlag", value: true },
  });
  assert.ok(sentence.startsWith("Disqualify outright when"));
  assert.ok(sentence.includes("marked as a competitor"));
});

test("describeCondition never surfaces a raw field path or operator token as prose", () => {
  const text = describeCondition({ op: "gte", field: "engagement.distinctSourceCount", value: 3 });
  assert.ok(!text.includes("engagement."));
  assert.ok(!text.includes("gte"));
});

// ---------------------------------------------------------------------
// Field collection
// ---------------------------------------------------------------------

test("collectConditionFields recurses through and/or/not group conditions", () => {
  const fields = collectConditionFields({
    op: "and",
    conditions: [
      { op: "exists", field: "company.domain" },
      { op: "not", condition: { op: "exists", field: "company.industry" } },
    ],
  });
  assert.deepEqual(fields.sort(), ["company.domain", "company.industry"]);
});

test("fieldsReferencedByRules deduplicates fields across multiple rules", () => {
  const fields = fieldsReferencedByRules([
    rule({ id: "r1", condition: { op: "exists", field: "company.industry" } }),
    rule({ id: "r2", condition: { op: "exists", field: "company.industry" } }),
  ]);
  assert.deepEqual(fields, ["company.industry"]);
});

// ---------------------------------------------------------------------
// Band humanization
// ---------------------------------------------------------------------

test("humanizeBandLabel turns a snake_case tier code into a readable label", () => {
  assert.equal(humanizeBandLabel("not_yet_qualified"), "Not Yet Qualified");
});

test("summarizeBands sorts ascending by threshold and flags the fallback band", () => {
  const summary = summarizeBands([
    { code: "high", minScore: 100 },
    { code: "low", minScore: 0 },
  ]);
  assert.deepEqual(summary.map((b) => b.code), ["low", "high"]);
  assert.equal(summary[0]?.isFallback, true);
  assert.equal(summary[1]?.isFallback, false);
});

// ---------------------------------------------------------------------
// Deterministic profile summary
// ---------------------------------------------------------------------

test("buildIcpProfileSummary is a pure function of the config — same input, same output", () => {
  const config = emptyConfig();
  config.fit.rules = [rule({ points: 20, condition: { op: "exists", field: "company.industry" } })];
  const first = buildIcpProfileSummary(config);
  const second = buildIcpProfileSummary(config);
  assert.deepEqual(first, second);
});

test("buildIcpProfileSummary reports truthful empty attributes/sentences, never a fabricated conclusion", () => {
  const summary = buildIcpProfileSummary(emptyConfig());
  assert.deepEqual(summary.fit.attributes, []);
  assert.equal(summary.fit.ruleCount, 0);
  assert.deepEqual(summary.eligibility.hardDisqualifierSentences, []);
  assert.deepEqual(summary.eligibility.restrictionSentences, []);
});

test("buildIcpProfileSummary lists which real attributes define fit, drawn only from configured rules", () => {
  const config = emptyConfig();
  config.fit.rules = [rule({ condition: { op: "exists", field: "company.industry" } })];
  const summary = buildIcpProfileSummary(config);
  assert.deepEqual(summary.fit.attributes, ["Industry"]);
});

test("buildIcpProfileSummary reports the configured fit and intent bands", () => {
  const config = emptyConfig();
  config.fit.tiers = [
    { code: "not_yet_qualified", minScore: 0 },
    { code: "qualified", minScore: 50 },
  ];
  const summary = buildIcpProfileSummary(config);
  assert.equal(summary.fitBands.length, 2);
  assert.equal(summary.fitBands[1]?.label, "Qualified");
});
