// Milestone 3G — integration tests for createCurrentAccountSnapshot's
// end-to-end Milestone 3F integration: real Postgres, real
// account_aliases/observations/account_facts/account_fact_current/
// resolved_facts/account_snapshots, real triggers/constraints.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`, including
// 0014/0015). SKIPS itself (does not fail) when DATABASE_URL is unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/icpEvaluationResolvers.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import {
  createCurrentAccountSnapshot,
  CURRENT_STATE_V3_SNAPSHOT_SOURCE,
} from "./icpEvaluationResolvers.js";
import { AccountFactsSnapshotEvidenceV1Schema } from "./accountFactsSnapshotEvidence.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:icp-eval-3g-${crypto.randomUUID()}.example` })
    .returning();
  return account!.id;
}

async function addAlias(accountId: string, aliasType: string, normalizedValue: string) {
  await db!.insert(schema.accountAliases).values({
    accountId,
    aliasType,
    rawValue: normalizedValue,
    normalizedValue,
    normalizationStrategy: aliasType === "domain" ? "domain" : "exact",
    isStrong: true,
    source: "test-fixture",
  });
}

async function addIdentityObservation(args: {
  provider: string;
  sourceRecordId: string;
  identityKey: "domain" | "external_id";
  identityValue: string;
}) {
  await db!.insert(schema.observations).values({
    provider: args.provider,
    sourceRecordId: args.sourceRecordId,
    observationClass: "identity",
    semanticKey: args.identityKey,
    identitySubjectType: "account",
    identityValue: args.identityValue,
    rawValue: null,
    normalizedValue: null,
    observedAt: null,
    importedAt: new Date(),
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  });
}

async function addFieldObservation(args: {
  provider: string;
  sourceRecordId: string;
  observationClass: "firmographic_fact" | "crm_state" | "behavioral_signal" | "research_intelligence";
  canonicalField?: string;
  value: unknown;
}): Promise<string> {
  const [row] = await db!
    .insert(schema.observations)
    .values({
      provider: args.provider,
      sourceRecordId: args.sourceRecordId,
      observationClass: args.observationClass,
      semanticKey: args.canonicalField ?? "some_event",
      identitySubjectType: null,
      identityValue: null,
      rawValue: args.value,
      normalizedValue: null,
      observedAt: null,
      importedAt: new Date(),
      confidence: null,
      evidenceRefs: [],
      providerMetadata: null,
    })
    .returning();
  return row!.id;
}

async function addManualFact(accountId: string, field: string, value: string): Promise<string> {
  const [fact] = await db!
    .insert(schema.accountFacts)
    .values({ accountId, field, value, source: "manual-operator-v1", recordedBy: "test-operator" })
    .returning();
  await db!.insert(schema.accountFactCurrent).values({ accountId, field, factId: fact!.id });
  return fact!.id;
}

async function bindIdentity(
  accountId: string,
  provider: string,
  sourceRecordId: string,
  domain: string,
) {
  const aliasType = `external_id:${provider}`;
  await Promise.all([
    addAlias(accountId, "domain", domain),
    addAlias(accountId, aliasType, sourceRecordId),
    addIdentityObservation({ provider, sourceRecordId, identityKey: "domain", identityValue: domain }),
    addIdentityObservation({ provider, sourceRecordId, identityKey: "external_id", identityValue: sourceRecordId }),
  ]);
}

// ---------------------------------------------------------------------
// 1. manual-only account still evaluates successfully through canonical
//    resolution — and matches what the pre-3G direct read would have
//    produced (13. existing behavior stable for manual-only accounts).
// ---------------------------------------------------------------------
test("a manual-only account (no observations at all) produces a v3 snapshot with the manual value as canonical truth", { skip }, async () => {
  const accountId = await makeAccount();
  await addManualFact(accountId, "company.industry", "Banking");

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);

  assert.equal(snapshot.source, CURRENT_STATE_V3_SNAPSHOT_SOURCE);
  const normalizedInput = snapshot.normalizedInput as { company: { industry: string | null } };
  assert.equal(normalizedInput.company.industry, "Banking");
});

// ---------------------------------------------------------------------
// 2. provider-only canonical firmographic fact reaches the snapshot.
// ---------------------------------------------------------------------
test("a provider-only (HubSpot) firmographic observation, with no manual fact, reaches the evaluator snapshot", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotId = crypto.randomUUID();
  await bindIdentity(accountId, "hubspot", hubspotId, `acme-2-${crypto.randomUUID()}.example`);
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "firmographic_fact",
    canonicalField: "company.country",
    value: "US",
  });

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);
  const normalizedInput = snapshot.normalizedInput as { company: { country: string | null } };
  assert.equal(normalizedInput.company.country, "US");
});

// ---------------------------------------------------------------------
// 3. manual + provider agreement reaches the evaluator as ONE value.
// ---------------------------------------------------------------------
test("manual fact + agreeing provider observation reach the evaluator as one canonical value", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotId = crypto.randomUUID();
  await bindIdentity(accountId, "hubspot", hubspotId, `acme-3-${crypto.randomUUID()}.example`);
  await addManualFact(accountId, "company.industry", "Software");
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    value: "Software",
  });

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);
  const normalizedInput = snapshot.normalizedInput as { company: { industry: string | null } };
  assert.equal(normalizedInput.company.industry, "Software");

  const envelope = AccountFactsSnapshotEvidenceV1Schema.parse(snapshot.rawInput);
  const industryEntry = envelope.resolvedFacts?.find((e) => e.canonicalField === "company.industry");
  assert.equal(industryEntry?.resolutionState, "agreement");
});

// ---------------------------------------------------------------------
// 4. manual/provider conflict WITH a justified winner freezes the
//    winner AND the conflict provenance (10. no provider-name branching:
//    same outcome regardless of which side is HubSpot vs a synthetic
//    provider — the winner is decided by manual authority, never a
//    hardcoded provider check).
// ---------------------------------------------------------------------
test("a manual/provider conflict freezes the manual winner in normalizedInput while preserving the losing provider evidence", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotId = crypto.randomUUID();
  await bindIdentity(accountId, "hubspot", hubspotId, `acme-4-${crypto.randomUUID()}.example`);
  await addManualFact(accountId, "company.industry", "Software");
  const observationId = await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    value: "SaaS",
  });

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);
  const normalizedInput = snapshot.normalizedInput as { company: { industry: string | null } };
  assert.equal(normalizedInput.company.industry, "Software");

  const envelope = AccountFactsSnapshotEvidenceV1Schema.parse(snapshot.rawInput);
  const industryEntry = envelope.resolvedFacts?.find((e) => e.canonicalField === "company.industry");
  assert.equal(industryEntry?.resolutionState, "conflict");
  assert.equal(industryEntry?.canonicalValue, "Software");
  assert.equal(industryEntry?.selectedEvidence?.kind, "manual_account_fact");
  assert.ok(
    industryEntry?.conflictingEvidence.some((e) => e.kind === "observation" && e.id === observationId),
  );
});

// ---------------------------------------------------------------------
// 5. conflict with NO winner never fabricates a value, but is preserved
//    as a conflict in evidence.
// ---------------------------------------------------------------------
test("a conflict with no justified winner leaves normalizedInput null while recording the conflict in evidence", { skip }, async () => {
  const accountId = await makeAccount();
  const dealfrontId = crypto.randomUUID();
  const cognismId = crypto.randomUUID();
  await bindIdentity(accountId, "dealfront", dealfrontId, `acme-5a-${crypto.randomUUID()}.example`);
  await bindIdentity(accountId, "cognism", cognismId, `acme-5b-${crypto.randomUUID()}.example`);
  await addFieldObservation({
    provider: "dealfront",
    sourceRecordId: dealfrontId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "owner-1",
  });
  await addFieldObservation({
    provider: "cognism",
    sourceRecordId: cognismId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "owner-2",
  });

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);
  const normalizedInput = snapshot.normalizedInput as { crm: { hubspotOwner: string | null } };
  assert.equal(normalizedInput.crm.hubspotOwner, null);

  const envelope = AccountFactsSnapshotEvidenceV1Schema.parse(snapshot.rawInput);
  const ownerEntry = envelope.resolvedFacts?.find((e) => e.canonicalField === "crm.owner");
  assert.equal(ownerEntry?.resolutionState, "conflict");
  assert.equal(ownerEntry?.canonicalValue, null);
  assert.equal(ownerEntry?.conflictingEvidence.length, 2);
});

// ---------------------------------------------------------------------
// 6. unresolved employee/revenue range never fabricates a value.
// ---------------------------------------------------------------------
test("raw-vs-band employeeRange representations stay unresolved and null in normalizedInput", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotId = crypto.randomUUID();
  await bindIdentity(accountId, "hubspot", hubspotId, `acme-6-${crypto.randomUUID()}.example`);
  await addManualFact(accountId, "company.employeeRange", "50-200");
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "firmographic_fact",
    canonicalField: "company.employeeRange",
    value: "125",
  });

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);
  const normalizedInput = snapshot.normalizedInput as { company: { employeeRange: string | null } };
  assert.equal(normalizedInput.company.employeeRange, null);

  const envelope = AccountFactsSnapshotEvidenceV1Schema.parse(snapshot.rawInput);
  const entry = envelope.resolvedFacts?.find((e) => e.canonicalField === "company.employeeRange");
  assert.equal(entry?.resolutionState, "unresolved");
});

// ---------------------------------------------------------------------
// 8 / 9 / 15. later evidence does not mutate a historical snapshot or
// its resolved_facts rows; reevaluation sees newly recomputed truth.
// ---------------------------------------------------------------------
test("a later observation does not mutate an earlier snapshot; a new snapshot sees the newly recomputed truth", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotId = crypto.randomUUID();
  await bindIdentity(accountId, "hubspot", hubspotId, `acme-89-${crypto.randomUUID()}.example`);
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "firmographic_fact",
    canonicalField: "company.country",
    value: "US",
  });

  const first = await createCurrentAccountSnapshot(db!, accountId);
  const firstInput = first.normalizedInput as { company: { country: string | null } };
  assert.equal(firstInput.company.country, "US");

  // New, conflicting evidence arrives.
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "firmographic_fact",
    canonicalField: "company.country",
    value: "DE",
  });

  const second = await createCurrentAccountSnapshot(db!, accountId);
  const secondInput = second.normalizedInput as { company: { country: string | null } };
  // Two same-provider values now disagree with no authority to break the
  // tie between them (both "hubspot") and no defensible observedAt ->
  // unresolved conflict, never guessed.
  assert.equal(secondInput.company.country, null);

  // The FIRST snapshot itself is untouched — re-read it independently.
  const [reReadFirst] = await db!
    .select()
    .from(schema.accountSnapshots)
    .where(eq(schema.accountSnapshots.id, first.id))
    .limit(1);
  assert.deepEqual(reReadFirst?.normalizedInput, first.normalizedInput);
  assert.deepEqual(reReadFirst?.rawInput, first.rawInput);

  // The immutability trigger rejects any attempt to mutate it.
  await assert.rejects(() =>
    db!
      .update(schema.accountSnapshots)
      .set({ source: "tampered" })
      .where(eq(schema.accountSnapshots.id, first.id)),
  );

  // Both computations appended their own resolved_facts row (15. no
  // existing history mutated) — the first snapshot's underlying
  // resolution is still present, still "US", and still immutable.
  const allCountryRows = await db!
    .select()
    .from(schema.resolvedFacts)
    .where(
      and(
        eq(schema.resolvedFacts.accountId, accountId),
        eq(schema.resolvedFacts.canonicalField, "company.country"),
      ),
    )
    .orderBy(schema.resolvedFacts.resolvedAt);
  assert.equal(allCountryRows.length, 2);
  assert.equal(allCountryRows[0]?.resolutionState, "single_source");
  assert.equal(allCountryRows[0]?.canonicalValue, "US");
  assert.equal(allCountryRows[1]?.resolutionState, "conflict");
  assert.equal(allCountryRows[1]?.canonicalValue, null);

  await assert.rejects(() =>
    db!
      .update(schema.resolvedFacts)
      .set({ rationale: "tampered" })
      .where(eq(schema.resolvedFacts.id, allCountryRows[0]!.id)),
  );
});

// ---------------------------------------------------------------------
// 11 / 12. behavioral_signal / research_intelligence never reach ICP
// fact input.
// ---------------------------------------------------------------------
test("a behavioral_signal observation never reaches the evaluator snapshot's firmographic/crm fields", { skip }, async () => {
  const accountId = await makeAccount();
  const rb2bId = crypto.randomUUID();
  await bindIdentity(accountId, "rb2b", rb2bId, `acme-11-${crypto.randomUUID()}.example`);
  const behavioralObservationId = await addFieldObservation({
    provider: "rb2b",
    sourceRecordId: rb2bId,
    observationClass: "behavioral_signal",
    value: "page_view",
  });

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);
  assert.equal(JSON.stringify(snapshot.rawInput).includes("page_view"), false);
  const envelope = AccountFactsSnapshotEvidenceV1Schema.parse(snapshot.rawInput);

  // createCurrentAccountSnapshot recomputes ALL 10 evaluator-supported
  // canonical fields on every call (see canonicalFactEvaluatorInput.ts's
  // EVALUATOR_CANONICAL_FIELDS) — this account has no firmographic_fact/
  // crm_state observations and no manual facts at all, so every one of
  // those 10 resolutions is legitimately "unresolved", not absent. The
  // behavioral_signal observation must never have become a candidate for
  // any of them: it's never in consideredEvidence/supportingEvidence/
  // conflictingEvidence anywhere, and every entry stays unresolved/null.
  const entries = envelope.resolvedFacts ?? [];
  assert.equal(entries.length, 10);
  for (const entry of entries) {
    assert.equal(entry.resolutionState, "unresolved");
    assert.equal(entry.canonicalValue, null);
    assert.equal(entry.selectedEvidence, null);
    const allEvidence = [...entry.supportingEvidence, ...entry.conflictingEvidence];
    assert.equal(allEvidence.length, 0);
    assert.ok(!allEvidence.some((ref) => ref.id === behavioralObservationId));
  }

  const normalizedInput = snapshot.normalizedInput as {
    company: Record<string, unknown>;
    crm: Record<string, unknown>;
  };
  for (const value of Object.values(normalizedInput.company)) {
    assert.ok(value === null || value === "unknown");
  }
  assert.equal(normalizedInput.crm.openOpportunity, false);
  assert.equal(normalizedInput.crm.existingCustomer, false);
  assert.equal(normalizedInput.crm.competitorFlag, false);
  assert.equal(normalizedInput.crm.partnerFlag, false);
  assert.equal(normalizedInput.crm.hubspotOwner, null);
});

test("a research_intelligence observation never reaches the evaluator snapshot's firmographic/crm fields", { skip }, async () => {
  const accountId = await makeAccount();
  const clientRadarId = crypto.randomUUID();
  await bindIdentity(accountId, "client_radar", clientRadarId, `acme-12-${crypto.randomUUID()}.example`);
  await addFieldObservation({
    provider: "client_radar",
    sourceRecordId: clientRadarId,
    observationClass: "research_intelligence",
    value: "hiring surge detected",
  });

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);
  assert.equal(JSON.stringify(snapshot.rawInput).includes("hiring surge"), false);
});

// ---------------------------------------------------------------------
// 14. resolvedFacts array in the frozen envelope is deterministically
// ordered.
// ---------------------------------------------------------------------
test("the frozen resolvedFacts evidence array is sorted by canonicalField", { skip }, async () => {
  const accountId = await makeAccount();
  await addManualFact(accountId, "company.country", "US");
  await addManualFact(accountId, "company.industry", "Software");

  const snapshot = await createCurrentAccountSnapshot(db!, accountId);
  const envelope = AccountFactsSnapshotEvidenceV1Schema.parse(snapshot.rawInput);
  const fields = (envelope.resolvedFacts ?? []).map((e) => e.canonicalField);
  assert.deepEqual([...fields].sort(), fields);
});

test.after(async () => {
  await pool?.end();
});
