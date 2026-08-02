// Unit tests for deriveMqlDecisionReadiness — the API-server wrapper that
// decides "official_evaluation_required" / "snapshot_evidence_unknown"
// and derives, per-snapshot, which fields count as evidence-backed for
// each recognized snapshot source, before delegating everything else to
// @workspace/evaluator's pure evaluateMqlDecisionReadiness.
//
// Run with: tsx --test src/services/mqlDecisionReadiness.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { deriveMqlDecisionReadiness } from "./mqlDecisionReadiness.js";
import { ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION } from "./accountFactsSnapshotEvidence.js";

const SYNTHETIC_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "99999999-9999-4999-8999-999999999999";

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

// Fit rule referencing company.industry, worth points — the field Slice 1
// manual facts exist to resolve. Intent stays empty (worth-zero rules
// never count), so intent_not_configured is always the "everything else
// is fine" baseline reason throughout this file's v2 tests, exactly as
// Unit 1 requires: manual company facts can resolve fit, never intent.
const INDUSTRY_FIT_CONFIG = {
  configSchemaVersion: "v1",
  fit: {
    rules: [
      {
        id: "fit_industry",
        description: "Industry is Banking",
        points: 10,
        condition: { op: "eq", field: "company.industry", value: "Banking" },
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

function v1Snapshot(overrides: {
  source?: string;
  normalizedInput?: unknown;
} = {}) {
  return {
    accountId: SYNTHETIC_ACCOUNT_ID,
    source: "gtm-account-current-state-v1",
    rawInput: {},
    normalizedInput: {},
    ...overrides,
  };
}

function validManualFactEvidenceEntry(overrides: Record<string, unknown> = {}) {
  return {
    field: "company.industry",
    value: "Banking",
    accountFactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    source: "manual-operator-v1",
    recordedBy: "operator@example.com",
    observedAt: "2026-01-01T00:00:00.000Z",
    recordedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function v2Snapshot(options: {
  accountId?: string;
  identity?: unknown[];
  evidence?: unknown[];
  normalizedInput?: unknown;
  rawInputOverride?: unknown;
} = {}) {
  const {
    accountId = SYNTHETIC_ACCOUNT_ID,
    identity = [],
    evidence = [validManualFactEvidenceEntry()],
    normalizedInput = { company: { industry: "Banking" } },
    rawInputOverride,
  } = options;

  return {
    accountId,
    source: "gtm-account-current-state-v2",
    rawInput:
      rawInputOverride ?? {
        schemaVersion: ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
        account: { id: accountId },
        identity,
        evidence,
      },
    normalizedInput,
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
    v1Snapshot(),
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
    v1Snapshot(),
  );
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["official_evaluation_required"],
  );
});

test("snapshot_evidence_unknown when the snapshot source is not recognized", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation(),
    v1Snapshot({
      source: "some-future-vendor-integration-v1",
      normalizedInput: { company: { domain: "acme.com", name: "Acme" } },
    }),
  );
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
      v1Snapshot(),
    ),
  );
});

// ---------------------------------------------------------------------
// gtm-account-current-state-v1 — unchanged behavior.
// ---------------------------------------------------------------------

test("gtm-account-current-state-v1: company.domain counts as evidence-backed when non-blank, resolving a fit rule that references only it", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation(),
    v1Snapshot({
      normalizedInput: { company: { domain: "acme.com", name: null } },
    }),
  );
  // fit resolves (exists on an evidence-backed, non-blank field); intent
  // has zero rules -> intent_not_configured is the only remaining reason.
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["intent_not_configured"],
  );
});

test("gtm-account-current-state-v1: a null company.domain is NOT evidence-backed, even though the source is recognized", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation(),
    v1Snapshot({
      normalizedInput: { company: { domain: null, name: null } },
    }),
  );
  const codes = result.reasons.map((r) => r.code);
  assert.ok(codes.includes("required_condition_unresolved"));
  assert.ok(codes.includes("intent_not_configured"));
});

test("gtm-account-current-state-v1: a whitespace-only company.domain is NOT evidence-backed", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation(),
    v1Snapshot({
      normalizedInput: { company: { domain: "   ", name: null } },
    }),
  );
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
    v1Snapshot({
      normalizedInput: { company: { domain: null, name: "Acme Co" } },
    }),
  );
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["intent_not_configured"],
  );
});

// ---------------------------------------------------------------------
// gtm-account-current-state-v2 — evidence derives only from the
// validated envelope, matched against normalizedInput; never from
// normalizedInput value presence alone.
// ---------------------------------------------------------------------

test("gtm-account-current-state-v2: a confirmed company.industry fact resolves the fit rule that references it; intent stays unresolved", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ profileConfigSnapshot: INDUSTRY_FIT_CONFIG }),
    v2Snapshot(),
  );
  // Manual company facts improve fit evidence only — intent has zero
  // configured rules, so intent_not_configured must always remain, and
  // MQL readiness must never become true from fit evidence alone.
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["intent_not_configured"],
  );
});

test("gtm-account-current-state-v2: a field with no matching envelope entry is NOT evidence-backed even though normalizedInput sets it to a non-null value", () => {
  // Re-proves the fix: evidence must never be derived from
  // normalizedInput value presence. company.employeeRange is non-null in
  // normalizedInput but has NO corresponding envelope entry.
  const config = {
    ...INDUSTRY_FIT_CONFIG,
    fit: {
      rules: [
        {
          id: "fit_employee_range",
          description: "Employee range is 51-200",
          points: 10,
          condition: { op: "eq", field: "company.employeeRange", value: "51-200" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
  };
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ profileConfigSnapshot: config }),
    v2Snapshot({
      evidence: [], // no fact confirmed for company.employeeRange
      normalizedInput: { company: { employeeRange: "51-200" } }, // present anyway
    }),
  );
  assert.ok(
    result.reasons.some(
      (r) => r.code === "required_condition_unresolved" && r.dimension === "fit",
    ),
  );
});

test("gtm-account-current-state-v2: an evidence value differing from normalizedInput produces snapshot_evidence_unknown, not ordinary missing evidence", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ profileConfigSnapshot: INDUSTRY_FIT_CONFIG }),
    v2Snapshot({
      evidence: [validManualFactEvidenceEntry({ value: "Banking" })],
      normalizedInput: { company: { industry: "Insurance" } }, // disagrees
    }),
  );
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["snapshot_evidence_unknown"],
  );
});

test("gtm-account-current-state-v2: an envelope account id differing from the snapshot's own accountId produces snapshot_evidence_unknown", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ profileConfigSnapshot: INDUSTRY_FIT_CONFIG }),
    v2Snapshot({
      accountId: SYNTHETIC_ACCOUNT_ID,
      rawInputOverride: {
        schemaVersion: ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
        account: { id: OTHER_ACCOUNT_ID },
        identity: [],
        evidence: [validManualFactEvidenceEntry()],
      },
    }),
  );
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["snapshot_evidence_unknown"],
  );
});

test("gtm-account-current-state-v2: a malformed envelope (fails schema validation) produces snapshot_evidence_unknown", () => {
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ profileConfigSnapshot: INDUSTRY_FIT_CONFIG }),
    v2Snapshot({
      rawInputOverride: { schemaVersion: "not-a-real-version" },
    }),
  );
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["snapshot_evidence_unknown"],
  );
});

test("gtm-account-current-state-v2: confirmed company.domain/name identity evidence resolves fit rules referencing them, matching v1's behavior for those two fields", () => {
  const config = {
    ...INDUSTRY_FIT_CONFIG,
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
  };
  const result = deriveMqlDecisionReadiness(
    completedProductionEvaluation({ profileConfigSnapshot: config }),
    v2Snapshot({
      identity: [
        { field: "company.domain", value: "acme.com", source: "account-record-v1" },
      ],
      evidence: [],
      normalizedInput: { company: { domain: "acme.com" } },
    }),
  );
  assert.deepEqual(
    result.reasons.map((r) => r.code),
    ["intent_not_configured"],
  );
});
