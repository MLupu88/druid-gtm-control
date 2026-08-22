// Milestone 4C — integration tests for ./accountTruthHistory.ts against
// a real, migrated Postgres instance: real resolved_facts rows, real
// CHECK constraints. Proves the plain historical read (oldest first,
// accountId + canonicalField scoped) against the actual persisted
// ledger — never touches account_evaluations/account_snapshots.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/accountTruthHistory.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getResolvedFactHistory, AccountNotFoundError } from "./accountTruthHistory.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const RUN_ID = crypto.randomUUID();

async function makeAccount() {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:truth-history-${RUN_ID}-${crypto.randomUUID()}.example` })
    .returning();
  return account!;
}

async function makeObservation() {
  const [observation] = await db!
    .insert(schema.observations)
    .values({
      provider: "hubspot",
      sourceRecordId: crypto.randomUUID(),
      observationClass: "crm_state",
      semanticKey: "crm.lifecycleStage",
      rawValue: "lead",
      importedAt: new Date(),
      evidenceRefs: [],
    })
    .returning();
  return observation!;
}

async function insertResolvedFact(args: {
  accountId: string;
  canonicalField: string;
  resolutionState: "single_source" | "agreement" | "conflict" | "unresolved";
  canonicalValue: unknown;
  selectedObservationId: string | null;
  resolvedAt: Date;
}) {
  await db!.insert(schema.resolvedFacts).values({
    accountId: args.accountId,
    canonicalField: args.canonicalField,
    resolutionState: args.resolutionState,
    canonicalValue: args.canonicalValue,
    selectedObservationId: args.selectedObservationId,
    policyVersion: "test-policy-v1",
    rationale: "test fixture",
    resolvedAt: args.resolvedAt,
  });
}

test("getResolvedFactHistory throws AccountNotFoundError for an unknown account", { skip }, async () => {
  await assert.rejects(() => getResolvedFactHistory(db!, crypto.randomUUID()), AccountNotFoundError);
});

test("getResolvedFactHistory returns an empty array (never a placeholder) for an account never evaluated — the honest, expected outcome", { skip }, async () => {
  const account = await makeAccount();
  const history = await getResolvedFactHistory(db!, account.id);
  assert.deepEqual(history, []);
});

test("getResolvedFactHistory returns every resolved_facts row for this account, oldest first, real values intact", { skip }, async () => {
  const account = await makeAccount();
  const observation = await makeObservation();

  await insertResolvedFact({
    accountId: account.id,
    canonicalField: "crm.lifecycleStage",
    resolutionState: "single_source",
    canonicalValue: "lead",
    selectedObservationId: observation.id,
    resolvedAt: new Date("2026-07-01T00:00:00Z"),
  });
  await insertResolvedFact({
    accountId: account.id,
    canonicalField: "crm.lifecycleStage",
    resolutionState: "single_source",
    canonicalValue: "customer",
    selectedObservationId: observation.id,
    resolvedAt: new Date("2026-08-19T00:00:00Z"),
  });

  const history = await getResolvedFactHistory(db!, account.id);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.canonicalValue, "lead");
  assert.equal(history[0]?.resolvedAt, new Date("2026-07-01T00:00:00Z").toISOString());
  assert.equal(history[1]?.canonicalValue, "customer");
});

test("getResolvedFactHistory never mixes another account's resolved_facts rows into this account's history", { skip }, async () => {
  const account = await makeAccount();
  const otherAccount = await makeAccount();
  const observation = await makeObservation();

  await insertResolvedFact({
    accountId: otherAccount.id,
    canonicalField: "crm.lifecycleStage",
    resolutionState: "single_source",
    canonicalValue: "customer",
    selectedObservationId: observation.id,
    resolvedAt: new Date("2026-08-19T00:00:00Z"),
  });

  const history = await getResolvedFactHistory(db!, account.id);
  assert.deepEqual(history, []);
});

test("getResolvedFactHistory reads an unresolved row (no evidence) with a null canonicalValue, never a placeholder value", { skip }, async () => {
  const account = await makeAccount();
  await insertResolvedFact({
    accountId: account.id,
    canonicalField: "company.region",
    resolutionState: "unresolved",
    canonicalValue: null,
    selectedObservationId: null,
    resolvedAt: new Date("2026-08-19T00:00:00Z"),
  });

  const history = await getResolvedFactHistory(db!, account.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.resolutionState, "unresolved");
  assert.equal(history[0]?.canonicalValue, null);
});

test.after(async () => {
  await pool?.end();
});
