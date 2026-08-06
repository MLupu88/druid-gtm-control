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
import type { Account, AccountEvaluation, AccountSnapshot } from "@workspace/db/schema";
import { IcpProfileConfigV1Schema, isIntentConfigured } from "@workspace/evaluator";
import {
  listAccounts,
  getAccountById,
  type AccountEvaluationSummary,
  type AccountEvaluationDetail,
} from "./accounts.js";
import { deriveMqlDecisionReadiness } from "./mqlDecisionReadiness.js";

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

// A real, schema-valid IcpProfileConfigV1 with one configured intent
// rule — used as the default profileConfigSnapshot below so
// toEvaluationSummary's IcpProfileConfigV1Schema.safeParse() (in
// ./accounts.ts) always succeeds against these fixtures.
const SYNTHETIC_INTENT_CONFIGURED_SNAPSHOT: unknown = {
  configSchemaVersion: "v1",
  fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
  intent: {
    rules: [
      {
        id: "has_engagement",
        description: "Has any engagement source",
        points: 5,
        condition: { op: "exists", field: "engagement.sources" },
      },
    ],
    tiers: [{ code: "floor", minScore: 0 }],
  },
  actionability: { rules: [] },
  eligibility: { hardDisqualifiers: [], restrictions: [] },
};

// The snapshot id every syntheticEvaluationSummary/syntheticEvaluation
// fixture uses by default — matched against SYNTHETIC_SNAPSHOT below so
// tests can assert the real deriveMqlDecisionReadiness derivation instead
// of a hand-guessed one.
const SYNTHETIC_SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";

type SnapshotRow = Pick<
  AccountSnapshot,
  "id" | "accountId" | "source" | "rawInput" | "normalizedInput"
>;

// The account id every syntheticEvaluationSummary/syntheticEvaluation
// fixture's accountId uses by default (see line ~101 below) — reused here
// so syntheticSnapshotRow's accountId matches, as a real
// account_snapshots row's would.
const SYNTHETIC_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

// A recognized (gtm-account-current-state-v1), evidence-bearing snapshot
// — company.domain/name are non-blank so any fit rule referencing only
// those two fields resolves; engagement/contact/crm/consent are absent
// from this fixture's normalizedInput entirely, so any rule referencing
// them is correctly treated as unevidenced by
// ./mqlDecisionReadiness.ts's deriveMqlDecisionReadiness. rawInput is
// irrelevant to the v1 resolver (unlike v2's) and left empty here.
function syntheticSnapshotRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: SYNTHETIC_SNAPSHOT_ID,
    accountId: SYNTHETIC_ACCOUNT_ID,
    source: "gtm-account-current-state-v1",
    rawInput: {},
    normalizedInput: { company: { domain: "example.test", name: "Example Co" } },
    ...overrides,
  };
}

// The raw shape a DISTINCT ON query row has BEFORE ./accounts.ts's
// toEvaluationSummary strips profileConfigSnapshot and derives
// intentConfigured/mqlDecisionReadiness — distinct from
// AccountEvaluationSummary (the shape listAccounts() actually returns),
// which has no profileConfigSnapshot and real derived values instead.
type RawEvaluationSummaryRow = Omit<
  AccountEvaluationSummary,
  "intentConfigured" | "mqlDecisionReadiness"
> & {
  profileConfigSnapshot: unknown;
};

function syntheticEvaluationSummary(
  overrides: Partial<RawEvaluationSummaryRow> = {},
): RawEvaluationSummaryRow {
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
    profileConfigSnapshot: SYNTHETIC_INTENT_CONFIGURED_SNAPSHOT,
    ...overrides,
  };
}

// Mirrors ./accounts.ts's toEvaluationSummary exactly, so tests can
// assert listAccounts()'s actual output (which is a NEW object, not the
// same reference as the raw fake-db row) against a truthfully-derived
// expectation rather than a hand-guessed one. `snapshot` mirrors what the
// service's own batched account_snapshots lookup would have found for
// this row's snapshotId (undefined when no matching row was returned).
function expectedSummary(
  row: RawEvaluationSummaryRow,
  snapshot: SnapshotRow | undefined,
): AccountEvaluationSummary {
  const { profileConfigSnapshot, ...rest } = row;
  return {
    ...rest,
    intentConfigured: isIntentConfigured(
      IcpProfileConfigV1Schema.parse(profileConfigSnapshot),
    ),
    mqlDecisionReadiness: deriveMqlDecisionReadiness(
      {
        status: row.status,
        evaluationMode: row.evaluationMode,
        profileConfigSnapshot,
      },
      snapshot ?? null,
    ),
  };
}

function syntheticEvaluation(
  overrides: Partial<AccountEvaluation> = {},
): AccountEvaluation {
  return {
    ...syntheticEvaluationSummary(),
    // A schema-VALID minimal config (not the bare { configSchemaVersion: "v1" }
    // placeholder used elsewhere for a deliberately-invalid-config test) —
    // getAccountById's mqlDecisionReadiness derivation parses this via
    // IcpProfileConfigV1Schema for every row, unconditionally.
    profileConfigSnapshot: {
      configSchemaVersion: "v1",
      fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
      intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
      actionability: { rules: [] },
      eligibility: { hardDisqualifiers: [], restrictions: [] },
    },
    eligibilityRestrictions: [],
    hardDisqualifiers: [],
    scoreComponents: [],
    matchedRules: [],
    missingInputs: [],
    ...overrides,
  };
}

// Mirrors ./accounts.ts's getAccountById mapping exactly (spread the raw
// row, attach the real derivation), same intent as expectedSummary above.
function expectedEvaluationDetail(
  row: AccountEvaluation,
  snapshot: SnapshotRow | undefined,
): AccountEvaluationDetail {
  return {
    ...row,
    mqlDecisionReadiness: deriveMqlDecisionReadiness(row, snapshot ?? null),
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
    for (const method of ["from", "innerJoin", "where", "orderBy", "groupBy", "limit", "offset"]) {
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

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  assert.equal(result.total, 5);
  assert.deepEqual(result.items, []);
  assert.equal(calls.filter((c) => c.method === "selectDistinctOn").length, 0);
});

test("listAccounts does not run the attention aggregate query when the account page is empty", async () => {
  const { db, calls } = makeFakeDb([[{ value: 0 }], []]);

  await listAccounts({ db, limit: 50, offset: 0, needsAttention: true });

  // Only the count and the (empty) page query ran — no further select()
  // calls at all, so the attention GROUP BY query (and the evaluation/
  // decision DISTINCT ON queries) never fired.
  assert.equal(calls.filter((c) => c.method === "select").length, 2);
  assert.equal(calls.filter((c) => c.method === "groupBy").length, 0);
});

test("listAccounts orders accounts deterministically (updatedAt desc, id desc)", async () => {
  const a1 = syntheticAccount({ id: "a1" });
  const { db, calls } = makeFakeDb([[{ value: 1 }], [a1], [], [], [], []]);

  await listAccounts({ db, limit: 50, offset: 0, needsAttention: false });

  const accountsOrderByCall = calls.find(
    (c, idx) =>
      c.method === "orderBy" &&
      calls.slice(0, idx).some((prev) => prev.method === "from"),
  );
  assert.ok(accountsOrderByCall);
  // Two order-by expressions: updatedAt desc, then id desc.
  assert.equal(accountsOrderByCall!.args.length, 2);
});

test("listAccounts does not filter the base account query or its count when needsAttention is false", async () => {
  const account = syntheticAccount();
  const { db, calls } = makeFakeDb([[{ value: 1 }], [account], [], [], [], []]);

  await listAccounts({ db, limit: 50, offset: 0, needsAttention: false });

  // Every where() call recorded across both the count and page queries on
  // `accounts` must have been invoked with `undefined` (drizzle's "no
  // filter" value) — the EXISTS filter must never be applied when
  // needsAttention is false.
  const whereCalls = calls.filter((c) => c.method === "where");
  assert.ok(whereCalls.length >= 2);
  for (const call of whereCalls.slice(0, 2)) {
    assert.equal(call.args[0], undefined);
  }
});

test("listAccounts applies the same EXISTS filter to both the count query and the page query when needsAttention is true", async () => {
  const account = syntheticAccount();
  const { db, calls } = makeFakeDb([[{ value: 1 }], [account], [], [], [], []]);

  await listAccounts({ db, limit: 50, offset: 0, needsAttention: true });

  const whereCalls = calls.filter((c) => c.method === "where");
  // The count query's where() and the page query's where() must both have
  // received a real (non-undefined) filter expression, and the same one —
  // never a post-fetch filter applied only to one of the two.
  assert.ok(whereCalls.length >= 2);
  assert.notEqual(whereCalls[0]?.args[0], undefined);
  assert.deepEqual(whereCalls[0]?.args[0], whereCalls[1]?.args[0]);
});

test("listAccounts returns null latestEvaluation/latestProductionEvaluation/latestDecision for an account with no evaluations or decisions", async () => {
  const account = syntheticAccount();
  const { db } = makeFakeDb([[{ value: 1 }], [account], [], [], [], []]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.latestEvaluation, null);
  assert.equal(result.items[0]?.latestProductionEvaluation, null);
  assert.equal(result.items[0]?.latestDecision, null);
  assert.equal(result.items[0]?.attention, null);
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
  const snapshot = syntheticSnapshotRow();
  const { db } = makeFakeDb([
    [{ value: 2 }],
    [accountA, accountB],
    [latestA], // latestEvaluation query: only account A has a row
    [latestProductionB], // latestProductionEvaluation query: only account B has a row
    [], // latestDecision query: neither account has a decision
    [], // attention aggregate query: neither account has an open item
    [snapshot], // batched account_snapshots lookup for the readiness derivation
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  const itemA = result.items.find((i) => i.account.id === "acc-a");
  const itemB = result.items.find((i) => i.account.id === "acc-b");
  assert.deepEqual(itemA?.latestEvaluation, expectedSummary(latestA, snapshot));
  assert.equal(itemA?.latestProductionEvaluation, null);
  assert.equal(itemB?.latestEvaluation, null);
  assert.deepEqual(
    itemB?.latestProductionEvaluation,
    expectedSummary(latestProductionB, snapshot),
  );
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
  const snapshot = syntheticSnapshotRow();
  const { db } = makeFakeDb([
    [{ value: 1 }],
    [account],
    [previewLatest], // unfiltered DISTINCT ON picks the newest overall: the preview row
    [productionOlder], // production-filtered DISTINCT ON picks the newest production row
    [], // latestDecision query: no decision yet
    [], // attention aggregate query: no open items
    [snapshot], // batched account_snapshots lookup for the readiness derivation
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  assert.deepEqual(
    result.items[0]?.latestEvaluation,
    expectedSummary(previewLatest, snapshot),
  );
  assert.deepEqual(
    result.items[0]?.latestProductionEvaluation,
    expectedSummary(productionOlder, snapshot),
  );
});

test("listAccounts: when the latest evaluation is itself the latest production evaluation, both fields return it (no null/dedup special-casing)", async () => {
  const account = syntheticAccount();
  const evaluation = syntheticEvaluationSummary({
    id: "eval-both",
    evaluationMode: "production",
  });
  const snapshot = syntheticSnapshotRow();
  const { db } = makeFakeDb([
    [{ value: 1 }],
    [account],
    [evaluation],
    [evaluation],
    [],
    [],
    [snapshot],
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  assert.deepEqual(
    result.items[0]?.latestEvaluation,
    expectedSummary(evaluation, snapshot),
  );
  assert.deepEqual(
    result.items[0]?.latestProductionEvaluation,
    expectedSummary(evaluation, snapshot),
  );
});

test("listAccounts derives intentConfigured=true when the evaluation's profileConfigSnapshot has at least one intent rule", async () => {
  const account = syntheticAccount();
  const evaluation = syntheticEvaluationSummary({
    profileConfigSnapshot: SYNTHETIC_INTENT_CONFIGURED_SNAPSHOT,
  });
  const { db } = makeFakeDb([
    [{ value: 1 }],
    [account],
    [evaluation],
    [evaluation],
    [],
    [],
    [syntheticSnapshotRow()],
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  assert.equal(result.items[0]?.latestEvaluation?.intentConfigured, true);
  assert.equal("profileConfigSnapshot" in (result.items[0]?.latestEvaluation ?? {}), false);
});

test("listAccounts derives intentConfigured=false when the evaluation's profileConfigSnapshot has no intent rules", async () => {
  const account = syntheticAccount();
  const evaluation = syntheticEvaluationSummary({
    profileConfigSnapshot: {
      configSchemaVersion: "v1",
      fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
      intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
      actionability: { rules: [] },
      eligibility: { hardDisqualifiers: [], restrictions: [] },
    },
  });
  const { db } = makeFakeDb([
    [{ value: 1 }],
    [account],
    [evaluation],
    [evaluation],
    [],
    [],
    [syntheticSnapshotRow()],
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  assert.equal(result.items[0]?.latestEvaluation?.intentConfigured, false);
});

test("listAccounts returns latestEvaluation/latestProductionEvaluation: null (never throws, never fails the list) for a persisted evaluation whose profileConfigSnapshot fails schema validation", async () => {
  const account = syntheticAccount();
  const evaluation = syntheticEvaluationSummary({
    profileConfigSnapshot: { configSchemaVersion: "v1" }, // missing fit/intent/actionability/eligibility
  });
  const { db } = makeFakeDb([
    [{ value: 1 }],
    [account],
    [evaluation],
    [evaluation],
    [],
    [],
    [syntheticSnapshotRow()],
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.latestEvaluation, null);
  assert.equal(result.items[0]?.latestProductionEvaluation, null);
});

test("listAccounts: an invalid profileConfigSnapshot on one account's evaluation does not affect another account's valid evaluation summary", async () => {
  const validAccount = syntheticAccount({ id: "acc-valid" });
  const invalidAccount = syntheticAccount({ id: "acc-invalid" });
  const validEvaluation = syntheticEvaluationSummary({
    id: "eval-valid",
    accountId: "acc-valid",
  });
  const invalidEvaluation = syntheticEvaluationSummary({
    id: "eval-invalid",
    accountId: "acc-invalid",
    profileConfigSnapshot: { configSchemaVersion: "v1" }, // missing fit/intent/actionability/eligibility
  });
  const snapshot = syntheticSnapshotRow();
  const { db } = makeFakeDb([
    [{ value: 2 }],
    [validAccount, invalidAccount],
    [validEvaluation, invalidEvaluation],
    [validEvaluation, invalidEvaluation],
    [],
    [],
    [snapshot],
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  const validItem = result.items.find((i) => i.account.id === "acc-valid");
  const invalidItem = result.items.find((i) => i.account.id === "acc-invalid");
  assert.deepEqual(
    validItem?.latestEvaluation,
    expectedSummary(validEvaluation, snapshot),
  );
  assert.equal(invalidItem?.latestEvaluation, null);
  assert.equal(invalidItem?.latestProductionEvaluation, null);
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
    [],
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  const itemA = result.items.find((i) => i.account.id === "acc-a");
  const itemB = result.items.find((i) => i.account.id === "acc-b");
  assert.deepEqual(itemA?.latestDecision, decisionA);
  assert.equal(itemB?.latestDecision, null);
});

test("listAccounts issues exactly six queries total regardless of how many accounts are on the page (no N+1)", async () => {
  const manyAccounts = Array.from({ length: 25 }, (_, i) =>
    syntheticAccount({ id: `acc-${i}` }),
  );
  const { db, calls } = makeFakeDb([
    [{ value: 25 }],
    manyAccounts,
    [],
    [],
    [],
    [],
  ]);

  await listAccounts({ db, limit: 100, offset: 0, needsAttention: false });

  const rootCalls = calls.filter(
    (c) => c.method === "select" || c.method === "selectDistinctOn",
  );
  assert.equal(rootCalls.length, 6);
});

// ---------------------------------------------------------------------
// attention summary
// ---------------------------------------------------------------------

test("listAccounts maps multiple attention aggregate rows to their correct accounts, one row per account regardless of open item count", async () => {
  const accountA = syntheticAccount({ id: "acc-a" });
  const accountB = syntheticAccount({ id: "acc-b" });
  const { db } = makeFakeDb([
    [{ value: 2 }],
    [accountA, accountB],
    [],
    [],
    [],
    [
      {
        accountId: "acc-a",
        openCount: "3", // count() arrives as a string from the pg driver
        oldestOpenAttentionAt: new Date("2026-01-01T00:00:00Z"),
        reasonCodes: ["stale_evaluation", "manual_review"],
      },
      {
        accountId: "acc-b",
        openCount: "1",
        oldestOpenAttentionAt: new Date("2026-02-01T00:00:00Z"),
        reasonCodes: ["enrichment_failed"],
      },
    ],
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  const itemA = result.items.find((i) => i.account.id === "acc-a");
  const itemB = result.items.find((i) => i.account.id === "acc-b");

  assert.equal(itemA?.attention?.openCount, 3);
  assert.equal(typeof itemA?.attention?.openCount, "number");
  assert.deepEqual(itemA?.attention?.oldestOpenAttentionAt, new Date("2026-01-01T00:00:00Z"));
  // Distinct + deterministically ascending, regardless of the order the
  // (already-distinct) driver array arrived in.
  assert.deepEqual(itemA?.attention?.reasonCodes, ["manual_review", "stale_evaluation"]);

  assert.equal(itemB?.attention?.openCount, 1);
  assert.deepEqual(itemB?.attention?.reasonCodes, ["enrichment_failed"]);
});

test("listAccounts returns attention: null for an account absent from the aggregate results", async () => {
  const accountA = syntheticAccount({ id: "acc-a" });
  const accountB = syntheticAccount({ id: "acc-b" });
  const { db } = makeFakeDb([
    [{ value: 2 }],
    [accountA, accountB],
    [],
    [],
    [],
    [
      {
        accountId: "acc-a",
        openCount: "1",
        oldestOpenAttentionAt: new Date("2026-01-01T00:00:00Z"),
        reasonCodes: ["manual_review"],
      },
      // acc-b has no open attention_items row at all — it must be null,
      // never { openCount: 0, ... }.
    ],
  ]);

  const result = await listAccounts({
    db,
    limit: 50,
    offset: 0,
    needsAttention: false,
  });

  const itemB = result.items.find((i) => i.account.id === "acc-b");
  assert.equal(itemB?.attention, null);
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
  const snapshot = syntheticSnapshotRow();
  const { db, calls } = makeFakeDb([[account], [newer, older], [snapshot]]);

  const result = await getAccountById(db, account.id);

  assert.equal(result?.account, account);
  assert.deepEqual(result?.evaluations, [
    expectedEvaluationDetail(newer, snapshot),
    expectedEvaluationDetail(older, snapshot),
  ]);
  const evaluationsOrderByCall = calls.find(
    (c, idx) =>
      c.method === "orderBy" &&
      calls.slice(0, idx).filter((prev) => prev.method === "from").length === 2,
  );
  assert.ok(evaluationsOrderByCall);
  assert.equal(evaluationsOrderByCall!.args.length, 2);
});
