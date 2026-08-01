// Tests for ./icp-profile-config-diff.ts — pure draft-vs-active
// comparison logic. No DOM needed.
//
// Run with: tsx --test src/lib/icp-profile-config-diff.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { diffProfileConfigs, profileConfigDiffIsEmpty } from "./icp-profile-config-diff.js";
import { buildStarterProfileConfig } from "./icp-profile-config-editing.js";
import type { IcpProfileConfigV1, WeightedRule, ConditionRule, Tier } from "@workspace/evaluator";

function rule(overrides: Partial<WeightedRule> = {}): WeightedRule {
  return {
    id: "has_domain",
    description: "Has a domain",
    points: 10,
    condition: { op: "exists", field: "company.domain" },
    ...overrides,
  };
}

function condRule(overrides: Partial<ConditionRule> = {}): ConditionRule {
  return {
    id: "competitor",
    description: "Marked as competitor",
    condition: { op: "eq", field: "crm.competitorFlag", value: true },
    ...overrides,
  };
}

function tier(overrides: Partial<Tier> = {}): Tier {
  return { code: "high", minScore: 10, ...overrides };
}

function configWith(overrides: Partial<IcpProfileConfigV1>): IcpProfileConfigV1 {
  const base = buildStarterProfileConfig();
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------
// Identical configs
// ---------------------------------------------------------------------

test("diffProfileConfigs reports no differences for two identical configs", () => {
  const config = buildStarterProfileConfig();
  const diff = diffProfileConfigs(config, config, null, null);
  assert.equal(profileConfigDiffIsEmpty(diff), true);
});

test("identical configs with rules/tiers are still reported as fully unchanged", () => {
  const config = configWith({
    fit: { rules: [rule()], tiers: [{ code: "unscored", minScore: 0 }, tier()] },
  });
  const diff = diffProfileConfigs(config, config, "same notes", "same notes");
  assert.equal(profileConfigDiffIsEmpty(diff), true);
  assert.equal(diff.fit.rules.unchangedCount, 1);
  assert.equal(diff.fit.tiers.unchangedCount, 2);
});

// ---------------------------------------------------------------------
// Added / removed
// ---------------------------------------------------------------------

test("a rule present only in the draft is reported as added", () => {
  const active = buildStarterProfileConfig();
  const draft = configWith({ fit: { rules: [rule()], tiers: active.fit.tiers } });
  const diff = diffProfileConfigs(draft, active, null, null);
  assert.equal(diff.fit.rules.added.length, 1);
  assert.equal(diff.fit.rules.added[0]?.key, "has_domain");
  assert.equal(diff.fit.rules.removed.length, 0);
});

test("a rule present only in the active version is reported as removed", () => {
  const draft = buildStarterProfileConfig();
  const active = configWith({ fit: { rules: [rule()], tiers: draft.fit.tiers } });
  const diff = diffProfileConfigs(draft, active, null, null);
  assert.equal(diff.fit.rules.removed.length, 1);
  assert.equal(diff.fit.rules.removed[0]?.key, "has_domain");
  assert.equal(diff.fit.rules.added.length, 0);
});

// ---------------------------------------------------------------------
// Changed
// ---------------------------------------------------------------------

test("a rule with the same id but different points is reported as changed, listing 'points'", () => {
  const active = configWith({
    fit: { rules: [rule({ points: 5 })], tiers: buildStarterProfileConfig().fit.tiers },
  });
  const draft = configWith({
    fit: { rules: [rule({ points: 10 })], tiers: buildStarterProfileConfig().fit.tiers },
  });
  const diff = diffProfileConfigs(draft, active, null, null);
  assert.equal(diff.fit.rules.changed.length, 1);
  assert.deepEqual(diff.fit.rules.changed[0]?.changedFields, ["points"]);
  assert.equal(diff.fit.rules.changed[0]?.draft?.points, 10);
  assert.equal(diff.fit.rules.changed[0]?.active?.points, 5);
});

test("a rule with a changed description AND condition lists both changed fields", () => {
  const tiers = buildStarterProfileConfig().fit.tiers;
  const active = configWith({
    fit: {
      rules: [rule({ description: "old", condition: { op: "exists", field: "company.domain" } })],
      tiers,
    },
  });
  const draft = configWith({
    fit: {
      rules: [
        rule({ description: "new", condition: { op: "exists", field: "company.industry" } }),
      ],
      tiers,
    },
  });
  const diff = diffProfileConfigs(draft, active, null, null);
  assert.deepEqual(diff.fit.rules.changed[0]?.changedFields.sort(), ["condition", "description"]);
});

test("a condition-only rule (eligibility) changed field never includes 'points'", () => {
  const active = configWith({
    eligibility: {
      hardDisqualifiers: [condRule({ description: "old" })],
      restrictions: [],
    },
  });
  const draft = configWith({
    eligibility: {
      hardDisqualifiers: [condRule({ description: "new" })],
      restrictions: [],
    },
  });
  const diff = diffProfileConfigs(draft, active, null, null);
  assert.deepEqual(diff.eligibility.hardDisqualifiers.changed[0]?.changedFields, ["description"]);
});

// ---------------------------------------------------------------------
// Reordering must never be treated as removal + addition
// ---------------------------------------------------------------------

test("reordering rules (same ids, different array order) produces zero added/removed/changed", () => {
  const ruleA = rule({ id: "rule_a" });
  const ruleB = rule({ id: "rule_b" });
  const tiers = buildStarterProfileConfig().fit.tiers;
  const active = configWith({ fit: { rules: [ruleA, ruleB], tiers } });
  const draft = configWith({ fit: { rules: [ruleB, ruleA], tiers } }); // reversed order

  const diff = diffProfileConfigs(draft, active, null, null);
  assert.equal(diff.fit.rules.added.length, 0);
  assert.equal(diff.fit.rules.removed.length, 0);
  assert.equal(diff.fit.rules.changed.length, 0);
  assert.equal(diff.fit.rules.unchangedCount, 2);
});

test("reordering tiers (same codes, different array order) produces zero added/removed/changed", () => {
  const tierA = tier({ code: "high", minScore: 10 });
  const tierB = tier({ code: "medium", minScore: 5 });
  const floor: Tier = { code: "unscored", minScore: 0 };
  const active = configWith({ fit: { rules: [], tiers: [floor, tierA, tierB] } });
  const draft = configWith({ fit: { rules: [], tiers: [tierB, floor, tierA] } });

  const diff = diffProfileConfigs(draft, active, null, null);
  assert.equal(diff.fit.tiers.added.length, 0);
  assert.equal(diff.fit.tiers.removed.length, 0);
  assert.equal(diff.fit.tiers.changed.length, 0);
  assert.equal(diff.fit.tiers.unchangedCount, 3);
});

// ---------------------------------------------------------------------
// Tiers matched by code, not id
// ---------------------------------------------------------------------

test("a tier with the same code but a different minScore is reported as changed", () => {
  const active = configWith({ fit: { rules: [], tiers: [{ code: "high", minScore: 10 }] } });
  const draft = configWith({ fit: { rules: [], tiers: [{ code: "high", minScore: 20 }] } });
  const diff = diffProfileConfigs(draft, active, null, null);
  assert.equal(diff.fit.tiers.changed.length, 1);
  assert.deepEqual(diff.fit.tiers.changed[0]?.changedFields, ["minScore"]);
});

test("a tier code that only exists in one side is added/removed, not matched to an unrelated code", () => {
  const active = configWith({ fit: { rules: [], tiers: [{ code: "high", minScore: 10 }] } });
  const draft = configWith({ fit: { rules: [], tiers: [{ code: "warm", minScore: 10 }] } });
  const diff = diffProfileConfigs(draft, active, null, null);
  assert.equal(diff.fit.tiers.added.length, 1);
  assert.equal(diff.fit.tiers.added[0]?.key, "warm");
  assert.equal(diff.fit.tiers.removed.length, 1);
  assert.equal(diff.fit.tiers.removed[0]?.key, "high");
});

// ---------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------

test("notes diff reports changed when the strings differ", () => {
  const config = buildStarterProfileConfig();
  const diff = diffProfileConfigs(config, config, "draft notes", "active notes");
  assert.equal(diff.notes.changed, true);
});

test("notes diff treats null and empty string as equivalent (both mean 'no notes')", () => {
  const config = buildStarterProfileConfig();
  const diff = diffProfileConfigs(config, config, null, "");
  assert.equal(diff.notes.changed, false);
});

// ---------------------------------------------------------------------
// profileConfigDiffIsEmpty
// ---------------------------------------------------------------------

test("profileConfigDiffIsEmpty is false when only notes differ", () => {
  const config = buildStarterProfileConfig();
  const diff = diffProfileConfigs(config, config, "changed", null);
  assert.equal(profileConfigDiffIsEmpty(diff), false);
});

test("profileConfigDiffIsEmpty is false when only eligibility differs", () => {
  const active = buildStarterProfileConfig();
  const draft = configWith({
    eligibility: { hardDisqualifiers: [condRule()], restrictions: [] },
  });
  const diff = diffProfileConfigs(draft, active, null, null);
  assert.equal(profileConfigDiffIsEmpty(diff), false);
});
