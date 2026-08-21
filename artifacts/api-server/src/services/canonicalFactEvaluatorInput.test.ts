// Milestone 3G — unit tests for the pure 3F -> evaluator-input overlay.
// No DB — synthetic ResolvedFact-shaped rows in,
// NormalizedAccountInputV1 out. Run with:
//   tsx --test src/services/canonicalFactEvaluatorInput.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedFact, ResolvedFactCanonicalField } from "@workspace/db/schema";
import { buildNormalizedAccountInputFromAccount } from "./icpEvaluationResolvers.js";
import {
  applyResolvedFactsToNormalizedInput,
  EVALUATOR_CANONICAL_FIELDS,
} from "./canonicalFactEvaluatorInput.js";

const ACCOUNT = {
  id: "11111111-1111-4111-8111-111111111111",
  accountKey: "dom:acme.example",
  companyDomain: "acme.example",
  companyName: "Acme Inc",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const NOW = new Date("2026-08-21T00:00:00Z");

function resolvedFact(overrides: Partial<ResolvedFact> = {}): ResolvedFact {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    accountId: ACCOUNT.id,
    canonicalField: "company.industry",
    resolutionState: "single_source",
    canonicalValue: "Software",
    selectedObservationId: "bbbbbbbb-0000-4000-8000-000000000001",
    selectedManualAccountFactId: null,
    supportingEvidence: [{ kind: "observation", id: "bbbbbbbb-0000-4000-8000-000000000001" }],
    conflictingEvidence: [],
    consideredEvidence: [{ kind: "observation", id: "bbbbbbbb-0000-4000-8000-000000000001" }],
    policyVersion: "fact-reconciliation-policy-v1",
    rationale: "single observation available",
    resolvedAt: NOW,
    ...overrides,
  };
}

function resolvedMap(rows: ResolvedFact[]): Map<ResolvedFactCanonicalField, ResolvedFact> {
  return new Map(rows.map((row) => [row.canonicalField as ResolvedFactCanonicalField, row]));
}

const SOURCE = "gtm-account-current-state-v3";

// ---------------------------------------------------------------------
// canonical input boundary: only fields with a real evaluator home.
// ---------------------------------------------------------------------
test("EVALUATOR_CANONICAL_FIELDS excludes crm.lifecycleStage and every identity/behavioral_signal/research_intelligence field", () => {
  assert.equal(EVALUATOR_CANONICAL_FIELDS.includes("crm.lifecycleStage" as never), false);
  assert.equal(EVALUATOR_CANONICAL_FIELDS.length, 10);
});

// ---------------------------------------------------------------------
// 6. agreement -> canonical value used directly.
// ---------------------------------------------------------------------
test("an agreement resolution populates the evaluator field with the canonical value", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const rows = resolvedMap([
    resolvedFact({ canonicalField: "company.industry", resolutionState: "agreement", canonicalValue: "Software" }),
  ]);
  const input = applyResolvedFactsToNormalizedInput(base, rows, SOURCE);
  assert.equal(input.company.industry, "Software");
});

// ---------------------------------------------------------------------
// 5 / 4. conflict WITH a justified winner still populates a value.
// ---------------------------------------------------------------------
test("a conflict with a justified winner populates the evaluator field with the winning value", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const rows = resolvedMap([
    resolvedFact({
      canonicalField: "company.industry",
      resolutionState: "conflict",
      canonicalValue: "Software",
      selectedManualAccountFactId: "cccccccc-0000-4000-8000-000000000001",
      selectedObservationId: null,
    }),
  ]);
  const input = applyResolvedFactsToNormalizedInput(base, rows, SOURCE);
  assert.equal(input.company.industry, "Software");
});

// ---------------------------------------------------------------------
// 5. conflict with NO winner never fabricates a value.
// ---------------------------------------------------------------------
test("a conflict with no justified winner (canonicalValue null) never fabricates an evaluator value", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const rows = resolvedMap([
    resolvedFact({
      canonicalField: "company.industry",
      resolutionState: "conflict",
      canonicalValue: null,
      selectedObservationId: null,
      selectedManualAccountFactId: null,
    }),
  ]);
  const input = applyResolvedFactsToNormalizedInput(base, rows, SOURCE);
  assert.equal(input.company.industry, null);
});

// ---------------------------------------------------------------------
// 8 / 6. unresolved (including non-comparable employee/revenue range)
// never fabricates a value.
// ---------------------------------------------------------------------
test("unresolved never fabricates a value — absent evidence stays null, not a guess", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const rows = resolvedMap([
    resolvedFact({
      canonicalField: "company.employeeRange",
      resolutionState: "unresolved",
      canonicalValue: null,
      selectedObservationId: null,
      selectedManualAccountFactId: null,
      rationale: "multiple differing representations for company.employeeRange; no repository-defined normalization exists to prove equivalence",
    }),
  ]);
  const input = applyResolvedFactsToNormalizedInput(base, rows, SOURCE);
  assert.equal(input.company.employeeRange, null);
});

test("a canonical field with no resolved_facts row at all stays null/false/unknown, never negative evidence", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const input = applyResolvedFactsToNormalizedInput(base, new Map(), SOURCE);
  assert.equal(input.company.industry, null);
  assert.equal(input.company.region, "unknown");
  assert.equal(input.crm.existingCustomer, false);
  assert.notEqual(input.crm.existingCustomer as unknown, "unresolved");
});

// ---------------------------------------------------------------------
// boolean crm fields: true only on a positively-confirmed canonicalValue
// === true; never fabricated, never stringified.
// ---------------------------------------------------------------------
test("crm boolean fields are true only when canonicalValue is exactly boolean true", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const rows = resolvedMap([
    resolvedFact({ canonicalField: "crm.existingCustomer", resolutionState: "single_source", canonicalValue: true }),
    resolvedFact({
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      canonicalField: "crm.partnerFlag",
      resolutionState: "single_source",
      canonicalValue: "true",
    }),
    resolvedFact({
      id: "aaaaaaaa-0000-4000-8000-000000000003",
      canonicalField: "crm.competitorFlag",
      resolutionState: "unresolved",
      canonicalValue: null,
      selectedObservationId: null,
    }),
  ]);
  const input = applyResolvedFactsToNormalizedInput(base, rows, SOURCE);
  assert.equal(input.crm.existingCustomer, true);
  // The string "true" is never treated as boolean true.
  assert.equal(input.crm.partnerFlag, false);
  assert.equal(input.crm.competitorFlag, false);
});

// ---------------------------------------------------------------------
// crm.owner maps to the evaluator's legacy hubspotOwner field name —
// pure field-name adaptation, never a provider branch.
// ---------------------------------------------------------------------
test("crm.owner populates the evaluator's hubspotOwner field", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const rows = resolvedMap([
    resolvedFact({ canonicalField: "crm.owner", resolutionState: "single_source", canonicalValue: "owner-123" }),
  ]);
  const input = applyResolvedFactsToNormalizedInput(base, rows, SOURCE);
  assert.equal(input.crm.hubspotOwner, "owner-123");
});

// ---------------------------------------------------------------------
// engagement/contact/consent/doNotContact pass through unchanged.
// ---------------------------------------------------------------------
test("engagement/contact/consent/doNotContact are never touched by this overlay", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const input = applyResolvedFactsToNormalizedInput(base, new Map(), SOURCE);
  assert.deepEqual(input.engagement, base.engagement);
  assert.equal(input.contact, base.contact);
  assert.deepEqual(input.consent, base.consent);
  assert.equal(input.doNotContact, base.doNotContact);
  assert.equal(input.crm.hubspotCompanyId, base.crm.hubspotCompanyId);
  assert.equal(input.crm.hubspotContactId, base.crm.hubspotContactId);
});

// ---------------------------------------------------------------------
// 14. deterministic regardless of Map insertion order.
// ---------------------------------------------------------------------
test("result is identical regardless of the resolvedByField Map's insertion order", () => {
  const base = buildNormalizedAccountInputFromAccount(ACCOUNT);
  const industry = resolvedFact({ canonicalField: "company.industry", canonicalValue: "Software" });
  const country = resolvedFact({
    id: "aaaaaaaa-0000-4000-8000-000000000004",
    canonicalField: "company.country",
    canonicalValue: "US",
  });

  const forward = applyResolvedFactsToNormalizedInput(base, resolvedMap([industry, country]), SOURCE);
  const reversed = applyResolvedFactsToNormalizedInput(base, resolvedMap([country, industry]), SOURCE);
  assert.deepEqual(forward, reversed);
});
