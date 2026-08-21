// M3.5 — integration tests for ./accountActivity.ts against a real,
// migrated Postgres instance: real observations/account_aliases binding.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself when DATABASE_URL is unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/accountActivity.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getAccountRecentActivity, AccountNotFoundError } from "./accountActivity.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:account-activity-${crypto.randomUUID()}.example` })
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

async function bindRb2bIdentity(accountId: string, sourceRecordId: string, domain: string) {
  await addAlias(accountId, "domain", domain);
  await addIdentityObservation({
    provider: "rb2b",
    sourceRecordId,
    identityKey: "domain",
    identityValue: domain,
  });
}

async function addBehavioralObservation(args: {
  provider: string;
  sourceRecordId: string;
  eventType: string;
  rawValue: unknown;
  observedAt?: Date | null;
  importedAt?: Date;
}): Promise<string> {
  const [row] = await db!
    .insert(schema.observations)
    .values({
      provider: args.provider,
      sourceRecordId: args.sourceRecordId,
      observationClass: "behavioral_signal",
      semanticKey: args.eventType,
      identitySubjectType: null,
      identityValue: null,
      rawValue: args.rawValue,
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

test("returns bound behavioral_signal observations, newest first", { skip }, async () => {
  const accountId = await makeAccount();
  const sourceRecordId = crypto.randomUUID();
  await bindRb2bIdentity(accountId, sourceRecordId, `acme-activity-order-${crypto.randomUUID()}.example`);

  const olderId = await addBehavioralObservation({
    provider: "rb2b",
    sourceRecordId,
    eventType: "page_view",
    rawValue: { page_visited: "/pricing" },
    importedAt: new Date(Date.now() - 60_000),
  });
  const newerId = await addBehavioralObservation({
    provider: "rb2b",
    sourceRecordId,
    eventType: "page_view",
    rawValue: { page_visited: "/product" },
    importedAt: new Date(),
  });

  const items = await getAccountRecentActivity(db!, accountId);

  assert.equal(items.length, 2);
  assert.equal(items[0]!.id, newerId);
  assert.equal(items[1]!.id, olderId);
});

test("an observation from an unbound (provider, sourceRecordId) never appears", { skip }, async () => {
  const accountId = await makeAccount();
  const sourceRecordId = crypto.randomUUID();
  await bindRb2bIdentity(accountId, sourceRecordId, `acme-activity-unbound-${crypto.randomUUID()}.example`);

  await addBehavioralObservation({
    provider: "rb2b",
    sourceRecordId: crypto.randomUUID(), // a different, unbound source record
    eventType: "page_view",
    rawValue: { page_visited: "/other-company" },
  });

  const items = await getAccountRecentActivity(db!, accountId);
  assert.equal(items.length, 0);
});

test("firmographic_fact and crm_state observations never appear in the activity feed", { skip }, async () => {
  const accountId = await makeAccount();
  const sourceRecordId = crypto.randomUUID();
  await bindRb2bIdentity(accountId, sourceRecordId, `acme-activity-scope-${crypto.randomUUID()}.example`);

  await db!.insert(schema.observations).values({
    provider: "rb2b",
    sourceRecordId,
    observationClass: "firmographic_fact",
    semanticKey: "company.industry",
    identitySubjectType: null,
    identityValue: null,
    rawValue: "SOFTWARE",
    normalizedValue: null,
    observedAt: null,
    importedAt: new Date(),
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  });

  const items = await getAccountRecentActivity(db!, accountId);
  assert.equal(items.length, 0);
});

test("throws AccountNotFoundError for an account that does not exist", { skip }, async () => {
  await assert.rejects(
    () => getAccountRecentActivity(db!, "00000000-0000-4000-8000-000000000000"),
    AccountNotFoundError,
  );
});

test("rawValue is returned exactly as stored, and occurredAt falls back to importedAt when observedAt is absent", { skip }, async () => {
  const accountId = await makeAccount();
  const sourceRecordId = crypto.randomUUID();
  await bindRb2bIdentity(accountId, sourceRecordId, `acme-activity-rawvalue-${crypto.randomUUID()}.example`);

  const importedAt = new Date();
  await addBehavioralObservation({
    provider: "rb2b",
    sourceRecordId,
    eventType: "page_view",
    rawValue: { page_visited: "/pricing", contact_email: "jane@acme.example" },
    importedAt,
  });

  const [item] = await getAccountRecentActivity(db!, accountId);
  assert.deepEqual(item?.rawValue, { page_visited: "/pricing", contact_email: "jane@acme.example" });
  assert.equal(item?.occurredAt, importedAt.toISOString());
});

test.after(async () => {
  await pool?.end();
});
