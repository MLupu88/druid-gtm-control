// Milestone 3H — integration tests for accountTruth.ts's end-to-end
// read-only current-truth preview: real Postgres, real
// observations/account_aliases/account_facts/resolved_facts.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself when DATABASE_URL is unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/accountTruth.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getAccountCanonicalTruth, AccountNotFoundError } from "./accountTruth.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:account-truth-3h-${crypto.randomUUID()}.example` })
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

async function bindIdentity(accountId: string, provider: string, sourceRecordId: string, domain: string) {
  await Promise.all([
    addAlias(accountId, "domain", domain),
    addAlias(accountId, `external_id:${provider}`, sourceRecordId),
    addIdentityObservation({ provider, sourceRecordId, identityKey: "domain", identityValue: domain }),
    addIdentityObservation({ provider, sourceRecordId, identityKey: "external_id", identityValue: sourceRecordId }),
  ]);
}

// ---------------------------------------------------------------------
// 1. current truth is recomputed WITHOUT inserting a new resolved_facts
// row on read.
// ---------------------------------------------------------------------
test("getAccountCanonicalTruth never inserts a resolved_facts row", { skip }, async () => {
  const accountId = await makeAccount();
  await addManualFact(accountId, "company.industry", "Banking");

  const before = await db!
    .select()
    .from(schema.resolvedFacts)
    .where(eq(schema.resolvedFacts.accountId, accountId));
  assert.equal(before.length, 0);

  const fields = await getAccountCanonicalTruth(db!, accountId);
  const industry = fields.find((f) => f.canonicalField === "company.industry");
  assert.equal(industry?.canonicalValue, "Banking");
  assert.equal(industry?.resolutionState, "single_source");

  const after = await db!
    .select()
    .from(schema.resolvedFacts)
    .where(eq(schema.resolvedFacts.accountId, accountId));
  assert.equal(after.length, 0);
});

// ---------------------------------------------------------------------
// Unknown account -> AccountNotFoundError, not a silent empty result.
// ---------------------------------------------------------------------
test("an unknown accountId throws AccountNotFoundError", { skip }, async () => {
  await assert.rejects(
    () => getAccountCanonicalTruth(db!, crypto.randomUUID()),
    AccountNotFoundError,
  );
});

// ---------------------------------------------------------------------
// 10. deterministic field ordering.
// ---------------------------------------------------------------------
test("fields are sorted deterministically by canonicalField and cover every RESOLVED_FACT_CANONICAL_FIELDS entry (all 11, including crm.lifecycleStage)", { skip }, async () => {
  const accountId = await makeAccount();
  const fields = await getAccountCanonicalTruth(db!, accountId);
  assert.equal(fields.length, schema.RESOLVED_FACT_CANONICAL_FIELDS.length);
  assert.equal(fields.length, 11);
  const names = fields.map((f) => f.canonicalField);
  assert.deepEqual([...names].sort(), names);
  assert.ok(names.includes("crm.lifecycleStage"));
});

// ---------------------------------------------------------------------
// crm.lifecycleStage is real 3F output (not an evaluator-only field) —
// this is the exact gap the "reused EVALUATOR_CANONICAL_FIELDS" defect
// hid: a bound HubSpot crm_state observation for lifecycleStage must
// surface here even though 3G's evaluator input has no slot for it.
// ---------------------------------------------------------------------
test("crm.lifecycleStage resolves from a bound HubSpot crm_state observation, single_source", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotId = crypto.randomUUID();
  await bindIdentity(accountId, "hubspot", hubspotId, `acme-3h-lifecycle-${crypto.randomUUID()}.example`);
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "crm_state",
    canonicalField: "crm.lifecycleStage",
    value: "lead",
  });

  const fields = await getAccountCanonicalTruth(db!, accountId);
  const lifecycleStage = fields.find((f) => f.canonicalField === "crm.lifecycleStage");
  assert.equal(lifecycleStage?.resolutionState, "single_source");
  assert.equal(lifecycleStage?.canonicalValue, "lead");
  assert.equal(lifecycleStage?.selectedEvidence?.kind, "observation");
});

// ---------------------------------------------------------------------
// 11 / 12. behavioral_signal / research_intelligence never appear as
// scalar fact evidence.
// ---------------------------------------------------------------------
test("behavioral_signal and research_intelligence observations never appear anywhere in the truth read", { skip }, async () => {
  const accountId = await makeAccount();
  const rb2bId = crypto.randomUUID();
  const clientRadarId = crypto.randomUUID();
  await bindIdentity(accountId, "rb2b", rb2bId, `acme-3h-11-${crypto.randomUUID()}.example`);
  await bindIdentity(accountId, "client_radar", clientRadarId, `acme-3h-12-${crypto.randomUUID()}.example`);
  await addFieldObservation({
    provider: "rb2b",
    sourceRecordId: rb2bId,
    observationClass: "behavioral_signal",
    value: "page_view",
  });
  await addFieldObservation({
    provider: "client_radar",
    sourceRecordId: clientRadarId,
    observationClass: "research_intelligence",
    value: "hiring surge detected",
  });

  const fields = await getAccountCanonicalTruth(db!, accountId);
  const serialized = JSON.stringify(fields);
  assert.equal(serialized.includes("page_view"), false);
  assert.equal(serialized.includes("hiring surge"), false);
  for (const field of fields) {
    assert.equal(field.resolutionState, "unresolved");
    assert.equal(field.canonicalValue, null);
  }
});

// ---------------------------------------------------------------------
// 12. no mutation of observation/account_fact/resolved_fact history
// during a read.
// ---------------------------------------------------------------------
test("a read never mutates observations or account_facts rows", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotId = crypto.randomUUID();
  await bindIdentity(accountId, "hubspot", hubspotId, `acme-3h-clean-${crypto.randomUUID()}.example`);
  const observationId = await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "firmographic_fact",
    canonicalField: "company.country",
    value: "US",
  });

  const [before] = await db!
    .select()
    .from(schema.observations)
    .where(eq(schema.observations.id, observationId));

  await getAccountCanonicalTruth(db!, accountId);
  await getAccountCanonicalTruth(db!, accountId);

  const [after] = await db!
    .select()
    .from(schema.observations)
    .where(eq(schema.observations.id, observationId));
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------
// Evidence resolution end to end: manual-winner conflict exposes a
// human-readable manual DTO for the winner and an observation DTO for
// the loser.
// ---------------------------------------------------------------------
test("evidence references resolve to human-readable provenance end to end", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotId = crypto.randomUUID();
  await bindIdentity(accountId, "hubspot", hubspotId, `acme-3h-evidence-${crypto.randomUUID()}.example`);
  await addManualFact(accountId, "company.industry", "Software");
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotId,
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    value: "SaaS",
  });

  const fields = await getAccountCanonicalTruth(db!, accountId);
  const industry = fields.find((f) => f.canonicalField === "company.industry")!;
  assert.equal(industry.resolutionState, "conflict");
  assert.equal(industry.canonicalValue, "Software");
  assert.equal(industry.selectedEvidence?.kind, "manual_account_fact");
  if (industry.selectedEvidence?.kind === "manual_account_fact") {
    assert.equal(industry.selectedEvidence.recordedBy, "test-operator");
  }
  assert.equal(industry.conflictingEvidence.length, 1);
  assert.equal(industry.conflictingEvidence[0]?.kind, "observation");
  if (industry.conflictingEvidence[0]?.kind === "observation") {
    assert.equal(industry.conflictingEvidence[0].provider, "hubspot");
    assert.equal(industry.conflictingEvidence[0].value, "SaaS");
  }
});

test.after(async () => {
  await pool?.end();
});
