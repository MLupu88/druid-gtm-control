// Milestone 4B — integration tests for ./accountActivitySummary.ts
// against a real, migrated Postgres instance: real observations/
// account_aliases rows, real binding via
// ./observationSubjectBinding.ts (through ./accountActivity.ts's
// getAccountBoundActivity). Mirrors ./accountActivity.integration.test.ts's
// own fixture-seeding conventions.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/accountActivitySummary.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getAccountActivitySummary } from "./accountActivitySummary.js";
import { AccountNotFoundError } from "./accountActivity.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const RUN_ID = crypto.randomUUID();

async function makeAccountWithDomainAlias() {
  const domain = `activity-summary-${RUN_ID}-${crypto.randomUUID()}.example`;
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:${domain}` })
    .returning();
  await db!.insert(schema.accountAliases).values({
    accountId: account!.id,
    aliasType: "domain",
    rawValue: domain,
    normalizedValue: domain,
    normalizationStrategy: "domain",
    isStrong: true,
    source: "test",
  });
  return { account: account!, domain };
}

async function addIdentityObservation(args: { provider: string; sourceRecordId: string; domain: string }) {
  await db!.insert(schema.observations).values({
    provider: args.provider,
    sourceRecordId: args.sourceRecordId,
    observationClass: "identity",
    semanticKey: "domain",
    identitySubjectType: "account",
    identityValue: args.domain,
    rawValue: null,
    importedAt: new Date(),
    evidenceRefs: [],
  });
}

async function addBehavioralObservation(args: {
  provider: string;
  sourceRecordId: string;
  observedAt: Date;
}) {
  await db!.insert(schema.observations).values({
    provider: args.provider,
    sourceRecordId: args.sourceRecordId,
    observationClass: "behavioral_signal",
    semanticKey: "page_view",
    rawValue: { page_visited: "/pricing" },
    observedAt: args.observedAt,
    importedAt: args.observedAt,
    evidenceRefs: [],
  });
}

test("getAccountActivitySummary throws AccountNotFoundError for an unknown account", { skip }, async () => {
  await assert.rejects(() => getAccountActivitySummary(db!, crypto.randomUUID()), AccountNotFoundError);
});

test("getAccountActivitySummary returns all-zero/empty facts (never a placeholder) for an account with no bound activity", { skip }, async () => {
  const { account } = await makeAccountWithDomainAlias();
  const result = await getAccountActivitySummary(db!, account.id);
  assert.deepEqual(result, {
    totalEvents: 0,
    firstObservedAt: null,
    lastObservedAt: null,
    distinctDaysObserved: 0,
    providers: [],
  });
});

test("getAccountActivitySummary aggregates totalEvents, distinctDaysObserved, providers, and first/last observed across real bound observations", { skip }, async () => {
  const { account, domain } = await makeAccountWithDomainAlias();
  const sourceRecordId = crypto.randomUUID();
  await addIdentityObservation({ provider: "rb2b", sourceRecordId, domain });
  await addBehavioralObservation({ provider: "rb2b", sourceRecordId, observedAt: new Date("2026-08-01T10:00:00Z") });
  await addBehavioralObservation({ provider: "rb2b", sourceRecordId, observedAt: new Date("2026-08-01T14:00:00Z") });
  await addBehavioralObservation({ provider: "rb2b", sourceRecordId, observedAt: new Date("2026-08-05T09:00:00Z") });

  const result = await getAccountActivitySummary(db!, account.id);
  assert.equal(result.totalEvents, 3);
  assert.equal(result.distinctDaysObserved, 2);
  assert.deepEqual(result.providers, ["rb2b"]);
  assert.equal(result.firstObservedAt, new Date("2026-08-01T10:00:00Z").toISOString());
  assert.equal(result.lastObservedAt, new Date("2026-08-05T09:00:00Z").toISOString());
});

test("getAccountActivitySummary reports distinct sorted providers across multiple sources", { skip }, async () => {
  const { account, domain } = await makeAccountWithDomainAlias();
  const rb2bRecordId = crypto.randomUUID();
  const hubspotRecordId = crypto.randomUUID();
  await addIdentityObservation({ provider: "rb2b", sourceRecordId: rb2bRecordId, domain });
  await addIdentityObservation({ provider: "hubspot", sourceRecordId: hubspotRecordId, domain });
  await addBehavioralObservation({ provider: "rb2b", sourceRecordId: rb2bRecordId, observedAt: new Date("2026-08-01T10:00:00Z") });
  await addBehavioralObservation({ provider: "hubspot", sourceRecordId: hubspotRecordId, observedAt: new Date("2026-08-02T10:00:00Z") });

  const result = await getAccountActivitySummary(db!, account.id);
  assert.deepEqual(result.providers, ["hubspot", "rb2b"]);
});

test.after(async () => {
  await pool?.end();
});
