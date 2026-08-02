// Unit tests for deriveMqlDecisionReadiness — the API-server wrapper that
// decides "official_evaluation_required" / "snapshot_evidence_unknown"
// and derives, per-snapshot, which fields count as evidence-backed for
// the one recognized snapshot source, before delegating everything else
// to @workspace/evaluator's pure evaluateMqlDecisionReadiness.
//
// Run with: tsx --test src/services/mqlDecisionReadiness.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { deriveMqlDecisionReadiness } from "./mqlDecisionReadiness.js";

const READY_INTENT_FREE_CONFIG = {
  configSchemaVersion: "v1",
  fit: {
    rules: [
      {
        id: "fit_domain",
        description: "Has a resolved domain",
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

function completedProductionEvaluation(
  overrides: Partial<{
    status: "completed" | "failed";
    evaluationMode: "preview" | "production";
    profileConfigSnapshot: unknown;
  }> = {},
) {
  return {
    status: "completed" as const,
    evaluationMode: "production" as const,
    profileConfigSnapshot: READY_INTENT_FREE_CONFIG,
    ...overrides,
  };
}

test("official_evaluation_required when evaluation is null", () => {
  const result = deriveMqlDecisionReadiness(null, null);
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["official_evaluation_required"],
  );
});

test("official_evaluation_required when evaluation is a preview", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ evaluationMode: "preview" }),
    { source: "gtm-account-current-state-v1", normalizedInput: {} },
  );
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["official_evaluation_required"],
  );
});

test("official_evaluation_required when evaluation is failed", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ status: "failed" }),
    { source: "gtm-account-current-state-v1", normalizedInput: {} },
  );
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["official_evaluation_required"],
  );
});

test("snapshot_evidence_unknown when the snapshot source is not recognized", () => {
  const result = deriveMqlDecisionReadiness(completedProductionEvaluation(), {
    source: "some-future-vendor-integration-v1",
    normalizedInput: { company: { domain: "acme.com", name: "Acme" } },
  });
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["snapshot_evidence_unknown"],
  );
});

test("throws when evaluation is completed/production but no snapshot is supplied (caller bug, not a readiness state)", () => {
  assert.throws(() =>
    deriveMqlDecisionReadiness(completedProductionEvaluation(), null),
  );
});

test("throws when profileConfigSnapshot fails schema validation", () => {
  assert.throws(() =>
    deriveMqlDecisionReadiness(
      completedProductionEvaluation({
        profileConfigSnapshot: { configSchemaVersion: "v1" },
      }),
      { source: "gtm-account-current-state-v1", normalizedInput: {} },
    ),
  );
});

test("gtm-account-current-state-v1: company.domain counts as evidence-backed when non-blank, resolving a fit rule that references only it", () => {
  const result = deriveMqlDecisionReadiness(completedProductionEvaluation(), {
    source: "gtm-account-current-state-v1",
    normalizedInput: { company: { domain: "acme.com", name: null } },
  });
  // fit resolves (exists on an evidence-backed, non-blank field); intent
  // has zero rules -> intent_not_configured is the only remaining reason.
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["intent_not_configured"],
  );
});

test("gtm-account-current-state-v1: a null company.domain is NOT evidence-backed, even though the source is recognized", () => {
  const result = deriveMqlDecisionReadiness(completedProductionEvaluation(), {
    source: "gtm-account-current-state-v1",
    normalizedInput: { company: { domain: null, name: null } },
  });
  const codes = result.reasons.map((r) => r.code);
  assert.ok(codes.includes("required_condition_unresolved"));
  assert.ok(codes.includes("intent_not_configured"));
});

test("gtm-account-current-state-v1: a whitespace-only company.domain is NOT evidence-backed", () => {
  const result = deriveMqlDecisionReadiness(completedProductionEvaluation(), {
    source: "gtm-account-current-state-v1",
    normalizedInput: { company: { domain: "   ", name: null } },
  });
  assert.ok(
    result.reasons.some((r) => r.code === "required_condition_unresolved"),
  );
});

test("gtm-account-current-state-v1: company.name counts as evidence-backed when non-blank", () => {
  const config = {
    ...READY_INTENT_FREE_CONFIG,
    fit: {
      rules: [
        {
          id: "fit_name",
          description: "Has a resolved name",
          points: 10,
          condition: { op: "exists", field: "company.name" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  };
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ profileConfigSnapshot: config }),
    {
      source: "gtm-account-current-state-v1",
      normalizedInput: { company: { domain: null, name: "Acme Co" } },
    },
  );
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["intent_not_configured"],
  );
});
