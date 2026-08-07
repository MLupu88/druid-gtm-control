// Unit tests for ./clientRadarAccountAlias.ts's linked/already_linked/
// conflict classification. No database — a queue of canned responses,
// same shape as ../services/accountFacts.test.ts's makeFakeDb, since this
// function's own logic (insert-first, re-read only on a reported
// conflict, classify by comparing accountId) is exactly the kind of
// branching that pattern is meant to prove without a real Postgres
// connection. True concurrent-insert behavior against the real partial
// unique index (account_aliases_strong_type_normalized_value_uq) is
// proven in ./clientRadarAccountAlias.integration.test.ts — a fake queue
// cannot demonstrate a genuine database-level race, only that this
// function's code correctly handles the "insert reported zero rows"
// outcome a real race would produce (see the "loses the race" tests
// below).
//
// Run with: tsx --test src/services/clientRadarAccountAlias.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { linkClientRadarAccountAlias } from "./clientRadarAccountAlias.js";

type Db = NodePgDatabase<typeof schema>;

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_RADAR_ACCOUNT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function aliasRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountId: ACCOUNT_ID,
    aliasType: "client_radar_account_id",
    rawValue: CLIENT_RADAR_ACCOUNT_ID,
    normalizedValue: CLIENT_RADAR_ACCOUNT_ID,
    normalizationStrategy: "exact",
    isStrong: true,
    source: "client_radar",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Fake db: a queue of canned responses, one per root select()/insert()
// call, consumed in call order. Mirrors
// ../services/accountFacts.test.ts's makeFakeDb.
// ---------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface FakeQueryChain {
  from(...args: unknown[]): FakeQueryChain;
  where(...args: unknown[]): FakeQueryChain;
  limit(...args: unknown[]): FakeQueryChain;
  values(...args: unknown[]): FakeQueryChain;
  onConflictDoNothing(...args: unknown[]): FakeQueryChain;
  returning(...args: unknown[]): FakeQueryChain;
  then(resolve: (value: unknown) => void, reject?: (error: unknown) => void): void;
}

function makeFakeDb(queue: unknown[]): { db: Db; calls: RecordedCall[] } {
  let i = 0;
  const calls: RecordedCall[] = [];

  function record(method: string, args: unknown[], chainResult: FakeQueryChain): FakeQueryChain {
    calls.push({ method, args });
    return chainResult;
  }

  function chain(): FakeQueryChain {
    const result: FakeQueryChain = {
      from: (...args) => record("from", args, result),
      where: (...args) => record("where", args, result),
      limit: (...args) => record("limit", args, result),
      values: (...args) => record("values", args, result),
      onConflictDoNothing: (...args) => record("onConflictDoNothing", args, result),
      returning: (...args) => record("returning", args, result),
      then: (resolve, reject) => {
        const next = queue[i++];
        if (typeof next === "function") {
          try {
            resolve((next as () => unknown)());
          } catch (err) {
            (reject ?? (() => {}))(err);
          }
          return;
        }
        Promise.resolve(next).then(resolve, reject);
      },
    };
    return result;
  }

  const fakeDb = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return chain();
    },
    insert: (...args: unknown[]) => {
      calls.push({ method: "insert", args });
      return chain();
    },
  };

  return { db: fakeDb as unknown as Db, calls };
}

// ---------------------------------------------------------------------
// linked — the insert itself wins.
// ---------------------------------------------------------------------

test("fresh insert with no existing alias returns linked, and never issues a re-read select", async () => {
  const { db, calls } = makeFakeDb([[aliasRow()]]);

  const result = await linkClientRadarAccountAlias({
    db,
    accountId: ACCOUNT_ID,
    clientRadarAccountId: CLIENT_RADAR_ACCOUNT_ID,
  });

  assert.deepEqual(result, { outcome: "linked" });
  assert.equal(calls.filter((c) => c.method === "select").length, 0);
  assert.equal(calls.filter((c) => c.method === "insert").length, 1);
});

// ---------------------------------------------------------------------
// already_linked — insert reports a conflict, re-read shows the SAME
// account already holds the alias (an exact replay, or this call losing
// a race to an identical concurrent insert).
// ---------------------------------------------------------------------

test("same mapping already present returns already_linked, not a duplicate", async () => {
  const { db } = makeFakeDb([[], [aliasRow({ accountId: ACCOUNT_ID })]]);

  const result = await linkClientRadarAccountAlias({
    db,
    accountId: ACCOUNT_ID,
    clientRadarAccountId: CLIENT_RADAR_ACCOUNT_ID,
  });

  assert.deepEqual(result, { outcome: "already_linked" });
});

test("concurrency: insert loses the race to an identical concurrent insert (same accountId) -> already_linked, never a duplicate row", async () => {
  // Simulates: this call's INSERT ... ON CONFLICT DO NOTHING reports zero
  // rows because a concurrent transaction for the SAME (account,
  // clientRadarAccountId) pair committed first. The re-read finds exactly
  // what the racer created.
  const { db } = makeFakeDb([[], [aliasRow({ accountId: ACCOUNT_ID })]]);

  const result = await linkClientRadarAccountAlias({
    db,
    accountId: ACCOUNT_ID,
    clientRadarAccountId: CLIENT_RADAR_ACCOUNT_ID,
  });

  assert.equal(result.outcome, "already_linked");
});

// ---------------------------------------------------------------------
// conflict — insert reports a conflict, re-read shows a DIFFERENT
// account holds the alias. Never remaps.
// ---------------------------------------------------------------------

test("mapping already claimed by a different account returns conflict with the conflicting accountId, never remaps", async () => {
  const { db, calls } = makeFakeDb([[], [aliasRow({ accountId: OTHER_ACCOUNT_ID })]]);

  const result = await linkClientRadarAccountAlias({
    db,
    accountId: ACCOUNT_ID,
    clientRadarAccountId: CLIENT_RADAR_ACCOUNT_ID,
  });

  assert.deepEqual(result, { outcome: "conflict", conflictingAccountId: OTHER_ACCOUNT_ID });
  // No update()/set() call of any kind was ever issued.
  assert.equal(calls.some((c) => c.method === "update"), false);
});

test("concurrency: insert loses the race to a concurrent insert for a DIFFERENT account -> conflict, never remaps", async () => {
  // Simulates: a concurrent transaction linked this same Client Radar
  // account id to a different GTM account moments before this call's own
  // insert executed. This call must not remap it.
  const { db } = makeFakeDb([[], [aliasRow({ accountId: OTHER_ACCOUNT_ID })]]);

  const result = await linkClientRadarAccountAlias({
    db,
    accountId: ACCOUNT_ID,
    clientRadarAccountId: CLIENT_RADAR_ACCOUNT_ID,
  });

  assert.equal(result.outcome, "conflict");
  if (result.outcome === "conflict") {
    assert.equal(result.conflictingAccountId, OTHER_ACCOUNT_ID);
  }
});

// ---------------------------------------------------------------------
// Fail closed — the insert reported a conflict, but the re-read finds
// nothing at all. This combination is inexplicable; refuse to guess.
// ---------------------------------------------------------------------

test("insert conflict with no matching row on re-read throws rather than inventing a result", async () => {
  const { db } = makeFakeDb([[], []]);

  await assert.rejects(
    () =>
      linkClientRadarAccountAlias({
        db,
        accountId: ACCOUNT_ID,
        clientRadarAccountId: CLIENT_RADAR_ACCOUNT_ID,
      }),
    /insert conflicted .* but no existing strong alias was found/,
  );
});

// ---------------------------------------------------------------------
// Input guard
// ---------------------------------------------------------------------

test("a blank clientRadarAccountId throws before issuing any query", async () => {
  const { db, calls } = makeFakeDb([]);

  await assert.rejects(
    () => linkClientRadarAccountAlias({ db, accountId: ACCOUNT_ID, clientRadarAccountId: "   " }),
    /must not be blank/,
  );
  assert.equal(calls.length, 0);
});
