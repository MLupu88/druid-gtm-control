// Unit tests for ./clientRadarResearchRuns.ts's
// persistCompletedClientRadarResult — the local-only completion write
// (accountPayload/evidencePayload persistence + Client Radar account-id
// alias link + conflict attention item), extracted from
// syncClientRadarResearchResult specifically so it's testable without
// mocking the HTTP layer (see that function's own doc comment). No
// database — a queue of canned responses, same shape as
// ../services/accountFacts.test.ts's makeFakeDb, extended with
// transaction() since this is (like recordAccountFact) a multi-statement
// db.transaction(). True Postgres-level atomicity (a thrown error
// actually rolling back a committed statement) is proven by
// ../services/attentionItems.integration.test.ts's own precedent
// discussion, not re-proven here — this file proves the JS-level
// branching and call sequencing: what gets written, in what order, and
// that a thrown error prevents the function from returning a result.
//
// Run with: tsx --test src/services/clientRadarResearchRuns.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accountFacts, accountFactCurrent } from "@workspace/db/schema";
import type { ClientRadarResultAccount } from "../lib/clientRadarClient.js";
import { persistCompletedClientRadarResult } from "./clientRadarResearchRuns.js";

type Db = NodePgDatabase<typeof schema>;

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const RESEARCH_RUN_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_RADAR_ACCOUNT_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const NOW = new Date("2026-02-01T00:00:00Z");

function researchRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESEARCH_RUN_ID,
    accountId: ACCOUNT_ID,
    clientRadarRunId: "cr_run_1",
    status: "completed",
    submittedAt: NOW,
    lastPolledAt: NOW,
    completedAt: NOW,
    failedAt: null,
    lastError: null,
    accountPayload: { id: CLIENT_RADAR_ACCOUNT_ID, account_key: "acme-corp" },
    evidencePayload: [],
    resultSchemaVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function completedResult(overrides: Partial<ClientRadarResultAccount> = {}): ClientRadarResultAccount {
  return {
    company: "Acme Corp",
    domain: "acme.example",
    country: "US",
    industry: "Manufacturing",
    account: { id: CLIENT_RADAR_ACCOUNT_ID, account_key: "acme-corp" },
    clientRadarAccountId: CLIENT_RADAR_ACCOUNT_ID,
    evidence: { items: [{ id: "ev_1", source_type: "web", title: null, url: null, content: null, created_at: NOW.toISOString() }], total: 1 },
    ...overrides,
  };
}

function attentionItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountId: ACCOUNT_ID,
    reasonCode: "client_radar_identity_conflict",
    reasonDetail: null,
    source: "client_radar",
    sourceRef: CLIENT_RADAR_ACCOUNT_ID,
    context: {},
    status: "open",
    createdAt: NOW,
    createdBy: "system:client_radar",
    resolvedAt: null,
    resolvedBy: null,
    resolutionReason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Fake db: a queue of canned responses, one per root select()/insert()/
// update() call, consumed in call order. transaction() invokes the
// callback with the fake db itself as `tx` — no real isolation, but
// sufficient to prove this function's own branching/sequencing (mirrors
// ../services/accountFacts.test.ts's makeFakeDb).
// ---------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface FakeQueryChain {
  from(...args: unknown[]): FakeQueryChain;
  where(...args: unknown[]): FakeQueryChain;
  limit(...args: unknown[]): FakeQueryChain;
  set(...args: unknown[]): FakeQueryChain;
  values(...args: unknown[]): FakeQueryChain;
  onConflictDoNothing(...args: unknown[]): FakeQueryChain;
  returning(...args: unknown[]): FakeQueryChain;
  then(resolve: (value: unknown) => void, reject?: (error: unknown) => void): void;
}

interface FakeDbSurface {
  select(...args: unknown[]): FakeQueryChain;
  insert(...args: unknown[]): FakeQueryChain;
  update(...args: unknown[]): FakeQueryChain;
  transaction<T>(cb: (tx: FakeDbSurface) => Promise<T>): Promise<T>;
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
      set: (...args) => record("set", args, result),
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

  const fakeDb: FakeDbSurface = {
    select: (...args) => {
      calls.push({ method: "select", args });
      return chain();
    },
    insert: (...args) => {
      calls.push({ method: "insert", args });
      return chain();
    },
    update: (...args) => {
      calls.push({ method: "update", args });
      return chain();
    },
    transaction: async (cb) => cb(fakeDb),
  };

  return { db: fakeDb as unknown as Db, calls };
}

// ---------------------------------------------------------------------
// Happy path: payload + alias persist atomically.
// ---------------------------------------------------------------------

test("completion persists accountPayload/evidencePayload and links the Client Radar account alias in one pass", async () => {
  const updatedRow = researchRunRow();
  // Queue order: (1) UPDATE client_radar_research_runs .. RETURNING,
  // (2) INSERT account_aliases .. ON CONFLICT DO NOTHING .. RETURNING
  // (linked — no re-read select follows).
  const { db, calls } = makeFakeDb([[updatedRow], [{ id: "alias_1" }]]);

  const result = await persistCompletedClientRadarResult(db, RESEARCH_RUN_ID, NOW, completedResult());

  assert.equal(result.status, "completed");
  assert.deepEqual(result.accountPayload, { id: CLIENT_RADAR_ACCOUNT_ID, account_key: "acme-corp" });
  assert.equal(calls.filter((c) => c.method === "update").length, 1);
  assert.equal(calls.filter((c) => c.method === "insert").length, 1);
  // No conflict occurred, so no attention item insert should have
  // followed the alias insert.
  assert.equal(calls.filter((c) => c.method === "select").length, 0);
});

test("repeated completion for the same GTM account + same Client Radar id does not attempt a duplicate insert path beyond the standard insert-first attempt", async () => {
  const updatedRow = researchRunRow();
  // Second call: the alias insert reports zero rows (already exists),
  // the re-read finds it belongs to the SAME account -> already_linked.
  const { db, calls } = makeFakeDb([[updatedRow], [], [{ accountId: ACCOUNT_ID, aliasType: "client_radar_account_id" }]]);

  const result = await persistCompletedClientRadarResult(db, RESEARCH_RUN_ID, NOW, completedResult());

  assert.equal(result.status, "completed");
  // The alias write path was attempted (insert), found already present
  // (select), but never issued any update/remap.
  assert.equal(calls.filter((c) => c.method === "insert").length, 1);
  assert.equal(calls.filter((c) => c.method === "select").length, 1);
});

// ---------------------------------------------------------------------
// Conflict: payload still persists, alias withheld, exactly one
// attention item created, never remapped.
// ---------------------------------------------------------------------

test("conflict persists the completed research payload, creates no alias, and creates exactly one open attention item", async () => {
  const updatedRow = researchRunRow();
  // Queue: (1) run update, (2) alias insert -> [] (conflict reported),
  // (3) re-read -> a DIFFERENT account holds it, (4) createAttentionItem's
  // own account-existence SELECT, (5) createAttentionItem's own nested
  // db.transaction() -> insert -> returning.
  const { db, calls } = makeFakeDb([
    [updatedRow],
    [],
    [{ accountId: OTHER_ACCOUNT_ID, aliasType: "client_radar_account_id" }],
    [{ id: ACCOUNT_ID }],
    [attentionItemRow()],
  ]);

  const result = await persistCompletedClientRadarResult(db, RESEARCH_RUN_ID, NOW, completedResult());

  // The research payload is persisted regardless of the identity
  // conflict — research succeeded, only identity linkage is withheld.
  assert.equal(result.status, "completed");
  assert.deepEqual(result.accountPayload, { id: CLIENT_RADAR_ACCOUNT_ID, account_key: "acme-corp" });

  const insertCalls = calls.filter((c) => c.method === "insert");
  // Exactly two inserts total: the (conflicting, discarded) alias
  // attempt, and the attention item. No second alias insert (no remap
  // retry) and no accountFacts insert of any kind.
  assert.equal(insertCalls.length, 2);
});

test("conflict never creates an alias for the wrong (requesting) GTM account", async () => {
  const updatedRow = researchRunRow({ accountId: ACCOUNT_ID });
  const { db, calls } = makeFakeDb([
    [updatedRow],
    [],
    [{ accountId: OTHER_ACCOUNT_ID, aliasType: "client_radar_account_id" }],
    [{ id: ACCOUNT_ID }],
    [attentionItemRow()],
  ]);

  await persistCompletedClientRadarResult(db, RESEARCH_RUN_ID, NOW, completedResult());

  // The alias insert's .values(...) call is the first insert's values
  // argument — assert it targeted ACCOUNT_ID (the requesting account),
  // never OTHER_ACCOUNT_ID (the account the conflicting alias actually
  // belongs to).
  const insertValuesCalls = calls.filter((c) => c.method === "values");
  const aliasValuesCall = insertValuesCalls[0]?.args[0] as Record<string, unknown> | undefined;
  assert.equal(aliasValuesCall?.accountId, ACCOUNT_ID);
  // Exactly one UPDATE ever runs (the run's own status/payload update) —
  // no update ever remaps an existing alias row (linkClientRadarAccountAlias
  // only ever inserts or reads, never updates).
  assert.equal(calls.filter((c) => c.method === "update").length, 1);
});

// ---------------------------------------------------------------------
// Atomicity: an unexpected failure during the alias step must roll back
// the whole function (no partial result returned, no swallowed error).
// ---------------------------------------------------------------------

test("an unexpected alias-step failure propagates out (rolls back the whole local completion) rather than returning a partial result", async () => {
  const updatedRow = researchRunRow();
  // The alias insert itself throws (simulates a genuine DB error, not
  // the expected onConflictDoNothing-empty-result path).
  const { db } = makeFakeDb([
    [updatedRow],
    () => {
      throw new Error("simulated unexpected database error");
    },
  ]);

  await assert.rejects(
    () => persistCompletedClientRadarResult(db, RESEARCH_RUN_ID, NOW, completedResult()),
    /simulated unexpected database error/,
  );
});

test("the fail-closed error from linkClientRadarAccountAlias (conflict reported but re-read finds nothing) also propagates and rolls back", async () => {
  const updatedRow = researchRunRow();
  const { db } = makeFakeDb([[updatedRow], [], []]);

  await assert.rejects(
    () => persistCompletedClientRadarResult(db, RESEARCH_RUN_ID, NOW, completedResult()),
    /insert conflicted .* but no existing strong alias was found/,
  );
});

// ---------------------------------------------------------------------
// No account_facts involvement, ever.
// ---------------------------------------------------------------------

test("no accountFacts table is touched by research completion, linked or conflicting", async () => {
  const updatedRow = researchRunRow();
  const { db, calls } = makeFakeDb([
    [updatedRow],
    [],
    [{ accountId: OTHER_ACCOUNT_ID, aliasType: "client_radar_account_id" }],
    [{ id: ACCOUNT_ID }],
    [attentionItemRow()],
  ]);

  await persistCompletedClientRadarResult(db, RESEARCH_RUN_ID, NOW, completedResult());

  // Identity-check every insert()/update() table argument against the
  // real accountFacts/accountFactCurrent table objects — this function
  // (and everything it calls: linkClientRadarAccountAlias,
  // createAttentionItem) must never target either, conflict or not.
  const tableArgs = calls.filter((c) => c.method === "insert" || c.method === "update").map((c) => c.args[0]);
  assert.equal(tableArgs.includes(accountFacts as unknown), false);
  assert.equal(tableArgs.includes(accountFactCurrent as unknown), false);
});

// ---------------------------------------------------------------------
// No Client Radar account id on the result (account: null) — nothing to
// link, not a failure.
// ---------------------------------------------------------------------

test("a completed result with no Client Radar account (account: null) persists the payload and attempts no alias link", async () => {
  const updatedRow = researchRunRow({ accountPayload: null });
  const { db, calls } = makeFakeDb([[updatedRow]]);

  const result = await persistCompletedClientRadarResult(
    db,
    RESEARCH_RUN_ID,
    NOW,
    completedResult({ account: null, clientRadarAccountId: null }),
  );

  assert.equal(result.status, "completed");
  assert.equal(calls.filter((c) => c.method === "insert").length, 0);
});
