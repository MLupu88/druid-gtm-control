// Unit tests for the accounts read-model service. No database needed —
// every db interaction is a fake queue-based query-chain object (see
// makeFakeDb), same spirit as ../services/icpProfiles.test.ts's
// makeQueueTx: each root select()/selectDistinctOn() call consumes the
// next canned response in call order, and every chain method call is
// recorded so tests can assert on call counts/shape without a real
// Postgres connection.
//
// Run with: tsx --test src/services/accounts.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { Account, AccountEvaluation } from "@workspace/db/schema";
import {
  listAccounts,
  getAccountById,
  type AccountEvaluationSummary,
} from "./accounts.js";

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function syntheticAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    accountKey: "dom:example.test",
    companyDomain: "example.test",
    companyName: "Example Co",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function syntheticEvaluationSummary(
  overrides: Partial<AccountEvaluationSummary> = {},
): AccountEvaluationSummary {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    accountId: "11111111-1111-4111-8111-111111111111",
    snapshotId: "33333333-3333-4333-8333-333333333333",
    profileVersionId: "44444444-4444-4444-8444-444444444444",
    evaluatorVersionId: "55555555-5555-4555-8555-555555555555",
    evaluationMode: "production",
    status: "completed",
    errorDetail: null,
    fitScore: "10",
    fitTier: "high",
    intentScore: "5",
    intentTier: "warm",
    identityResolutionLevel: "contact",
    identityConfidence: "high",
    actionabilityScore: "3",
    eligibilityOutcome: "eligible",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    createdBy: null,
    ...overrides,
  };
}

function syntheticEvaluation(
  overrides: Partial<AccountEvaluation> = {},
): AccountEvaluation {
  return {
    ...syntheticEvaluationSummary(),
    profileConfigSnapshot: { configSchemaVersion: "v1" },
    eligibilityRestrictions: [],
    hardDisqualifiers: [],
    scoreComponents: [],
    matchedRules: [],
    missingInputs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Fake db: a queue of canned responses, one per root select()/
// selectDistinctOn() call, consumed in call order. Every chain method is
// recorded (with its arguments) onto a shared `calls` array.
// ---------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

function makeFakeDb(queue: unknown[]) {
  let i = 0;
  const calls: RecordedCall[] = [];

  function chain(): any {
    const obj: any = {};
    for (const method of ["from", "innerJoin", "where", "orderBy", "limit", "offset"]) {
      obj[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return obj;
      };
    }
    obj.then = (
      resolve: (v: unknown) => void,
      reject?: (e: unknown) => void,
    ) => {
      Promise.resolve(queue[i++]).then(resolve, reject);
    };
    return obj;
  }

  const db: any = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return chain();
    },
    selectDistinctOn: (...args: unknown[]) => {
      calls.push({ method: "selectDistinctOn", args });
      return chain();
    },
  };

  return { db, calls };
}

// ---------------------------------------------------------------------
// listAccounts
// ---------------------------------------------------------------------

test("listAccounts shapes total and returns [] items without querying evaluations when the page is empty", async () => {
  const { db, calls } = makeFakeDb([[{ value: 5 }], []]);

  const result = await listAccounts({ db, limit: 50, offset: 0 });

  assert.equal(result.total, 5);
  assert.deepEqual(result.items, []);
  assert.equal(calls.filter((c) => c.method === "selectDistinctOn").length, 0);
});

test("listAccounts orders accounts deterministically (updatedAt desc, id desc)", async () => {
  const a1 = syntheticAccount({ id: "a1" });
  const { db, calls } = makeFakeDb([[{ value: 1 }], [a1], [], [], []]);

  await listAccounts({ db, limit: 50, offset: 0 });

  const accountsOrderByCall = calls.find(
    (c, idx) =>
      c.method === "orderBy" &&
      calls.slice(0, idx).some((prev) => prev.method === "from"),
  );
  assert.ok(accountsOrderByCall);
  // Two order-by expressions: updatedAt desc, then id desc.
  assert.equal(accountsOrderByCall!.args.length, 2);
});

test("listAccounts returns null latestEvaluation/latestProductionEvaluation/latestDecision for an account with no evaluations or decisions", async () => {
  const account = syntheticAccount();
  const { db } = makeFakeDb([[{ value: 1 }], [account], [], [], []]);

  const result = await listAccounts({ db, limit: 50, offset: 0 });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.latestEvaluation, null);
  assert.equal(result.items[0]?.latestProductionEvaluation, null);
  assert.equal(result.items[0]?.latestDecision, null);
});

test("listAccounts maps latestEvaluation and latestProductionEvaluation independently per account", async () => {
  const accountA = syntheticAccount({ id: "acc-a" });
  const accountB = syntheticAccount({ id: "acc-b" });
  const latestA = syntheticEvaluationSummary({
    id: "eval-a-latest",
    accountId: "acc-a",
  });
  const latestProductionB = syntheticEvaluationSummary({
    id: "eval-b-production",
    accountId: "acc-b",
  });
  const { db } = makeFakeDb([
    [{ value: 2 }],
    [accountA, accountB],
    [latestA], // latestEvaluation query: only account A has a row
    [latestProductionB], // latestProductionEvaluation query: only account B has a row
    [], // latestDecision query: neither account has a decision
  ]);

  const result = await listAccounts({ db, limit: 50, offset: 0 });

  const itemA = result.items.find((i) => i.account.id === "acc-a");
  const itemB = result.items.find((i) => i.account.id === "acc-b");
  assert.equal(itemA?.latestEvaluation, latestA);
  assert.equal(itemA?.latestProductionEvaluation, null);
  assert.equal(itemB?.latestEvaluation, null);
  assert.equal(itemB?.latestProductionEvaluation, latestProductionB);
});

test("listAccounts: a preview evaluation newer than the latest production evaluation surfaces separately in each field", async () => {
  const account = syntheticAccount();
  const previewLatest = syntheticEvaluationSummary({
    id: "eval-preview-newest",
    evaluationMode: "preview",
    createdAt: new Date("2026-02-01T00:00:00Z"),
  });
  const productionOlder = syntheticEvaluationSummary({
    id: "eval-production-older",
    evaluationMode: "production",
    createdAt: new Date("2026-01-15T00:00:00Z"),
  });
  const { db } = makeFakeDb([
    [{ value: 1 }],
    [account],
    [previewLatest], // unfiltered DISTINCT ON picks the newest overall: the preview row
    [productionOlder], // production-filtered DISTINCT ON picks the newest production row
    [], // latestDecision query: no decision yet
  ]);

  const result = await listAccounts({ db, limit: 50, offset: 0 });

  assert.equal(result.items[0]?.latestEvaluation, previewLatest);
  assert.equal(result.items[0]?.latestProductionEvaluation, productionOlder);
});

test("listAccounts: when the latest evaluation is itself the latest production evaluation, both fields return it (no null/dedup special-casing)", async () => {
  const account = syntheticAccount();
  const evaluation = syntheticEvaluationSummary({
    id: "eval-both",
    evaluationMode: "production",
  });
  const { db } = makeFakeDb([
    [{ value: 1 }],
    [account],
    [evaluation],
    [evaluation],
    [],
  ]);

  const result = await listAccounts({ db, limit: 50, offset: 0 });

  assert.equal(result.items[0]?.latestEvaluation, evaluation);
  assert.equal(result.items[0]?.latestProductionEvaluation, evaluation);
});

test("listAccounts maps latestDecision per account, independently of latestEvaluation/latestProductionEvaluation", async () => {
  const accountA = syntheticAccount({ id: "acc-a" });
  const accountB = syntheticAccount({ id: "acc-b" });
  const decisionA = {
    id: "88888888-8888-4888-8888-888888888888",
    routingOutput: "dismissed" as const,
    createdAt: new Date("2026-03-01T00:00:00Z"),
  };
  const { db } = makeFakeDb([
    [{ value: 2 }],
    [accountA, accountB],
    [],
    [],
    [{ accountId: "acc-a", ...decisionA }], // only account A has a decision
  ]);

  const result = await listAccounts({ db, limit: 50, offset: 0 });

  const itemA = result.items.find((i) => i.account.id === "acc-a");
  const itemB = result.items.find((i) => i.account.id === "acc-b");
  assert.deepEqual(itemA?.latestDecision, decisionA);
  assert.equal(itemB?.latestDecision, null);
});

test("listAccounts issues exactly five queries total regardless of how many accounts are on the page (no N+1)", async () => {
  const manyAccounts = Array.from({ length: 25 }, (_, i) =>
    syntheticAccount({ id: `acc-${i}` }),
  );
  const { db, calls } = makeFakeDb([
    [{ value: 25 }],
    manyAccounts,
    [],
    [],
    [],
  ]);

  await listAccounts({ db, limit: 100, offset: 0 });

  const rootCalls = calls.filter(
    (c) => c.method === "select" || c.method === "selectDistinctOn",
  );
  assert.equal(rootCalls.length, 5);
});

// ---------------------------------------------------------------------
// getAccountById
// ---------------------------------------------------------------------

test("getAccountById returns undefined when the account does not exist", async () => {
  const { db } = makeFakeDb([[]]);

  const result = await getAccountById(db, "does-not-exist");

  assert.equal(result, undefined);
});

test("getAccountById returns the account with its exact evaluation rows in deterministic order", async () => {
  const account = syntheticAccount();
  const newer = syntheticEvaluation({
    id: "eval-newer",
    createdAt: new Date("2026-02-01T00:00:00Z"),
  });
  const older = syntheticEvaluation({
    id: "eval-older",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  const { db, calls } = makeFakeDb([[account], [newer, older]]);

  const result = await getAccountById(db, account.id);

  assert.equal(result?.account, account);
  assert.deepEqual(result?.evaluations, [newer, older]);
  const evaluationsOrderByCall = calls.find(
    (c, idx) =>
      c.method === "orderBy" &&
      calls.slice(0, idx).filter((prev) => prev.method === "from").length === 2,
  );
  assert.ok(evaluationsOrderByCall);
  assert.equal(evaluationsOrderByCall!.args.length, 2);
});
