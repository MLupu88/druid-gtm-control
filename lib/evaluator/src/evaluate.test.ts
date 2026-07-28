// Integration tests for the canonical-v1 pure orchestrator: full
// end-to-end shape, deterministic repeat-run equality, and cross-
// dimension missing-input deduplication.
//
// Run with: tsx --test lib/evaluator/src/evaluate.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCanonicalV1 } from "./evaluate.js";
import type { IcpProfileConfigV1 } from "./profileConfig.js";
import type { NormalizedAccountInputV1 } from "./types.js";

function syntheticProfileConfig(): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "matches_synthetic_domain",
          description: "Domain matches the synthetic target domain",
          points: 10,
          condition: {
            op: "eq",
            field: "company.domain",
            value: "synthetic-example.test",
          },
        },
        {
          id: "target_industry",
          description: "Synthetic target industry",
          points: 20,
          condition: {
            op: "eq",
            field: "company.industry",
            value: "SyntheticIndustry",
          },
        },
      ],
      tiers: [
        { code: "low", minScore: 0 },
        { code: "high", minScore: 20 },
      ],
    },
    intent: {
      rules: [
        {
          id: "multi_source",
          description: "3+ sources",
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
        { code: "hot", minScore: 15 },
      ],
    },
    actionability: {
      rules: [
        {
          id: "has_email",
          description: "Has email",
          points: 10,
          condition: { op: "exists", field: "contact.email" },
        },
      ],
    },
    eligibility: {
      hardDisqualifiers: [
        {
          id: "dnc",
          description: "Do not contact",
          condition: { op: "eq", field: "doNotContact", value: true },
        },
      ],
      // Deliberately references company.domain too (a different target
      // value than fit's rule above), so a snapshot missing that field
      // produces a missing-input entry that overlaps with fit's own
      // reference to the same field. With the normal snapshot's domain
      // ("synthetic-example.test"), this does NOT match
      // "manual-review.test", so it correctly evaluates to no_match, not
      // a false restriction.
      restrictions: [
        {
          id: "flagged_for_manual_review",
          description: "Domain matches the manual-review flag domain",
          condition: {
            op: "eq",
            field: "company.domain",
            value: "manual-review.test",
          },
        },
      ],
    },
  };
}

function syntheticSnapshot(
  overrides: Partial<NormalizedAccountInputV1> = {},
): NormalizedAccountInputV1 {
  return {
    schemaVersion: "v1",
    company: {
      domain: "synthetic-example.test",
      name: "Synthetic Example Co",
      industry: null, // deliberately absent -> unknown for the fit "target_industry" rule
      employeeRange: null,
      revenueRange: null,
      region: "unknown",
      country: null,
    },
    engagement: {
      sources: ["synthetic"],
      pagesVisited: [],
      distinctSourceCount: 3,
      repeatVisit: false,
      lastSeenAt: null,
    },
    contact: {
      name: null,
      email: "synthetic@example.test",
      phone: null,
      title: null,
      linkedinUrl: null,
      origin: "form_submit",
    },
    crm: {
      hubspotCompanyId: null,
      hubspotContactId: null,
      hubspotOwner: null,
      openOpportunity: false,
      existingCustomer: false,
      competitorFlag: false,
      partnerFlag: false,
    },
    doNotContact: false,
    consent: {
      email: "unknown",
      call: "unknown",
      liBasisCleared: "unknown",
      dpoVoiceCleared: "unknown",
    },
    source: "synthetic-test",
    ...overrides,
  };
}

test("produces every required output field for a completed evaluation", () => {
  const result = evaluateCanonicalV1(
    syntheticSnapshot(),
    syntheticProfileConfig(),
  );
  for (const key of [
    "fitScore",
    "fitTier",
    "intentScore",
    "intentTier",
    "identityResolutionLevel",
    "identityConfidence",
    "actionabilityScore",
    "eligibilityOutcome",
    "scoreComponents",
    "matchedRules",
    "missingInputs",
    "hardDisqualifiers",
    "eligibilityRestrictions",
  ]) {
    assert.ok(key in result, `missing required output field "${key}"`);
  }
});

test("never produces routing/decision-shaped output", () => {
  const result = evaluateCanonicalV1(
    syntheticSnapshot(),
    syntheticProfileConfig(),
  ) as unknown as Record<string, unknown>;
  for (const forbidden of [
    "routingOutput",
    "routingReason",
    "channelAvailability",
    "overallDecisionGate",
    "recommendedAction",
  ]) {
    assert.equal(forbidden in result, false, `must not produce ${forbidden}`);
  }
});

test("identical inputs, config, and evaluator implementation produce a deeply identical result on every run", () => {
  const snapshot = syntheticSnapshot();
  const config = syntheticProfileConfig();
  const first = evaluateCanonicalV1(snapshot, config);
  const second = evaluateCanonicalV1(snapshot, config);
  const third = evaluateCanonicalV1(
    structuredClone(snapshot),
    structuredClone(config),
  );
  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
});

test("with the normal snapshot domain, the eligibility manual-review restriction correctly does not fire", () => {
  const result = evaluateCanonicalV1(
    syntheticSnapshot(),
    syntheticProfileConfig(),
  );
  assert.equal(result.eligibilityOutcome, "eligible");
  assert.deepEqual(result.eligibilityRestrictions, []);
});

test("missing input referenced by two different dimensions (via scalar comparisons) is deduplicated into one entry with both dimensions listed", () => {
  // company.domain is referenced by BOTH fit's "matches_synthetic_domain"
  // eq rule and eligibility's "flagged_for_manual_review" eq rule. With
  // domain absent, both comparisons are unknown (eq against an absent
  // field is unknown, never a guessed false) and should report it as
  // missing, merged into a single entry.
  const snapshot = syntheticSnapshot({
    company: {
      domain: null,
      name: "Synthetic Example Co",
      industry: null,
      employeeRange: null,
      revenueRange: null,
      region: "unknown",
      country: null,
    },
  });
  const result = evaluateCanonicalV1(snapshot, syntheticProfileConfig());
  const domainEntry = result.missingInputs.find(
    (entry) => entry.field === "company.domain",
  );
  assert.ok(
    domainEntry,
    "company.domain should be reported as a missing input",
  );
  assert.deepEqual(domainEntry!.affects, ["eligibility", "fit"]);
  // Only ONE entry for this field, not two.
  assert.equal(
    result.missingInputs.filter((entry) => entry.field === "company.domain")
      .length,
    1,
  );
});

test("missingInputs is deterministically sorted", () => {
  const snapshot = syntheticSnapshot({
    company: {
      domain: null,
      name: null,
      industry: null,
      employeeRange: null,
      revenueRange: null,
      region: "unknown",
      country: null,
    },
  });
  const result = evaluateCanonicalV1(snapshot, syntheticProfileConfig());
  const fields = result.missingInputs.map((entry) => entry.field);
  assert.deepEqual(fields, [...fields].sort());
});

test("identity matched-rule provenance is included alongside fit/intent/actionability matched rules", () => {
  const result = evaluateCanonicalV1(
    syntheticSnapshot(),
    syntheticProfileConfig(),
  );
  const identityRule = result.matchedRules.find(
    (r) => r.dimension === "identity",
  );
  assert.ok(identityRule, "identity provenance should appear in matchedRules");
});

test("a hard disqualifier match short-circuits to ineligible, and eligibility restrictions are not also reported", () => {
  const snapshot = syntheticSnapshot({ doNotContact: true });
  const result = evaluateCanonicalV1(snapshot, syntheticProfileConfig());
  assert.equal(result.eligibilityOutcome, "ineligible");
  assert.equal(result.hardDisqualifiers.length, 1);
  assert.deepEqual(result.eligibilityRestrictions, []);
});
