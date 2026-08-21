// Milestone 3F — integration tests for factResolutionRun.ts against a
// real, migrated Postgres instance: real db, real triggers/constraints,
// real account_aliases/observations/account_facts/account_fact_current,
// real resolved_facts immutability trigger.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/factResolutionRun.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getLatestResolvedFact, resolveAccountCanonicalField } from "./factResolutionRun.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:fact-resolution-run-${crypto.randomUUID()}.example` })
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
  importedAt?: Date;
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
    importedAt: args.importedAt ?? new Date(),
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  });
}

async function addFieldObservation(args: {
  provider: string;
  sourceRecordId: string;
  observationClass: "firmographic_fact" | "crm_state";
  canonicalField: string;
  value: unknown;
  observedAt?: Date | null;
  importedAt?: Date;
}): Promise<string> {
  const [row] = await db!
    .insert(schema.observations)
    .values({
      provider: args.provider,
      sourceRecordId: args.sourceRecordId,
      observationClass: args.observationClass,
      semanticKey: args.canonicalField,
      identitySubjectType: null,
      identityValue: null,
      rawValue: args.value,
      normalizedValue: null,
      observedAt: args.observedAt ?? null,
      importedAt: args.importedAt ?? new Date(),
      confidence: null,
      evidenceRefs: [],
      providerMetadata: null,
    })
    .returning();
  return row!.id;
}

async function addManualFact(
  accountId: string,
  field: string,
  value: string,
): Promise<string> {
  const [fact] = await db!
    .insert(schema.accountFacts)
    .values({
      accountId,
      field,
      value,
      source: "manual-operator-v1",
      recordedBy: "test-operator",
    })
    .returning();
  await db!.insert(schema.accountFactCurrent).values({
    accountId,
    field,
    factId: fact!.id,
  });
  return fact!.id;
}

function bindHubSpotIdentity(accountId: string, hubspotCompanyId: string, domain: string) {
  return Promise.all([
    addAlias(accountId, "domain", domain),
    addAlias(accountId, "external_id:hubspot", hubspotCompanyId),
    addIdentityObservation({
      provider: "hubspot",
      sourceRecordId: hubspotCompanyId,
      identityKey: "domain",
      identityValue: domain,
    }),
    addIdentityObservation({
      provider: "hubspot",
      sourceRecordId: hubspotCompanyId,
      identityKey: "external_id",
      identityValue: hubspotCompanyId,
    }),
  ]);
}

// ---------------------------------------------------------------------
// 19. resolved_facts row preserves all evidence references.
// ---------------------------------------------------------------------
test("a single bound observation persists a resolved_facts row with matching considered/supporting evidence", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotCompanyId = crypto.randomUUID();
  await bindHubSpotIdentity(accountId, hubspotCompanyId, "acme-19.example");
  const observationId = await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    value: "Software",
  });

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "company.industry",
  });

  assert.equal(resolved.resolutionState, "single_source");
  assert.equal(resolved.canonicalValue, "Software");
  assert.deepEqual(resolved.consideredEvidence, [{ kind: "observation", id: observationId }]);
  assert.deepEqual(resolved.supportingEvidence, [{ kind: "observation", id: observationId }]);
  assert.deepEqual(resolved.conflictingEvidence, []);
  assert.ok(resolved.policyVersion.length > 0);
  assert.ok(resolved.rationale.length > 0);
  assert.ok(resolved.resolvedAt);
});

// ---------------------------------------------------------------------
// 20. manual selected FK path.
// ---------------------------------------------------------------------
test("when a manual fact wins, selectedManualAccountFactId is set and selectedObservationId is null", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotCompanyId = crypto.randomUUID();
  await bindHubSpotIdentity(accountId, hubspotCompanyId, "acme-20.example");
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    value: "SaaS",
  });
  const manualFactId = await addManualFact(accountId, "company.industry", "Software");

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "company.industry",
  });

  assert.equal(resolved.resolutionState, "conflict");
  assert.equal(resolved.canonicalValue, "Software");
  assert.equal(resolved.selectedManualAccountFactId, manualFactId);
  assert.equal(resolved.selectedObservationId, null);
});

// ---------------------------------------------------------------------
// 21. observation selected FK path.
// ---------------------------------------------------------------------
test("when a provider observation wins (single_source), selectedObservationId is set and selectedManualAccountFactId is null", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotCompanyId = crypto.randomUUID();
  await bindHubSpotIdentity(accountId, hubspotCompanyId, "acme-21.example");
  const observationId = await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "crm_state",
    canonicalField: "crm.lifecycleStage",
    value: "lead",
  });

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "crm.lifecycleStage",
  });

  assert.equal(resolved.resolutionState, "single_source");
  assert.equal(resolved.selectedObservationId, observationId);
  assert.equal(resolved.selectedManualAccountFactId, null);
});

// ---------------------------------------------------------------------
// 22. conflict with no justified winner persists null selected IDs.
// ---------------------------------------------------------------------
test("an unjustified conflict persists resolution_state='conflict' with both selected-evidence columns null", { skip }, async () => {
  const accountId = await makeAccount();
  // Two independently-bound provider records for the SAME account — two
  // distinct sourceRecordIds under two providers, NEITHER of which is
  // "hubspot" (the only provider FACT_RECONCILIATION_POLICY_V1 actually
  // ranks for crm.owner), so neither source-authority nor (undated)
  // recency can justify a winner. observedAt is left absent on both
  // field observations so the recency rule cannot apply either.
  const dealfrontId = crypto.randomUUID();
  const cognismId = crypto.randomUUID();
  await Promise.all([
    addAlias(accountId, "external_id:dealfront", dealfrontId),
    addIdentityObservation({
      provider: "dealfront",
      sourceRecordId: dealfrontId,
      identityKey: "external_id",
      identityValue: dealfrontId,
    }),
    addAlias(accountId, "external_id:cognism", cognismId),
    addIdentityObservation({
      provider: "cognism",
      sourceRecordId: cognismId,
      identityKey: "external_id",
      identityValue: cognismId,
    }),
  ]);
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

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "crm.owner",
  });

  assert.equal(resolved.resolutionState, "conflict");
  assert.equal(resolved.canonicalValue, null);
  assert.equal(resolved.selectedObservationId, null);
  assert.equal(resolved.selectedManualAccountFactId, null);
  assert.equal(resolved.conflictingEvidence.length, 2);
});

// ---------------------------------------------------------------------
// 23. prior resolved_facts rows remain unchanged after recompute.
// ---------------------------------------------------------------------
test("recomputing appends a new resolved_facts row and never mutates the prior one", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotCompanyId = crypto.randomUUID();
  await bindHubSpotIdentity(accountId, hubspotCompanyId, "acme-23.example");
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "firmographic_fact",
    canonicalField: "company.country",
    value: "US",
  });

  const first = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "company.country",
  });
  assert.equal(first.resolutionState, "single_source");
  assert.equal(first.canonicalValue, "US");

  // A later occurrence of the SAME hubspot claim (repeated sync) arrives
  // before the second computation. It must collapse to one current
  // candidate, not look like a second independent source agreeing — see
  // §28/M3.5 "Confirmed by multiple sources" defect fix.
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "firmographic_fact",
    canonicalField: "company.country",
    value: "US",
  });
  const second = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "company.country",
  });
  assert.equal(second.resolutionState, "single_source");
  assert.notEqual(second.id, first.id);

  const allRows = await db!
    .select()
    .from(schema.resolvedFacts)
    .where(
      and(
        eq(schema.resolvedFacts.accountId, accountId),
        eq(schema.resolvedFacts.canonicalField, "company.country"),
      ),
    );
  assert.equal(allRows.length, 2);
  const persistedFirst = allRows.find((r) => r.id === first.id);
  assert.deepEqual(persistedFirst?.consideredEvidence, first.consideredEvidence);
  assert.equal(persistedFirst?.resolutionState, "single_source");

  const latest = await getLatestResolvedFact(db!, accountId, "company.country");
  assert.equal(latest?.id, second.id);

  // The immutability trigger rejects any attempt to mutate the first row.
  await assert.rejects(() =>
    db!
      .update(schema.resolvedFacts)
      .set({ rationale: "tampered" })
      .where(eq(schema.resolvedFacts.id, first.id)),
  );
});

// ---------------------------------------------------------------------
// M3.5 real-data defect fix — current-occurrence collapse regression
// coverage. See ./observationCurrentOccurrence.ts's module comment for
// the full root-cause explanation. These tests prove the fix end to end
// against a real Postgres instance (real occurrence rows, real
// immutability), not just the pure collapse function in isolation.
// ---------------------------------------------------------------------

test("repeated identical same-provider occurrences (crm_state) collapse to ONE current candidate — single_source, never 'agreement'", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotCompanyId = crypto.randomUUID();
  await bindHubSpotIdentity(accountId, hubspotCompanyId, "acme-repeated-owner.example");

  // Three occurrences of the identical, unchanged HubSpot claim — the
  // exact pattern from three repeated syncs.
  const occurrenceIds = [];
  for (let i = 0; i < 3; i += 1) {
    occurrenceIds.push(
      await addFieldObservation({
        provider: "hubspot",
        sourceRecordId: hubspotCompanyId,
        observationClass: "crm_state",
        canonicalField: "crm.owner",
        value: "89684655",
        importedAt: new Date(Date.now() - (3 - i) * 60_000),
      }),
    );
  }

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "crm.owner",
  });

  assert.equal(resolved.resolutionState, "single_source");
  assert.equal(resolved.canonicalValue, "89684655");
  assert.equal(resolved.supportingEvidence.length, 1);
  // The current candidate is the LATEST occurrence, not the first.
  assert.deepEqual(resolved.selectedObservationId, occurrenceIds[2]);
  assert.deepEqual(resolved.consideredEvidence, [
    { kind: "observation", id: occurrenceIds[2] },
  ]);
});

test("a changed same-provider crm_state observation: the current candidate is the newest value, and the old value never creates a conflict", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotCompanyId = crypto.randomUUID();
  await bindHubSpotIdentity(accountId, hubspotCompanyId, "acme-changed-owner.example");

  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "old-owner-id",
    importedAt: new Date(Date.now() - 60_000),
  });
  const newOccurrenceId = await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "new-owner-id",
    importedAt: new Date(),
  });

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "crm.owner",
  });

  assert.equal(resolved.resolutionState, "single_source");
  assert.equal(resolved.canonicalValue, "new-owner-id");
  assert.equal(resolved.selectedObservationId, newOccurrenceId);
  // The superseded old value must not appear as conflicting evidence —
  // it isn't a current candidate at all, it's immutable history only.
  assert.deepEqual(resolved.conflictingEvidence, []);
  assert.equal(resolved.supportingEvidence.length, 1);
});

test("the same value from two independent providers is 'agreement' (multiple real sources), unaffected by the same-provider collapse", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotCompanyId = crypto.randomUUID();
  const dealfrontId = crypto.randomUUID();
  await Promise.all([
    bindHubSpotIdentity(accountId, hubspotCompanyId, "acme-two-providers-agree.example"),
    addAlias(accountId, "external_id:dealfront", dealfrontId),
    addIdentityObservation({
      provider: "dealfront",
      sourceRecordId: dealfrontId,
      identityKey: "external_id",
      identityValue: dealfrontId,
    }),
  ]);
  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "shared-owner-id",
  });
  await addFieldObservation({
    provider: "dealfront",
    sourceRecordId: dealfrontId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "shared-owner-id",
  });

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "crm.owner",
  });

  assert.equal(resolved.resolutionState, "agreement");
  assert.equal(resolved.canonicalValue, "shared-owner-id");
  assert.equal(resolved.supportingEvidence.length, 2);
});

test("conflicting values from two independent providers still conflict, even when one provider has repeated occurrences that must first collapse", { skip }, async () => {
  const accountId = await makeAccount();
  const dealfrontId = crypto.randomUUID();
  const cognismId = crypto.randomUUID();
  await Promise.all([
    addAlias(accountId, "external_id:dealfront", dealfrontId),
    addIdentityObservation({
      provider: "dealfront",
      sourceRecordId: dealfrontId,
      identityKey: "external_id",
      identityValue: dealfrontId,
    }),
    addAlias(accountId, "external_id:cognism", cognismId),
    addIdentityObservation({
      provider: "cognism",
      sourceRecordId: cognismId,
      identityKey: "external_id",
      identityValue: cognismId,
    }),
  ]);
  // dealfront repeats the SAME claim twice (must collapse to one current
  // candidate before conflict evaluation ever sees it).
  await addFieldObservation({
    provider: "dealfront",
    sourceRecordId: dealfrontId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "owner-1",
    importedAt: new Date(Date.now() - 60_000),
  });
  await addFieldObservation({
    provider: "dealfront",
    sourceRecordId: dealfrontId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "owner-1",
    importedAt: new Date(),
  });
  await addFieldObservation({
    provider: "cognism",
    sourceRecordId: cognismId,
    observationClass: "crm_state",
    canonicalField: "crm.owner",
    value: "owner-2",
  });

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "crm.owner",
  });

  assert.equal(resolved.resolutionState, "conflict");
  assert.equal(resolved.canonicalValue, null);
  // Exactly 2 pieces of conflicting evidence — one per PROVIDER, not one
  // per occurrence (would be 3 if dealfront's duplicate leaked through).
  assert.equal(resolved.conflictingEvidence.length, 2);
});

test("the current-occurrence collapse applies to firmographic_fact fields too, not only crm_state", { skip }, async () => {
  const accountId = await makeAccount();
  const hubspotCompanyId = crypto.randomUUID();
  await bindHubSpotIdentity(accountId, hubspotCompanyId, "acme-firmographic-collapse.example");

  await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "firmographic_fact",
    canonicalField: "company.employeeRange",
    value: "125",
    importedAt: new Date(Date.now() - 60_000),
  });
  const latestId = await addFieldObservation({
    provider: "hubspot",
    sourceRecordId: hubspotCompanyId,
    observationClass: "firmographic_fact",
    canonicalField: "company.employeeRange",
    value: "161",
    importedAt: new Date(),
  });

  const resolved = await resolveAccountCanonicalField({
    db: db!,
    accountId,
    canonicalField: "company.employeeRange",
  });

  assert.equal(resolved.resolutionState, "single_source");
  assert.equal(resolved.canonicalValue, "161");
  assert.equal(resolved.selectedObservationId, latestId);
});

test.after(async () => {
  await pool?.end();
});
