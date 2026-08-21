// Unit tests for the versioned, validated evidence envelope frozen into
// account_snapshots.rawInput for gtm-account-current-state-v2 snapshots.
//
// Run with: tsx --test src/services/accountFactsSnapshotEvidence.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountFactsSnapshotEvidenceV1Schema,
  buildAccountFactsSnapshotEvidence,
  buildResolvedFactEvidenceEntries,
  ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
  ACCOUNT_RECORD_IDENTITY_SOURCE,
} from "./accountFactsSnapshotEvidence.js";
import type { Account, AccountFact, ResolvedFact, ResolvedFactCanonicalField } from "@workspace/db/schema";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const FACT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function validIdentityEntry(overrides: Record<string, unknown> = {}) {
  return {
    field: "company.domain",
    value: "acme.com",
    source: ACCOUNT_RECORD_IDENTITY_SOURCE,
    ...overrides,
  };
}

function validEvidenceEntry(overrides: Record<string, unknown> = {}) {
  return {
    field: "company.industry",
    value: "Banking",
    accountFactId: FACT_ID,
    source: "manual-operator-v1",
    recordedBy: "operator@example.com",
    observedAt: "2026-01-01T00:00:00.000Z",
    recordedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: ACCOUNT_FACTS_SNAPSHOT_EVIDENCE_SCHEMA_VERSION,
    account: { id: ACCOUNT_ID },
    identity: [validIdentityEntry()],
    evidence: [validEvidenceEntry()],
    ...overrides,
  };
}

test("accepts a well-formed envelope", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(validEnvelope());
  assert.equal(result.success, true);
});

test("rejects the wrong schemaVersion", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({ schemaVersion: "account-facts-snapshot-v2" }),
  );
  assert.equal(result.success, false);
});

test("rejects an unknown manual-fact field", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({
      evidence: [validEvidenceEntry({ field: "company.someNewField" })],
    }),
  );
  assert.equal(result.success, false);
});

test("rejects a non-UUID accountFactId", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({ evidence: [validEvidenceEntry({ accountFactId: "not-a-uuid" })] }),
  );
  assert.equal(result.success, false);
});

test("rejects duplicate identity fields", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({
      identity: [validIdentityEntry(), validIdentityEntry()],
    }),
  );
  assert.equal(result.success, false);
});

test("rejects duplicate manual-fact fields", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({
      evidence: [validEvidenceEntry(), validEvidenceEntry({ accountFactId: FACT_ID })],
    }),
  );
  assert.equal(result.success, false);
});

test("rejects more than two identity entries", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({
      identity: [
        validIdentityEntry({ field: "company.domain" }),
        validIdentityEntry({ field: "company.name" }),
        // A third, structurally-invalid identity field is still rejected
        // purely by the max(2) bound, independent of field validity.
        { field: "company.name", value: "dup", source: ACCOUNT_RECORD_IDENTITY_SOURCE },
      ],
    }),
  );
  assert.equal(result.success, false);
});

test("rejects more than five manual-fact entries", () => {
  const fields = [
    "company.industry",
    "company.country",
    "company.region",
    "company.employeeRange",
    "company.revenueRange",
  ];
  const evidence = fields.map((field, i) =>
    field === "company.region"
      ? validEvidenceEntry({ field, value: "us", accountFactId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}` })
      : validEvidenceEntry({ field, accountFactId: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}` }),
  );
  // Six entries: five distinct fields plus one more re-using a field name
  // deliberately not present above, purely to exceed max(5) — uniqueness
  // is tested separately above.
  evidence.push(
    validEvidenceEntry({ field: "company.industry", accountFactId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
  );
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({ evidence }),
  );
  assert.equal(result.success, false);
});

test("rejects a blank, null, or empty identity value", () => {
  for (const value of ["", "   ", null]) {
    const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
      validEnvelope({ identity: [validIdentityEntry({ value })] }),
    );
    assert.equal(result.success, false, `value=${JSON.stringify(value)} should be rejected`);
  }
});

test("rejects a blank, null, or empty manual-fact value", () => {
  for (const value of ["", "   ", null]) {
    const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
      validEnvelope({ evidence: [validEvidenceEntry({ value })] }),
    );
    assert.equal(result.success, false, `value=${JSON.stringify(value)} should be rejected`);
  }
});

test("rejects company.region = 'unknown' — never a manually-confirmable value", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({
      evidence: [validEvidenceEntry({ field: "company.region", value: "unknown" })],
    }),
  );
  assert.equal(result.success, false);
});

test("accepts company.region only for 'us' | 'emea' | 'other'", () => {
  for (const value of ["us", "emea", "other"]) {
    const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
      validEnvelope({
        evidence: [validEvidenceEntry({ field: "company.region", value })],
      }),
    );
    assert.equal(result.success, true, `value=${value} should be accepted`);
  }
  for (const value of ["apac", "US", "unknown", "global"]) {
    const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
      validEnvelope({
        evidence: [validEvidenceEntry({ field: "company.region", value })],
      }),
    );
    assert.equal(result.success, false, `value=${value} should be rejected`);
  }
});

test("rejects identity evidence whose source is not 'account-record-v1'", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({
      identity: [validIdentityEntry({ source: "manual-operator-v1" })],
    }),
  );
  assert.equal(result.success, false);
});

test("rejects manual-fact evidence whose source is not 'manual-operator-v1'", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    validEnvelope({
      evidence: [validEvidenceEntry({ source: "account-record-v1" })],
    }),
  );
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------
// buildAccountFactsSnapshotEvidence
// ---------------------------------------------------------------------

function syntheticAccount(overrides: Partial<Account> = {}): Pick<Account, "id" | "companyDomain" | "companyName"> {
  return {
    id: ACCOUNT_ID,
    companyDomain: "acme.com",
    companyName: "Acme Co",
    ...overrides,
  };
}

function syntheticFact(overrides: Partial<AccountFact> = {}): AccountFact {
  return {
    id: FACT_ID,
    accountId: ACCOUNT_ID,
    field: "company.industry",
    value: "Banking",
    source: "manual-operator-v1",
    recordedBy: "operator@example.com",
    observedAt: new Date("2026-01-01T00:00:00.000Z"),
    recordedAt: new Date("2026-01-01T00:00:00.000Z"),
    correctionReason: null,
    supersedesFactId: null,
    ...overrides,
  } as AccountFact;
}

test("buildAccountFactsSnapshotEvidence: no facts, no identity -> empty envelope", () => {
  const envelope = buildAccountFactsSnapshotEvidence(
    syntheticAccount({ companyDomain: null, companyName: null }),
    [],
  );
  assert.deepEqual(envelope.identity, []);
  assert.deepEqual(envelope.evidence, []);
  assert.equal(envelope.account.id, ACCOUNT_ID);
});

test("buildAccountFactsSnapshotEvidence: identity from the account row, evidence from current facts", () => {
  const envelope = buildAccountFactsSnapshotEvidence(syntheticAccount(), [
    syntheticFact(),
  ]);
  assert.deepEqual(
    envelope.identity.map((e) => e.field).sort(),
    ["company.domain", "company.name"],
  );
  assert.equal(envelope.evidence.length, 1);
  assert.equal(envelope.evidence[0]?.accountFactId, FACT_ID);
  assert.equal(envelope.evidence[0]?.value, "Banking");
});

test("buildAccountFactsSnapshotEvidence: a blank companyDomain/companyName is not identity evidence", () => {
  const envelope = buildAccountFactsSnapshotEvidence(
    syntheticAccount({ companyDomain: "   ", companyName: "" }),
    [],
  );
  assert.deepEqual(envelope.identity, []);
});

// ---------------------------------------------------------------------
// Milestone 3G — the additive resolvedFacts array. Backward compatibility
// is already proven by "accepts a well-formed envelope" above (that
// fixture carries no resolvedFacts key at all and still parses) — these
// cases cover the new field itself.
// ---------------------------------------------------------------------

const RESOLVED_FACT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OBSERVATION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MANUAL_FACT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function syntheticResolvedFact(overrides: Partial<ResolvedFact> = {}): ResolvedFact {
  return {
    id: RESOLVED_FACT_ID,
    accountId: ACCOUNT_ID,
    canonicalField: "company.industry",
    resolutionState: "single_source",
    canonicalValue: "Software",
    selectedObservationId: OBSERVATION_ID,
    selectedManualAccountFactId: null,
    supportingEvidence: [{ kind: "observation", id: OBSERVATION_ID }],
    conflictingEvidence: [],
    consideredEvidence: [{ kind: "observation", id: OBSERVATION_ID }],
    policyVersion: "fact-reconciliation-policy-v1",
    rationale: "single hubspot observation available for company.industry",
    resolvedAt: new Date("2026-08-21T00:00:00.000Z"),
    ...overrides,
  };
}

function resolvedMap(rows: ResolvedFact[]): Map<ResolvedFactCanonicalField, ResolvedFact> {
  return new Map(rows.map((row) => [row.canonicalField as ResolvedFactCanonicalField, row]));
}

test("a v1/v2 envelope with no resolvedFacts key still validates (backward compatibility)", () => {
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse(validEnvelope());
  assert.equal(result.success, true);
  assert.equal("resolvedFacts" in (result.success ? result.data : {}), false);
});

test("buildResolvedFactEvidenceEntries freezes canonicalField/resolutionState/policyVersion/evidence/resolvedAt", () => {
  const entries = buildResolvedFactEvidenceEntries(
    resolvedMap([syntheticResolvedFact()]),
  );
  assert.equal(entries.length, 1);
  const entry = entries[0]!;
  assert.equal(entry.canonicalField, "company.industry");
  assert.equal(entry.resolutionState, "single_source");
  assert.equal(entry.canonicalValue, "Software");
  assert.equal(entry.policyVersion, "fact-reconciliation-policy-v1");
  assert.deepEqual(entry.selectedEvidence, { kind: "observation", id: OBSERVATION_ID });
  assert.deepEqual(entry.supportingEvidence, [{ kind: "observation", id: OBSERVATION_ID }]);
  assert.deepEqual(entry.conflictingEvidence, []);
  assert.equal(entry.resolvedAt, "2026-08-21T00:00:00.000Z");

  const parsed = AccountFactsSnapshotEvidenceV1Schema.safeParse({
    ...validEnvelope(),
    resolvedFacts: entries,
  });
  assert.equal(parsed.success, true);
});

test("buildResolvedFactEvidenceEntries maps a manual-selected winner to a manual_account_fact evidence reference", () => {
  const entries = buildResolvedFactEvidenceEntries(
    resolvedMap([
      syntheticResolvedFact({
        selectedObservationId: null,
        selectedManualAccountFactId: MANUAL_FACT_ID,
      }),
    ]),
  );
  assert.deepEqual(entries[0]?.selectedEvidence, { kind: "manual_account_fact", id: MANUAL_FACT_ID });
});

test("buildResolvedFactEvidenceEntries preserves a null canonicalValue/selectedEvidence for an unresolved conflict, never fabricating a winner", () => {
  const entries = buildResolvedFactEvidenceEntries(
    resolvedMap([
      syntheticResolvedFact({
        resolutionState: "conflict",
        canonicalValue: null,
        selectedObservationId: null,
        selectedManualAccountFactId: null,
        conflictingEvidence: [
          { kind: "observation", id: OBSERVATION_ID },
          { kind: "manual_account_fact", id: MANUAL_FACT_ID },
        ],
      }),
    ]),
  );
  const entry = entries[0]!;
  assert.equal(entry.resolutionState, "conflict");
  assert.equal(entry.canonicalValue, null);
  assert.equal(entry.selectedEvidence, null);
  assert.equal(entry.conflictingEvidence.length, 2);
});

test("buildResolvedFactEvidenceEntries sorts entries by canonicalField regardless of Map insertion order", () => {
  const industry = syntheticResolvedFact({ canonicalField: "company.industry" });
  const country = syntheticResolvedFact({
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    canonicalField: "company.country",
    canonicalValue: "US",
  });

  const forward = buildResolvedFactEvidenceEntries(resolvedMap([industry, country]));
  const reversed = buildResolvedFactEvidenceEntries(resolvedMap([country, industry]));
  assert.deepEqual(
    forward.map((e) => e.canonicalField),
    ["company.country", "company.industry"],
  );
  assert.deepEqual(forward, reversed);
});

test("the schema rejects a resolvedFacts array with a duplicate canonicalField", () => {
  const entries = buildResolvedFactEvidenceEntries(resolvedMap([syntheticResolvedFact()]));
  const result = AccountFactsSnapshotEvidenceV1Schema.safeParse({
    ...validEnvelope(),
    resolvedFacts: [...entries, ...entries],
  });
  assert.equal(result.success, false);
});
