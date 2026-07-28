// Unit tests for eligibility: hard disqualifiers outside weighted
// scoring, restrictions, unknown-does-not-disqualify, and the canonical
// anonymous/company person-addressability restriction.
//
// Run with: tsx --test lib/evaluator/src/rules/eligibility.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEligibility } from "./eligibility.js";
import type { EligibilityConfig } from "../profileConfig.js";

const CONFIG: EligibilityConfig = {
  hardDisqualifiers: [
    {
      id: "dnc",
      description: "Do not contact",
      condition: { op: "eq", field: "doNotContact", value: true },
    },
    {
      id: "competitor",
      description: "Competitor",
      condition: { op: "eq", field: "crm.competitorFlag", value: true },
    },
  ],
  restrictions: [
    {
      id: "open_opp",
      description: "Open opportunity — route to owner instead",
      condition: { op: "eq", field: "crm.openOpportunity", value: true },
    },
  ],
};

test("a matched hard disqualifier => ineligible, regardless of restrictions", () => {
  const result = evaluateEligibility(
    CONFIG,
    {
      doNotContact: true,
      crm: { competitorFlag: false, openOpportunity: true },
    },
    "contact",
  );
  assert.equal(result.outcome, "ineligible");
  assert.equal(result.hardDisqualifiers.length, 1);
  assert.equal(result.hardDisqualifiers[0]!.ruleId, "dnc");
  assert.deepEqual(result.eligibilityRestrictions, []);
});

test("multiple matched hard disqualifiers are all reported", () => {
  const result = evaluateEligibility(
    CONFIG,
    {
      doNotContact: true,
      crm: { competitorFlag: true, openOpportunity: false },
    },
    "contact",
  );
  assert.equal(result.outcome, "ineligible");
  assert.equal(result.hardDisqualifiers.length, 2);
});

test("an unknown hard-disqualifier condition does not silently disqualify", () => {
  const result = evaluateEligibility(
    CONFIG,
    { crm: { openOpportunity: false } },
    "contact",
  );
  // doNotContact and crm.competitorFlag are both absent -> unknown, not
  // matched -> no disqualification from them.
  assert.notEqual(result.outcome, "ineligible");
  assert.deepEqual(result.hardDisqualifiers, []);
  const fields = result.missingInputs.map((m) => m.field);
  assert.ok(fields.includes("doNotContact"));
  assert.ok(fields.includes("crm.competitorFlag"));
});

test("no disqualifier, a matched restriction => restricted", () => {
  const result = evaluateEligibility(
    CONFIG,
    {
      doNotContact: false,
      crm: { competitorFlag: false, openOpportunity: true },
    },
    "contact",
  );
  assert.equal(result.outcome, "restricted");
  assert.equal(result.eligibilityRestrictions.length, 1);
  assert.equal(result.eligibilityRestrictions[0]!.ruleId, "open_opp");
});

test("nothing fires and identity is a real contact => eligible", () => {
  const result = evaluateEligibility(
    CONFIG,
    {
      doNotContact: false,
      crm: { competitorFlag: false, openOpportunity: false },
    },
    "contact",
  );
  assert.equal(result.outcome, "eligible");
  assert.deepEqual(result.eligibilityRestrictions, []);
});

test("canonical restriction is added automatically when identity is anonymous, even with no profile-authored restrictions", () => {
  const emptyConfig: EligibilityConfig = {
    hardDisqualifiers: [],
    restrictions: [],
  };
  const result = evaluateEligibility(emptyConfig, {}, "anonymous");
  assert.equal(result.outcome, "restricted");
  assert.equal(result.eligibilityRestrictions.length, 1);
  assert.equal(
    result.eligibilityRestrictions[0]!.ruleId,
    "canonical.identity_not_person_addressable",
  );
});

test("canonical restriction is added automatically when identity is company", () => {
  const emptyConfig: EligibilityConfig = {
    hardDisqualifiers: [],
    restrictions: [],
  };
  const result = evaluateEligibility(emptyConfig, {}, "company");
  assert.equal(result.outcome, "restricted");
  assert.equal(
    result.eligibilityRestrictions[0]!.ruleId,
    "canonical.identity_not_person_addressable",
  );
});

test("canonical restriction is NOT added when identity is contact or known_crm_contact", () => {
  const emptyConfig: EligibilityConfig = {
    hardDisqualifiers: [],
    restrictions: [],
  };
  assert.equal(
    evaluateEligibility(emptyConfig, {}, "contact").outcome,
    "eligible",
  );
  assert.equal(
    evaluateEligibility(emptyConfig, {}, "known_crm_contact").outcome,
    "eligible",
  );
});

test("eligibility never produces routing/decision-shaped output", () => {
  const result = evaluateEligibility(
    CONFIG,
    { doNotContact: false, crm: {} },
    "contact",
  ) as unknown as Record<string, unknown>;
  for (const forbidden of [
    "routingOutput",
    "channelAvailability",
    "overallDecisionGate",
  ]) {
    assert.equal(forbidden in result, false);
  }
});
