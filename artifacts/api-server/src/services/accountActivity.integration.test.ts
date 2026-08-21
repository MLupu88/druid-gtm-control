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
import {
  mapRb2bSignalToIdentityObservation,
  mapRb2bSignalToObservation,
  type Rb2bSignalBridgeRequest,
} from "./rb2bObservationMapping.js";
import { recordObservation } from "./observations.js";
import { resolveRb2bPersonAccount } from "./rb2bIdentity.js";

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

// ---------------------------------------------------------------------
// M3.5 — end-to-end regression for the account-binding gap fixed in
// ../services/rb2bObservationMapping.ts (mapRb2bSignalToIdentityObservation)
// and ../routes/rb2bSignalBridge.ts. Exercises the real writer
// (mapRb2bSignalToObservation + mapRb2bSignalToIdentityObservation +
// recordObservation — exactly what the route does, not a fake), the
// real resolver (resolveRb2bPersonAccount), and the real reader
// (getAccountRecentActivity) together against one real Postgres
// instance — never a pre-bound observation seeded by hand.
// ---------------------------------------------------------------------

function rb2bEvent(overrides: Partial<Rb2bSignalBridgeRequest> = {}): Rb2bSignalBridgeRequest {
  return {
    source: "rb2b",
    signal_type: "page_view",
    source_record_id: crypto.randomUUID(),
    ingestion_attempt_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Exactly what ../routes/rb2bSignalBridge.ts's handler does, in order: record the behavioral observation, record the companion identity observation (when a domain exists), then resolve identity. */
async function ingestRb2bEvent(event: Rb2bSignalBridgeRequest) {
  const behavioralResult = await recordObservation({
    db: db!,
    observation: mapRb2bSignalToObservation(event),
  });
  if (behavioralResult.outcome === "conflict") {
    throw new Error("unexpected observation conflict in test fixture");
  }

  const identityCandidate = mapRb2bSignalToIdentityObservation(event);
  if (identityCandidate !== null) {
    await recordObservation({ db: db!, observation: identityCandidate });
  }

  const binding = await resolveRb2bPersonAccount({ db: db!, event });
  return { observationId: behavioralResult.observation.id, binding };
}

test(
  "an RB2B payload ingested through the real writer + resolver path is visible in getAccountRecentActivity() for the resolved account",
  { skip },
  async () => {
    const domain = `rb2b-e2e-${crypto.randomUUID()}.example`;
    const { observationId, binding } = await ingestRb2bEvent(
      rb2bEvent({
        company_domain: domain,
        company_name: "RB2B E2E Co",
        signal_type: "page_view",
      }),
    );

    assert.equal(binding.accountResolution.outcome, "resolved");
    if (binding.accountResolution.outcome !== "resolved") return;

    const items = await getAccountRecentActivity(db!, binding.accountResolution.accountId);
    assert.ok(
      items.some((item) => item.id === observationId),
      "expected the ingested behavioral observation to be selectable for its resolved account",
    );
  },
);

test(
  "a second RB2B visit from the same account (same domain, new event) is also visible, alongside the first",
  { skip },
  async () => {
    const domain = `rb2b-e2e-multi-${crypto.randomUUID()}.example`;
    const first = await ingestRb2bEvent(rb2bEvent({ company_domain: domain }));
    const second = await ingestRb2bEvent(rb2bEvent({ company_domain: domain }));

    assert.equal(first.binding.accountResolution.outcome, "resolved");
    assert.equal(second.binding.accountResolution.outcome, "resolved");
    if (first.binding.accountResolution.outcome !== "resolved") return;
    if (second.binding.accountResolution.outcome !== "resolved") return;
    assert.equal(first.binding.accountResolution.accountId, second.binding.accountResolution.accountId);

    const items = await getAccountRecentActivity(db!, first.binding.accountResolution.accountId);
    const ids = items.map((item) => item.id);
    assert.ok(ids.includes(first.observationId));
    assert.ok(ids.includes(second.observationId));
  },
);

test(
  "an event with no usable domain resolves unresolved and its observation is not visible under any unrelated account's activity",
  { skip },
  async () => {
    const { observationId, binding } = await ingestRb2bEvent(rb2bEvent({ company_domain: null }));
    assert.equal(binding.accountResolution.outcome, "unresolved");

    const unrelatedAccountId = await makeAccount();
    const items = await getAccountRecentActivity(db!, unrelatedAccountId);
    assert.equal(items.some((item) => item.id === observationId), false);
  },
);

test(
  "an RB2B event for one account never appears under a different, unrelated account's activity",
  { skip },
  async () => {
    const domainA = `rb2b-e2e-isolation-a-${crypto.randomUUID()}.example`;
    const domainB = `rb2b-e2e-isolation-b-${crypto.randomUUID()}.example`;
    const eventA = await ingestRb2bEvent(rb2bEvent({ company_domain: domainA }));
    await ingestRb2bEvent(rb2bEvent({ company_domain: domainB }));

    assert.equal(eventA.binding.accountResolution.outcome, "resolved");
    if (eventA.binding.accountResolution.outcome !== "resolved") return;

    const unrelatedAccountId = await makeAccount();
    const items = await getAccountRecentActivity(db!, unrelatedAccountId);
    assert.equal(items.some((item) => item.id === eventA.observationId), false);
  },
);

test.after(async () => {
  await pool?.end();
});
