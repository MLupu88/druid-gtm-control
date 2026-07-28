// Unit tests for the evaluator-version registry: unsupported versions
// fail clearly, supported versions dispatch correctly.
//
// Run with: tsx --test lib/evaluator/src/registry.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  UnsupportedEvaluatorVersionError,
  evaluateAccount,
  getEvaluatorImplementation,
  isSupportedEvaluatorVersion,
} from "./registry.js";
import type { IcpProfileConfigV1 } from "./profileConfig.js";
import type { NormalizedAccountInputV1 } from "./types.js";

function minimalSnapshot(): NormalizedAccountInputV1 {
  return {
    schemaVersion: "v1",
    company: {
      domain: null,
      name: null,
      industry: null,
      employeeRange: null,
      revenueRange: null,
      region: "unknown",
      country: null,
    },
    engagement: {
      sources: [],
      pagesVisited: [],
      distinctSourceCount: 0,
      repeatVisit: false,
      lastSeenAt: null,
    },
    contact: null,
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
    source: "test",
  };
}

function minimalProfileConfig(): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

test("isSupportedEvaluatorVersion recognizes canonical-v1 and rejects everything else", () => {
  assert.equal(isSupportedEvaluatorVersion("canonical-v1"), true);
  assert.equal(isSupportedEvaluatorVersion("canonical-v2"), false);
  assert.equal(isSupportedEvaluatorVersion(""), false);
});

test("getEvaluatorImplementation returns a callable for a supported version", () => {
  const implementation = getEvaluatorImplementation("canonical-v1");
  const result = implementation(minimalSnapshot(), minimalProfileConfig());
  assert.equal(result.eligibilityOutcome, "restricted"); // anonymous identity -> canonical restriction
});

test("getEvaluatorImplementation throws UnsupportedEvaluatorVersionError clearly for an unknown version", () => {
  assert.throws(
    () => getEvaluatorImplementation("legacy-icp-03v2"),
    UnsupportedEvaluatorVersionError,
  );
  try {
    getEvaluatorImplementation("legacy-icp-03v2");
    assert.fail("expected getEvaluatorImplementation to throw");
  } catch (error) {
    assert.ok(error instanceof UnsupportedEvaluatorVersionError);
    assert.match(error.message, /legacy-icp-03v2/);
    assert.match(error.message, /canonical-v1/);
  }
});

test("evaluateAccount dispatches to canonical-v1 and returns a real EvaluationResult", () => {
  const result = evaluateAccount({
    normalizedInput: minimalSnapshot(),
    profileConfig: minimalProfileConfig(),
    evaluatorVersion: "canonical-v1",
  });
  assert.equal(result.fitScore, 0);
  assert.equal(result.identityResolutionLevel, "anonymous");
});

test("evaluateAccount rejects an unsupported evaluator version without running any evaluation logic", () => {
  assert.throws(
    () =>
      evaluateAccount({
        normalizedInput: minimalSnapshot(),
        profileConfig: minimalProfileConfig(),
        evaluatorVersion: "not-a-real-version",
      }),
    UnsupportedEvaluatorVersionError,
  );
});
