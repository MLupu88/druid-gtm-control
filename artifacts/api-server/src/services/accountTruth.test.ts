// Milestone 3H — unit tests for accountTruth.ts's pure DTO-shaping
// (toFieldDTO). No DB — synthetic ReconciliationResult + evidence lookup
// in, AccountTruthFieldDTO out. Run with:
//   tsx --test src/services/accountTruth.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { ReconciliationResult } from "./factReconciliation.js";
import { toFieldDTO, type ResolvedEvidenceDTO } from "./accountTruth.js";

const OBSERVATION_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const MANUAL_FACT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const COMPUTED_AT = "2026-08-22T00:00:00.000Z";

const OBSERVATION_DTO: ResolvedEvidenceDTO = {
  kind: "observation",
  id: OBSERVATION_ID,
  provider: "hubspot",
  value: "Software",
  observedAt: null,
  importedAt: "2026-08-20T00:00:00.000Z",
  displayName: null,
};
const MANUAL_DTO: ResolvedEvidenceDTO = {
  kind: "manual_account_fact",
  id: MANUAL_FACT_ID,
  value: "Software",
  recordedBy: "operator@example.com",
  observedAt: "2026-08-19T00:00:00.000Z",
};

function result(overrides: Partial<ReconciliationResult> = {}): ReconciliationResult {
  return {
    state: "single_source",
    canonicalValue: "Software",
    selectedEvidence: { kind: "observation", id: OBSERVATION_ID },
    supportingEvidence: [{ kind: "observation", id: OBSERVATION_ID }],
    conflictingEvidence: [],
    consideredEvidence: [{ kind: "observation", id: OBSERVATION_ID }],
    policyVersion: "fact-reconciliation-policy-v1",
    rationale: "single hubspot observation available",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 2. single_source display DTO
// ---------------------------------------------------------------------
test("single_source: canonical value + selected/supporting evidence resolved", () => {
  const lookup = new Map<string, ResolvedEvidenceDTO>([
    [`observation:${OBSERVATION_ID}`, OBSERVATION_DTO],
  ]);
  const dto = toFieldDTO("company.industry", result(), lookup, COMPUTED_AT);

  assert.equal(dto.resolutionState, "single_source");
  assert.equal(dto.canonicalValue, "Software");
  assert.deepEqual(dto.selectedEvidence, OBSERVATION_DTO);
  assert.deepEqual(dto.supportingEvidence, [OBSERVATION_DTO]);
  assert.deepEqual(dto.conflictingEvidence, []);
  assert.equal(dto.computedAt, COMPUTED_AT);
});

// ---------------------------------------------------------------------
// 3. agreement display DTO with multiple supporting sources
// ---------------------------------------------------------------------
test("agreement: multiple supporting sources all resolved", () => {
  const dealfrontDto: ResolvedEvidenceDTO = {
    kind: "observation",
    id: "cccccccc-0000-4000-8000-000000000003",
    provider: "dealfront",
    value: "Software",
    observedAt: null,
    importedAt: "2026-08-20T00:00:00.000Z",
    displayName: null,
  };
  const lookup = new Map<string, ResolvedEvidenceDTO>([
    [`observation:${OBSERVATION_ID}`, OBSERVATION_DTO],
    [`observation:${dealfrontDto.id}`, dealfrontDto],
  ]);
  const dto = toFieldDTO(
    "company.industry",
    result({
      state: "agreement",
      selectedEvidence: { kind: "observation", id: OBSERVATION_ID },
      supportingEvidence: [
        { kind: "observation", id: OBSERVATION_ID },
        { kind: "observation", id: dealfrontDto.id },
      ],
      rationale: "2 candidates materially agree",
    }),
    lookup,
    COMPUTED_AT,
  );

  assert.equal(dto.resolutionState, "agreement");
  assert.equal(dto.supportingEvidence.length, 2);
  assert.ok(dto.supportingEvidence.some((e) => e.kind === "observation" && e.provider === "hubspot"));
  assert.ok(dto.supportingEvidence.some((e) => e.kind === "observation" && e.provider === "dealfront"));
});

// ---------------------------------------------------------------------
// 4. conflict with winner exposes selected + conflicting evidence
// ---------------------------------------------------------------------
test("conflict with a justified winner exposes the winner as selected AND the loser as conflicting", () => {
  const lookup = new Map<string, ResolvedEvidenceDTO>([
    [`manual_account_fact:${MANUAL_FACT_ID}`, MANUAL_DTO],
    [`observation:${OBSERVATION_ID}`, { ...OBSERVATION_DTO, value: "SaaS" }],
  ]);
  const dto = toFieldDTO(
    "company.industry",
    result({
      state: "conflict",
      canonicalValue: "Software",
      selectedEvidence: { kind: "manual_account_fact", id: MANUAL_FACT_ID },
      supportingEvidence: [{ kind: "manual_account_fact", id: MANUAL_FACT_ID }],
      conflictingEvidence: [{ kind: "observation", id: OBSERVATION_ID }],
      rationale: "current manual account_fact is highest authority for company.industry",
    }),
    lookup,
    COMPUTED_AT,
  );

  assert.equal(dto.resolutionState, "conflict");
  assert.equal(dto.canonicalValue, "Software");
  assert.deepEqual(dto.selectedEvidence, MANUAL_DTO);
  assert.equal(dto.conflictingEvidence.length, 1);
  assert.equal(dto.conflictingEvidence[0]?.kind, "observation");
  assert.match(dto.rationale, /highest authority/);
});

// ---------------------------------------------------------------------
// 5. conflict without winner exposes null canonical value + conflicting
// evidence (never fabricated).
// ---------------------------------------------------------------------
test("conflict with no winner: canonical value is null, no selected evidence, conflicting evidence still resolved", () => {
  const otherObservationId = "dddddddd-0000-4000-8000-000000000004";
  const lookup = new Map<string, ResolvedEvidenceDTO>([
    [`observation:${OBSERVATION_ID}`, OBSERVATION_DTO],
    [
      `observation:${otherObservationId}`,
      { ...OBSERVATION_DTO, id: otherObservationId, provider: "cognism", value: "SaaS" },
    ],
  ]);
  const dto = toFieldDTO(
    "crm.owner",
    result({
      state: "conflict",
      canonicalValue: null,
      selectedEvidence: null,
      supportingEvidence: [],
      conflictingEvidence: [
        { kind: "observation", id: OBSERVATION_ID },
        { kind: "observation", id: otherObservationId },
      ],
      rationale: "conflicting values for crm.owner; no source-authority or defensible-recency winner could be justified",
    }),
    lookup,
    COMPUTED_AT,
  );

  assert.equal(dto.resolutionState, "conflict");
  assert.equal(dto.canonicalValue, null);
  assert.equal(dto.selectedEvidence, null);
  assert.equal(dto.conflictingEvidence.length, 2);
});

// ---------------------------------------------------------------------
// 6. unresolved (zero evidence) vs unresolved (non-comparable evidence)
// remain distinguishable via rationale/considered evidence, even though
// resolutionState is the same string.
// ---------------------------------------------------------------------
test("unresolved with zero evidence: empty considered/supporting/conflicting, generic rationale", () => {
  const dto = toFieldDTO(
    "crm.openOpportunity",
    result({
      state: "unresolved",
      canonicalValue: null,
      selectedEvidence: null,
      supportingEvidence: [],
      conflictingEvidence: [],
      consideredEvidence: [],
      rationale: "no candidate evidence available",
    }),
    new Map(),
    COMPUTED_AT,
  );
  assert.equal(dto.resolutionState, "unresolved");
  assert.equal(dto.canonicalValue, null);
  assert.match(dto.rationale, /no candidate evidence available/);
});

test("unresolved due to non-comparable raw-vs-band representations: rationale distinguishes it from zero evidence", () => {
  const dto = toFieldDTO(
    "company.employeeRange",
    result({
      state: "unresolved",
      canonicalValue: null,
      selectedEvidence: null,
      supportingEvidence: [],
      conflictingEvidence: [],
      rationale:
        "multiple differing representations for company.employeeRange; no repository-defined normalization exists to prove equivalence",
    }),
    new Map(),
    COMPUTED_AT,
  );
  assert.equal(dto.resolutionState, "unresolved");
  assert.match(dto.rationale, /no repository-defined normalization/);
});

// ---------------------------------------------------------------------
// 7 / 8. manual vs observation evidence resolve to distinct,
// human-readable shapes.
// ---------------------------------------------------------------------
test("manual_account_fact evidence resolves to recordedBy + observedAt (no provider field)", () => {
  const lookup = new Map<string, ResolvedEvidenceDTO>([
    [`manual_account_fact:${MANUAL_FACT_ID}`, MANUAL_DTO],
  ]);
  const dto = toFieldDTO(
    "company.industry",
    result({ selectedEvidence: { kind: "manual_account_fact", id: MANUAL_FACT_ID } }),
    lookup,
    COMPUTED_AT,
  );
  assert.equal(dto.selectedEvidence?.kind, "manual_account_fact");
  if (dto.selectedEvidence?.kind === "manual_account_fact") {
    assert.equal(dto.selectedEvidence.recordedBy, "operator@example.com");
    assert.equal(dto.selectedEvidence.observedAt, "2026-08-19T00:00:00.000Z");
  }
});

test("observation evidence resolves to provider + observedAt/importedAt", () => {
  const lookup = new Map<string, ResolvedEvidenceDTO>([
    [`observation:${OBSERVATION_ID}`, OBSERVATION_DTO],
  ]);
  const dto = toFieldDTO("company.industry", result(), lookup, COMPUTED_AT);
  assert.equal(dto.selectedEvidence?.kind, "observation");
  if (dto.selectedEvidence?.kind === "observation") {
    assert.equal(dto.selectedEvidence.provider, "hubspot");
    assert.equal(dto.selectedEvidence.importedAt, "2026-08-20T00:00:00.000Z");
    assert.equal(dto.selectedEvidence.observedAt, null);
  }
});

// ---------------------------------------------------------------------
// 9. an evidence reference missing from the lookup fails safely.
// ---------------------------------------------------------------------
test("a reference absent from the evidence lookup degrades to {kind: 'unknown'}, never a throw or fabricated value", () => {
  const dto = toFieldDTO("company.industry", result(), new Map(), COMPUTED_AT);
  assert.deepEqual(dto.selectedEvidence, { kind: "unknown", id: OBSERVATION_ID });
  assert.deepEqual(dto.supportingEvidence, [{ kind: "unknown", id: OBSERVATION_ID }]);
  assert.equal(dto.canonicalDisplayValue, null);
});

// ---------------------------------------------------------------------
// M3.5 real-data defect fix: canonicalDisplayValue mirrors the selected
// evidence's own resolved displayName (e.g. crm.owner's stable id paired
// with the owner's real name, captured during HubSpot ingestion — see
// ../services/hubSpotCompanySync.ts) without ever mutating canonicalValue
// itself.
// ---------------------------------------------------------------------
test("canonicalDisplayValue mirrors the selected observation's resolved displayName", () => {
  const ownerObservationId = "ffffffff-0000-4000-8000-000000000006";
  const lookup = new Map<string, ResolvedEvidenceDTO>([
    [
      `observation:${ownerObservationId}`,
      {
        kind: "observation",
        id: ownerObservationId,
        provider: "hubspot",
        value: "89684655",
        observedAt: null,
        importedAt: "2026-08-20T00:00:00.000Z",
        displayName: "Mark van der Ree",
      },
    ],
  ]);
  const dto = toFieldDTO(
    "crm.owner",
    result({
      canonicalValue: "89684655",
      selectedEvidence: { kind: "observation", id: ownerObservationId },
      supportingEvidence: [{ kind: "observation", id: ownerObservationId }],
      consideredEvidence: [{ kind: "observation", id: ownerObservationId }],
    }),
    lookup,
    COMPUTED_AT,
  );
  assert.equal(dto.canonicalValue, "89684655");
  assert.equal(dto.canonicalDisplayValue, "Mark van der Ree");
});

test("canonicalDisplayValue is null when the selected evidence is a manual fact (no provider metadata exists)", () => {
  const lookup = new Map<string, ResolvedEvidenceDTO>([[`manual_account_fact:${MANUAL_FACT_ID}`, MANUAL_DTO]]);
  const dto = toFieldDTO(
    "company.industry",
    result({
      selectedEvidence: { kind: "manual_account_fact", id: MANUAL_FACT_ID },
      supportingEvidence: [{ kind: "manual_account_fact", id: MANUAL_FACT_ID }],
    }),
    lookup,
    COMPUTED_AT,
  );
  assert.equal(dto.canonicalDisplayValue, null);
});

test("canonicalDisplayValue is null when the selected observation carries no displayName metadata", () => {
  const dto = toFieldDTO("company.industry", result(), new Map([[`observation:${OBSERVATION_ID}`, OBSERVATION_DTO]]), COMPUTED_AT);
  assert.equal(dto.canonicalDisplayValue, null);
});
