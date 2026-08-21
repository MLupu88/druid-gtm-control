// Milestone 3F — unit tests for the pure fact-reconciliation resolver.
// No DB, no network — every case is plain candidate literals in, a
// ReconciliationResult out. Run with:
//   tsx --test src/services/factReconciliation.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceReference } from "@workspace/db/schema";
import {
  reconcileFactCandidates,
  type FactCandidate,
} from "./factReconciliation.js";
import { FACT_RECONCILIATION_POLICY_V1 } from "./factResolutionPolicy.js";

function observationEvidence(id: string): EvidenceReference {
  return { kind: "observation", id };
}
function manualEvidence(id: string): EvidenceReference {
  return { kind: "manual_account_fact", id };
}

function providerCandidate(overrides: Partial<FactCandidate> = {}): FactCandidate {
  return {
    evidence: observationEvidence("00000000-0000-4000-8000-000000000001"),
    provider: "hubspot",
    canonicalField: "company.industry",
    value: "Software",
    observedAt: null,
    importedAt: new Date("2026-01-01T00:00:00Z"),
    confidence: null,
    isManual: false,
    ...overrides,
  };
}

function manualCandidate(overrides: Partial<FactCandidate> = {}): FactCandidate {
  return {
    evidence: manualEvidence("00000000-0000-4000-8000-0000000000f1"),
    provider: "manual",
    canonicalField: "company.industry",
    value: "Software",
    observedAt: new Date("2026-01-01T00:00:00Z"),
    importedAt: null,
    confidence: null,
    isManual: true,
    ...overrides,
  };
}

function sortedIds(refs: EvidenceReference[]): string[] {
  return [...refs].map((r) => `${r.kind}:${r.id}`).sort();
}

// ---------------------------------------------------------------------
// 1. one candidate -> single_source
// ---------------------------------------------------------------------
test("one usable candidate resolves single_source with that candidate's value", () => {
  const candidate = providerCandidate({ evidence: observationEvidence("obs-1") });
  const result = reconcileFactCandidates([candidate]);

  assert.equal(result.state, "single_source");
  assert.equal(result.canonicalValue, "Software");
  assert.deepEqual(result.selectedEvidence, observationEvidence("obs-1"));
  assert.deepEqual(result.supportingEvidence, [observationEvidence("obs-1")]);
  assert.deepEqual(result.conflictingEvidence, []);
  assert.deepEqual(result.consideredEvidence, [observationEvidence("obs-1")]);
  assert.equal(result.policyVersion, FACT_RECONCILIATION_POLICY_V1.version);
});

// ---------------------------------------------------------------------
// 2. two equal provider candidates -> agreement
// ---------------------------------------------------------------------
test("two candidates with materially equivalent values resolve agreement, all retained as supporting", () => {
  const a = providerCandidate({ evidence: observationEvidence("obs-a"), provider: "hubspot" });
  const b = providerCandidate({ evidence: observationEvidence("obs-b"), provider: "dealfront" });
  const result = reconcileFactCandidates([a, b]);

  assert.equal(result.state, "agreement");
  assert.equal(result.canonicalValue, "Software");
  assert.ok(result.selectedEvidence);
  assert.deepEqual(sortedIds(result.supportingEvidence), sortedIds([a.evidence, b.evidence]));
  assert.deepEqual(result.conflictingEvidence, []);
});

// ---------------------------------------------------------------------
// 3. two conflicting providers, no justified winner -> conflict + null
// ---------------------------------------------------------------------
test("two conflicting provider candidates with no authority/recency signal stay conflict with null canonical value", () => {
  const a = providerCandidate({
    evidence: observationEvidence("obs-a"),
    provider: "provider_a",
    value: "Software",
  });
  const b = providerCandidate({
    evidence: observationEvidence("obs-b"),
    provider: "provider_b",
    value: "SaaS",
  });
  const result = reconcileFactCandidates([a, b]);

  assert.equal(result.state, "conflict");
  assert.equal(result.canonicalValue, null);
  assert.equal(result.selectedEvidence, null);
  assert.deepEqual(result.supportingEvidence, []);
  assert.deepEqual(sortedIds(result.conflictingEvidence), sortedIds([a.evidence, b.evidence]));
});

// ---------------------------------------------------------------------
// 4. explicit provider authority -> deterministic winner
// ---------------------------------------------------------------------
test("explicit source-authority policy produces a deterministic conflict winner", () => {
  const policy = {
    ...FACT_RECONCILIATION_POLICY_V1,
    providerAuthority: {
      ...FACT_RECONCILIATION_POLICY_V1.providerAuthority,
      "company.industry": ["provider_a", "provider_b"],
    },
  };
  const winner = providerCandidate({
    evidence: observationEvidence("obs-winner"),
    provider: "provider_a",
    value: "Software",
  });
  const loser = providerCandidate({
    evidence: observationEvidence("obs-loser"),
    provider: "provider_b",
    value: "SaaS",
  });
  const result = reconcileFactCandidates([loser, winner], policy);

  assert.equal(result.state, "conflict");
  assert.equal(result.canonicalValue, "Software");
  assert.deepEqual(result.selectedEvidence, winner.evidence);
  assert.deepEqual(result.supportingEvidence, [winner.evidence]);
  assert.deepEqual(result.conflictingEvidence, [loser.evidence]);
  assert.match(result.rationale, /source authority/);
});

// ---------------------------------------------------------------------
// 5. current manual fact overrides a conflicting provider candidate,
//    state stays "conflict" (never silently collapsed to single_source).
// ---------------------------------------------------------------------
test("a current manual fact wins a conflict against provider evidence, but state remains conflict and the losing evidence is retained", () => {
  const manual = manualCandidate({ value: "Software" });
  const provider = providerCandidate({
    evidence: observationEvidence("obs-provider"),
    value: "SaaS",
  });
  const result = reconcileFactCandidates([provider, manual]);

  assert.equal(result.state, "conflict");
  assert.equal(result.canonicalValue, "Software");
  assert.deepEqual(result.selectedEvidence, manual.evidence);
  assert.deepEqual(result.supportingEvidence, [manual.evidence]);
  assert.deepEqual(result.conflictingEvidence, [provider.evidence]);
  assert.match(result.rationale, /manual account_fact is highest authority/);
});

// ---------------------------------------------------------------------
// 6. manual + provider agree on the same value -> agreement
// ---------------------------------------------------------------------
test("a manual fact and a provider candidate with the same value resolve agreement", () => {
  const manual = manualCandidate({ value: "Software" });
  const provider = providerCandidate({ value: "Software" });
  const result = reconcileFactCandidates([manual, provider]);

  assert.equal(result.state, "agreement");
  assert.equal(result.canonicalValue, "Software");
  assert.deepEqual(sortedIds(result.supportingEvidence), sortedIds([manual.evidence, provider.evidence]));
});

// ---------------------------------------------------------------------
// 7. no candidates -> unresolved
// ---------------------------------------------------------------------
test("zero candidates resolve unresolved with an empty evidence set, never a fabricated value", () => {
  const result = reconcileFactCandidates([]);

  assert.equal(result.state, "unresolved");
  assert.equal(result.canonicalValue, null);
  assert.equal(result.selectedEvidence, null);
  assert.deepEqual(result.consideredEvidence, []);
});

// ---------------------------------------------------------------------
// 8. absent value is never treated as negative evidence
// ---------------------------------------------------------------------
test("an unresolved (no-candidate) result never asserts a negative/false value", () => {
  const result = reconcileFactCandidates([], FACT_RECONCILIATION_POLICY_V1);
  assert.notEqual(result.canonicalValue, false);
  assert.equal(result.canonicalValue, null);
  assert.equal(result.state, "unresolved");
});

// ---------------------------------------------------------------------
// 9. defensible observedAt recency breaks a conflict tie ONLY when every
//    candidate is dated; otherwise it never applies.
// ---------------------------------------------------------------------
test("a strictly newer defensible observedAt determines the conflict winner when every candidate is dated", () => {
  const older = providerCandidate({
    evidence: observationEvidence("obs-older"),
    provider: "provider_a",
    value: "Software",
    observedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const newer = providerCandidate({
    evidence: observationEvidence("obs-newer"),
    provider: "provider_b",
    value: "SaaS",
    observedAt: new Date("2026-06-01T00:00:00Z"),
  });
  const result = reconcileFactCandidates([older, newer]);

  assert.equal(result.state, "conflict");
  assert.equal(result.canonicalValue, "SaaS");
  assert.deepEqual(result.selectedEvidence, newer.evidence);
  assert.match(result.rationale, /observedAt recency/);
});

test("recency never applies when any candidate lacks a defensible observedAt", () => {
  const dated = providerCandidate({
    evidence: observationEvidence("obs-dated"),
    provider: "provider_a",
    value: "Software",
    observedAt: new Date("2026-06-01T00:00:00Z"),
  });
  const undated = providerCandidate({
    evidence: observationEvidence("obs-undated"),
    provider: "provider_b",
    value: "SaaS",
    observedAt: null,
  });
  const result = reconcileFactCandidates([dated, undated]);

  assert.equal(result.state, "conflict");
  assert.equal(result.canonicalValue, null);
  assert.equal(result.selectedEvidence, null);
});

// ---------------------------------------------------------------------
// 10. importedAt alone can never determine a truth winner
// ---------------------------------------------------------------------
test("differing importedAt alone (no observedAt, no authority) never decides a conflict winner", () => {
  const a = providerCandidate({
    evidence: observationEvidence("obs-a"),
    provider: "provider_a",
    value: "Software",
    observedAt: null,
    importedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const b = providerCandidate({
    evidence: observationEvidence("obs-b"),
    provider: "provider_b",
    value: "SaaS",
    observedAt: null,
    importedAt: new Date("2026-06-01T00:00:00Z"),
  });
  const result = reconcileFactCandidates([a, b]);

  assert.equal(result.state, "conflict");
  assert.equal(result.canonicalValue, null);
  assert.equal(result.selectedEvidence, null);
});

// ---------------------------------------------------------------------
// 11. employee/revenue raw-vs-band -> unresolved, never a naive conflict
// ---------------------------------------------------------------------
test("company.employeeRange with differing raw-vs-band representations resolves unresolved, not conflict", () => {
  const raw = providerCandidate({
    evidence: observationEvidence("obs-raw"),
    provider: "hubspot",
    canonicalField: "company.employeeRange",
    value: "125",
  });
  const banded = manualCandidate({
    canonicalField: "company.employeeRange",
    value: "50-200",
  });
  const result = reconcileFactCandidates([raw, banded]);

  assert.equal(result.state, "unresolved");
  assert.equal(result.canonicalValue, null);
  assert.equal(result.selectedEvidence, null);
  assert.match(result.rationale, /no repository-defined normalization/);
});

test("company.employeeRange with a single candidate still resolves single_source", () => {
  const raw = providerCandidate({
    evidence: observationEvidence("obs-raw"),
    canonicalField: "company.employeeRange",
    value: "125",
  });
  const result = reconcileFactCandidates([raw]);

  assert.equal(result.state, "single_source");
  assert.equal(result.canonicalValue, "125");
});

test("company.employeeRange with identical raw representations still agrees (literal equality needs no normalization)", () => {
  const a = providerCandidate({
    evidence: observationEvidence("obs-a"),
    canonicalField: "company.employeeRange",
    value: "125",
  });
  const b = providerCandidate({
    evidence: observationEvidence("obs-b"),
    provider: "dealfront",
    canonicalField: "company.employeeRange",
    value: "125",
  });
  const result = reconcileFactCandidates([a, b]);

  assert.equal(result.state, "agreement");
  assert.equal(result.canonicalValue, "125");
});

// ---------------------------------------------------------------------
// 12. boolean comparison behaves correctly — actual booleans, never
//     stringified.
// ---------------------------------------------------------------------
test("two true booleans for crm.existingCustomer agree", () => {
  const a = providerCandidate({
    evidence: observationEvidence("obs-a"),
    canonicalField: "crm.existingCustomer",
    value: true,
  });
  const b = providerCandidate({
    evidence: observationEvidence("obs-b"),
    provider: "dealfront",
    canonicalField: "crm.existingCustomer",
    value: true,
  });
  const result = reconcileFactCandidates([a, b]);
  assert.equal(result.state, "agreement");
  assert.equal(result.canonicalValue, true);
});

test("boolean true is never treated as equal to the string \"true\"", () => {
  const boolCandidate = providerCandidate({
    evidence: observationEvidence("obs-bool"),
    canonicalField: "crm.existingCustomer",
    value: true,
  });
  const stringCandidate = providerCandidate({
    evidence: observationEvidence("obs-string"),
    provider: "dealfront",
    canonicalField: "crm.existingCustomer",
    value: "true",
  });
  const result = reconcileFactCandidates([boolCandidate, stringCandidate]);
  assert.equal(result.state, "conflict");
});

// ---------------------------------------------------------------------
// 13. input-order independence
// ---------------------------------------------------------------------
test("candidate input order never changes the result", () => {
  const policy = {
    ...FACT_RECONCILIATION_POLICY_V1,
    providerAuthority: {
      ...FACT_RECONCILIATION_POLICY_V1.providerAuthority,
      "company.industry": ["provider_a", "provider_b"],
    },
  };
  const a = providerCandidate({ evidence: observationEvidence("obs-a"), provider: "provider_a", value: "Software" });
  const b = providerCandidate({ evidence: observationEvidence("obs-b"), provider: "provider_b", value: "SaaS" });
  const c = providerCandidate({ evidence: observationEvidence("obs-c"), provider: "provider_c", value: "SaaS" });

  const forward = reconcileFactCandidates([a, b, c], policy);
  const reversed = reconcileFactCandidates([c, b, a], policy);
  const shuffled = reconcileFactCandidates([b, a, c], policy);

  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, shuffled);
});

// ---------------------------------------------------------------------
// 14. recomputing with the same evidence produces the same result
// ---------------------------------------------------------------------
test("recomputing with the exact same candidates produces the identical result", () => {
  const a = providerCandidate({ evidence: observationEvidence("obs-a"), value: "Software" });
  const b = providerCandidate({ evidence: observationEvidence("obs-b"), provider: "dealfront", value: "Software" });
  const first = reconcileFactCandidates([a, b]);
  const second = reconcileFactCandidates([a, b]);
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------
// Structural: this module never mutates its input.
// ---------------------------------------------------------------------
test("the resolver never mutates its input candidates array or objects", () => {
  const a = Object.freeze(providerCandidate({ evidence: observationEvidence("obs-a") }));
  const candidates = Object.freeze([a]);
  assert.doesNotThrow(() => reconcileFactCandidates(candidates));
});
