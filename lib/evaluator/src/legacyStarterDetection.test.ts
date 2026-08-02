// Tests for ./legacyStarterDetection.ts. No I/O needed.
//
// Run with: tsx --test src/legacyStarterDetection.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import { isLegacyStarterIcpConfig } from "./legacyStarterDetection.js";

function legacyStarterConfig(): unknown {
  return {
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
}

test("detects the exact legacy Starter ICP signature", () => {
  assert.equal(isLegacyStarterIcpConfig(legacyStarterConfig()), true);
});

test("is insensitive to the rule's own id/description text — only the structural signature matters", () => {
  const config = legacyStarterConfig() as any;
  config.fit.rules[0].id = "some_other_id";
  config.fit.rules[0].description = "Different description";
  assert.equal(isLegacyStarterIcpConfig(config), true);
});

test("does NOT flag a profile with a different points value on the same rule", () => {
  const config = legacyStarterConfig() as any;
  config.fit.rules[0].points = 20;
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with an extra fit rule alongside the legacy one", () => {
  const config = legacyStarterConfig() as any;
  config.fit.rules.push({
    id: "real_rule",
    description: "Industry match",
    points: 15,
    condition: { op: "in", field: "company.industry", values: ["Banking"] },
  });
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with a different fit condition field", () => {
  const config = legacyStarterConfig() as any;
  config.fit.rules[0].condition = { op: "exists", field: "company.name" };
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with a different operator/value on the same field, even at the same points value", () => {
  const config = legacyStarterConfig() as any;
  config.fit.rules[0].condition = { op: "eq", field: "company.domain", value: "example.com" };
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile whose condition carries an extra key alongside the exact op/field (a structurally different condition, e.g. a stray value)", () => {
  const config = legacyStarterConfig() as any;
  config.fit.rules[0].condition = { op: "exists", field: "company.domain", value: "unused" };
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with renamed fallback band codes", () => {
  const config = legacyStarterConfig() as any;
  config.fit.tiers[0].code = "unqualified";
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with a different fit band threshold (minScore), even with the same code", () => {
  const config = legacyStarterConfig() as any;
  config.fit.tiers[0].minScore = 5;
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with a different intent band threshold (minScore), even with the same code", () => {
  const config = legacyStarterConfig() as any;
  config.intent.tiers[0].minScore = 1;
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile whose fallback behavior differs — an extra band alongside the exact fallback means a real account could now resolve somewhere other than the fallback", () => {
  const config = legacyStarterConfig() as any;
  config.fit.tiers.push({ code: "qualified", minScore: 50 });
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile that has real intent rules configured", () => {
  const config = legacyStarterConfig() as any;
  config.intent.rules.push({
    id: "recent_visit",
    description: "Visited recently",
    points: 10,
    condition: { op: "exists", field: "engagement.lastSeenAt" },
  });
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with a real restriction configured", () => {
  const config = legacyStarterConfig() as any;
  config.eligibility.restrictions.push({
    id: "restriction_1",
    description: "Existing customer",
    condition: { op: "eq", field: "crm.existingCustomer", value: true },
  });
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with a real hard disqualifier configured", () => {
  const config = legacyStarterConfig() as any;
  config.eligibility.hardDisqualifiers.push({
    id: "disqualifier_1",
    description: "Competitor",
    condition: { op: "eq", field: "crm.competitorFlag", value: true },
  });
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("does NOT flag a profile with an extra actionability rule configured", () => {
  const config = legacyStarterConfig() as any;
  config.actionability.rules.push({
    id: "has_email",
    description: "Has a contact email",
    points: 10,
    condition: { op: "exists", field: "contact.email" },
  });
  assert.equal(isLegacyStarterIcpConfig(config), false);
});

test("a similarly-named but meaningfully different profile (e.g. a real starter-like profile with real criteria) is never falsely detected", () => {
  const realProfile = {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "industry_match",
          description: "Target industry",
          points: 20,
          condition: { op: "in", field: "company.industry", values: ["Banking", "Insurance"] },
        },
      ],
      tiers: [{ code: "not_yet_qualified", minScore: 0 }, { code: "qualified", minScore: 20 }],
    },
    intent: { rules: [], tiers: [{ code: "no_observed_intent", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
  assert.equal(isLegacyStarterIcpConfig(realProfile), false);
});

test("truthful new-profile starter config (empty rules, honest fallback labels) is never falsely detected as the legacy signature", () => {
  const newStarter = {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "not_yet_qualified", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "no_observed_intent", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
  assert.equal(isLegacyStarterIcpConfig(newStarter), false);
});

test("is defensively false for genuinely unknown/malformed config shapes, never a guess", () => {
  assert.equal(isLegacyStarterIcpConfig(null), false);
  assert.equal(isLegacyStarterIcpConfig(undefined), false);
  assert.equal(isLegacyStarterIcpConfig("not an object"), false);
  assert.equal(isLegacyStarterIcpConfig({}), false);
  assert.equal(isLegacyStarterIcpConfig({ fit: {} }), false);
});
