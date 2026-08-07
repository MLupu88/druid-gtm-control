// Integration tests for ./clientRadarAccountAlias.ts's
// linkClientRadarAccountAlias — specifically the guarantees a fake queue
// db (see ./clientRadarAccountAlias.test.ts) cannot prove: genuine
// concurrent inserts racing against the real partial unique index
// (account_aliases_strong_type_normalized_value_uq), and the actual
// account_aliases_normalized_value_matches_strategy CHECK for
// normalizationStrategy "exact".
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed against a real Postgres instance as part of this change (no
// database connection was made).
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/clientRadarAccountAlias.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { linkClientRadarAccountAlias } from "./clientRadarAccountAlias.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({
      accountKey: `dom:client-radar-account-alias-integration-${crypto.randomUUID()}.example`,
    })
    .returning();
  return account!.id;
}

async function countStrongAliasRows(clientRadarAccountId: string): Promise<number> {
  const rows = await db!
    .select()
    .from(schema.accountAliases)
    .where(
      and(
        eq(schema.accountAliases.aliasType, "client_radar_account_id"),
        eq(schema.accountAliases.normalizedValue, clientRadarAccountId),
        eq(schema.accountAliases.isStrong, true),
      ),
    );
  return rows.length;
}

test("fresh insert returns linked and persists exactly one strong alias row", { skip }, async () => {
  const accountId = await makeAccount();
  const crAccountId = crypto.randomUUID();

  const result = await linkClientRadarAccountAlias({ db: db!, accountId, clientRadarAccountId: crAccountId });

  assert.deepEqual(result, { outcome: "linked" });
  assert.equal(await countStrongAliasRows(crAccountId), 1);
});

test("repeat call with the same account + same Client Radar id returns already_linked, no duplicate row", { skip }, async () => {
  const accountId = await makeAccount();
  const crAccountId = crypto.randomUUID();

  const first = await linkClientRadarAccountAlias({ db: db!, accountId, clientRadarAccountId: crAccountId });
  assert.equal(first.outcome, "linked");

  const second = await linkClientRadarAccountAlias({ db: db!, accountId, clientRadarAccountId: crAccountId });
  assert.deepEqual(second, { outcome: "already_linked" });

  assert.equal(await countStrongAliasRows(crAccountId), 1);
});

test("the same Client Radar id already mapped to a different account returns conflict, never remaps, no duplicate row", { skip }, async () => {
  const accountA = await makeAccount();
  const accountB = await makeAccount();
  const crAccountId = crypto.randomUUID();

  const first = await linkClientRadarAccountAlias({ db: db!, accountId: accountA, clientRadarAccountId: crAccountId });
  assert.equal(first.outcome, "linked");

  const second = await linkClientRadarAccountAlias({ db: db!, accountId: accountB, clientRadarAccountId: crAccountId });
  assert.deepEqual(second, { outcome: "conflict", conflictingAccountId: accountA });

  assert.equal(await countStrongAliasRows(crAccountId), 1);
  const [row] = await db!
    .select()
    .from(schema.accountAliases)
    .where(eq(schema.accountAliases.normalizedValue, crAccountId));
  assert.equal(row?.accountId, accountA, "the original mapping must be untouched, never remapped to accountB");
});

// ---------------------------------------------------------------------
// Genuine concurrency — two real, concurrently-executing inserts racing
// on the partial unique index, exactly the scenario the fake queue db in
// ./clientRadarAccountAlias.test.ts can only simulate. Plain Promise.all
// is sufficient here (same convention as
// ../routes/signalResolution.integration.test.ts's "soft" concurrency
// tests): Postgres serializes the two INSERTs regardless of exact
// interleaving, so the outcome is deterministic even without a forced-
// overlap hook.
// ---------------------------------------------------------------------

test("concurrent inserts for the same Client Radar id targeting two different accounts: exactly one links, the other conflicts, exactly one row persists", { skip }, async () => {
  const accountA = await makeAccount();
  const accountB = await makeAccount();
  const crAccountId = crypto.randomUUID();

  const [resultA, resultB] = await Promise.all([
    linkClientRadarAccountAlias({ db: db!, accountId: accountA, clientRadarAccountId: crAccountId }),
    linkClientRadarAccountAlias({ db: db!, accountId: accountB, clientRadarAccountId: crAccountId }),
  ]);

  const outcomes = [resultA.outcome, resultB.outcome].sort();
  assert.deepEqual(outcomes, ["conflict", "linked"]);

  const winner = resultA.outcome === "linked" ? accountA : accountB;
  const loserResult = resultA.outcome === "linked" ? resultB : resultA;
  if (loserResult.outcome === "conflict") {
    assert.equal(loserResult.conflictingAccountId, winner);
  }

  assert.equal(await countStrongAliasRows(crAccountId), 1);
});

test("concurrent inserts for the same account + same Client Radar id (replayed/duplicated call): one links, the other reports already_linked, exactly one row persists", { skip }, async () => {
  const accountId = await makeAccount();
  const crAccountId = crypto.randomUUID();

  const [result1, result2] = await Promise.all([
    linkClientRadarAccountAlias({ db: db!, accountId, clientRadarAccountId: crAccountId }),
    linkClientRadarAccountAlias({ db: db!, accountId, clientRadarAccountId: crAccountId }),
  ]);

  const outcomes = [result1.outcome, result2.outcome].sort();
  assert.deepEqual(outcomes, ["already_linked", "linked"]);
  assert.equal(await countStrongAliasRows(crAccountId), 1);
});
