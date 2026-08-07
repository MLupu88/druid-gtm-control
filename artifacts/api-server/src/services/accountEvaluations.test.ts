// Unit tests for the account-evaluations application service. No
// database needed — createAccountEvaluation is exercised via an injected
// fake evaluateAndPersistFn, and getAccountEvaluationById via a minimal
// fake drizzle query-chain object (both DI seams the service exposes for
// exactly this purpose).
//
// Run with: tsx --test src/services/accountEvaluations.test.ts

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  accountEvaluations,
  type AccountEvaluation,
} from "@workspace/db/schema";
import {
  createAccountEvaluation,
  getAccountEvaluationById,
  findLatestCompletedProductionEvaluation,
  applyProductionEvaluationLifecycleEffects,
  type EvaluateAndPersistFn,
  type ApplyEvaluationLifecycleEffectsFn,
} from "./accountEvaluations.js";

function syntheticEvaluation(
  overrides: Partial<AccountEvaluation> = {},
): AccountEvaluation {
  return {
    id: "eval-1",
    accountId: "acc-1",
    snapshotId: "snap-1",
    profileVersionId: "pv-1",
    profileConfigSnapshot: { configSchemaVersion: "v1" },
    evaluatorVersionId: "ev-1",
    evaluationMode: "preview",
    status: "completed",
    errorDetail: null,
    fitScore: "10",
    fitTier: "high",
    intentScore: "0",
    intentTier: "floor",
    identityResolutionLevel: "contact",
    identityConfidence: "high",
    actionabilityScore: "5",
    eligibilityOutcome: "eligible",
    eligibilityRestrictions: [],
    hardDisqualifiers: [],
    scoreComponents: [],
    matchedRules: [],
    missingInputs: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    ...overrides,
  };
}

// createAccountEvaluation now opens its own outer db.transaction() (GTM V2
// Stage 4, Unit 2) around both evaluateAndPersistFn and
// applyLifecycleEffectsFn, so it needs a `db` with a working transaction()
// method — invoking the callback with the fake db itself as `tx`, same
// spirit as ../services/accountFacts.test.ts's own makeFakeDb. For a
// PRODUCTION request, it also does one extra SELECT (resolve accountId
// from the snapshot) and, if found, a locking SELECT ... FOR UPDATE,
// BEFORE calling evaluateAndPersistFn — this fake's select()/for() chain
// exists to make that observable without a real Postgres connection.
// snapshotRows defaults to one row so production tests that don't care
// about the "snapshot missing" case get a working accountId for free.
interface FakeDbCall {
  method: string;
  args: unknown[];
}

function makeFakeDb(options: { snapshotRows?: unknown[] } = {}) {
  const snapshotRows = options.snapshotRows ?? [{ accountId: "acc-1" }];
  const calls: FakeDbCall[] = [];

  function chain() {
    const result = {
      from: (...args: unknown[]) => {
        calls.push({ method: "from", args });
        return result;
      },
      where: (...args: unknown[]) => {
        calls.push({ method: "where", args });
        return result;
      },
      limit: (...args: unknown[]) => {
        calls.push({ method: "limit", args });
        return Promise.resolve(snapshotRows);
      },
      for: (...args: unknown[]) => {
        calls.push({ method: "for", args });
        return Promise.resolve([{ id: "locked-account" }]);
      },
    };
    return result;
  }

  const db = {
    select: (...args: unknown[]) => {
      calls.push({ method: "select", args });
      return chain();
    },
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb(db),
  };

  return { db: db as never, calls };
}

// A no-op stand-in for applyLifecycleEffectsFn, for tests that only care
// about createAccountEvaluation's own pass-through/orchestration behavior
// — never applyProductionEvaluationLifecycleEffects' real branching logic
// (see its own dedicated test section below).
const noopApplyLifecycleEffectsFn: ApplyEvaluationLifecycleEffectsFn =
  async () => {};

// ---------------------------------------------------------------------
// createAccountEvaluation
// ---------------------------------------------------------------------

test("createAccountEvaluation calls the injected evaluateAndPersistFn exactly once, with the transaction handle (not the outer db) as its db", async () => {
  const returned = syntheticEvaluation();
  const { db } = makeFakeDb();
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(
    async () => returned,
  );

  const result = await createAccountEvaluation(
    {
      db,
      snapshotId: "snap-1",
      profileVersionId: "pv-1",
      evaluatorVersionId: "ev-1",
      evaluationMode: "production",
      createdBy: "operator@example.test",
    },
    evaluateAndPersistFn,
    noopApplyLifecycleEffectsFn,
  );

  assert.equal(evaluateAndPersistFn.mock.calls.length, 1);
  // The fake's transaction() invokes its callback with the db itself as
  // `tx` (see makeFakeDb above), so this also proves evaluateAndPersistFn
  // is called with whatever db.transaction() handed back.
  assert.deepEqual(evaluateAndPersistFn.mock.calls[0]?.arguments[0], {
    db,
    snapshotId: "snap-1",
    profileVersionId: "pv-1",
    evaluatorVersionId: "ev-1",
    evaluationMode: "production",
    createdBy: "operator@example.test",
  });
  assert.equal(result, returned);
});

test("createAccountEvaluation defaults createdBy to null when omitted", async () => {
  const { db } = makeFakeDb();
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation(),
  );

  await createAccountEvaluation(
    {
      db,
      snapshotId: "snap-1",
      profileVersionId: "pv-1",
      evaluatorVersionId: "ev-1",
      evaluationMode: "preview",
    },
    evaluateAndPersistFn,
    noopApplyLifecycleEffectsFn,
  );

  assert.equal(
    evaluateAndPersistFn.mock.calls[0]?.arguments[0].createdBy,
    null,
  );
});

test("createAccountEvaluation propagates whatever the injected evaluateAndPersistFn throws, without swallowing it, and never calls applyLifecycleEffectsFn", async () => {
  const { db } = makeFakeDb();
  const boom = new Error("simulated failure");
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    throw boom;
  });
  const applyLifecycleEffectsFn = mock.fn<ApplyEvaluationLifecycleEffectsFn>(
    async () => {},
  );

  await assert.rejects(
    createAccountEvaluation(
      {
        db,
        snapshotId: "snap-1",
        profileVersionId: "pv-1",
        evaluatorVersionId: "ev-1",
        evaluationMode: "preview",
      },
      evaluateAndPersistFn,
      applyLifecycleEffectsFn,
    ),
    boom,
  );
  assert.equal(
    applyLifecycleEffectsFn.mock.calls.length,
    0,
    "no row was persisted, so no lifecycle effect may run against it",
  );
});

// ---------------------------------------------------------------------
// GTM V2 Stage 4, Unit 2 — createAccountEvaluation's transaction wiring:
// applyLifecycleEffectsFn is called exactly once, with the SAME
// transaction handle evaluateAndPersistFn ran under, on the exact row
// evaluateAndPersistFn returned — proving persistence and the lifecycle
// step share one transaction, not merely that both eventually run.
// ---------------------------------------------------------------------

test("createAccountEvaluation calls applyLifecycleEffectsFn exactly once, after evaluateAndPersistFn, with the transaction handle and the persisted evaluation", async () => {
  const returned = syntheticEvaluation({
    id: "eval-99",
    evaluationMode: "production",
    status: "completed",
  });
  const { db } = makeFakeDb();
  const callOrder: string[] = [];
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    callOrder.push("evaluateAndPersistFn");
    return returned;
  });
  const applyLifecycleEffectsFn = mock.fn<ApplyEvaluationLifecycleEffectsFn>(
    async () => {
      callOrder.push("applyLifecycleEffectsFn");
    },
  );

  const result = await createAccountEvaluation(
    {
      db,
      snapshotId: "snap-1",
      profileVersionId: "pv-1",
      evaluatorVersionId: "ev-1",
      evaluationMode: "production",
    },
    evaluateAndPersistFn,
    applyLifecycleEffectsFn,
  );

  assert.deepEqual(callOrder, [
    "evaluateAndPersistFn",
    "applyLifecycleEffectsFn",
  ]);
  assert.equal(applyLifecycleEffectsFn.mock.calls.length, 1);
  assert.equal(applyLifecycleEffectsFn.mock.calls[0]?.arguments[0], db); // the tx handle db.transaction() handed back
  assert.equal(applyLifecycleEffectsFn.mock.calls[0]?.arguments[1], returned);
  assert.equal(result, returned);
});

test("createAccountEvaluation propagates whatever applyLifecycleEffectsFn throws (rolling back the whole transaction), without swallowing it", async () => {
  const returned = syntheticEvaluation({
    evaluationMode: "production",
    status: "completed",
  });
  const { db } = makeFakeDb();
  const boom = new Error("simulated lifecycle-effect failure");
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(
    async () => returned,
  );
  const applyLifecycleEffectsFn = mock.fn<ApplyEvaluationLifecycleEffectsFn>(
    async () => {
      throw boom;
    },
  );

  await assert.rejects(
    createAccountEvaluation(
      {
        db,
        snapshotId: "snap-1",
        profileVersionId: "pv-1",
        evaluatorVersionId: "ev-1",
        evaluationMode: "production",
      },
      evaluateAndPersistFn,
      applyLifecycleEffectsFn,
    ),
    boom,
  );
});

// ---------------------------------------------------------------------
// GTM V2 Stage 4, Unit 2 — the account-row lock: acquired for production
// requests only, strictly before evaluateAndPersistFn, and never at all
// for preview. See createAccountEvaluation's own doc comment for why the
// ordering (not just the lock's existence) matters — a fake db can only
// prove call SHAPE and ORDER here, never real PostgreSQL lock semantics;
// those are proven against a real instance in
// ../services/accountEvaluations.integration.test.ts.
// ---------------------------------------------------------------------

test("createAccountEvaluation (production): resolves accountId from the snapshot and acquires FOR UPDATE on accounts strictly before calling evaluateAndPersistFn", async () => {
  const { db, calls } = makeFakeDb({ snapshotRows: [{ accountId: "acc-42" }] });
  const callOrder: string[] = [];
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    callOrder.push("evaluateAndPersistFn");
    return syntheticEvaluation({ evaluationMode: "production" });
  });

  await createAccountEvaluation(
    {
      db,
      snapshotId: "snap-1",
      profileVersionId: "pv-1",
      evaluatorVersionId: "ev-1",
      evaluationMode: "production",
    },
    evaluateAndPersistFn,
    noopApplyLifecycleEffectsFn,
  );

  // Exactly two select() calls precede evaluateAndPersistFn: the
  // accountId-resolving snapshot lookup, then the locking SELECT ...
  // FOR UPDATE.
  const selectCount = calls.filter((c) => c.method === "select").length;
  assert.equal(selectCount, 2);
  const forCalls = calls.filter((c) => c.method === "for");
  assert.equal(forCalls.length, 1);
  assert.equal(forCalls[0]?.args[0], "update");
  // evaluateAndPersistFn only ran after both select() calls and the
  // for("update") lock — proven by it never having run before this
  // assertion point is reached, since callOrder is empty until it does.
  assert.deepEqual(callOrder, ["evaluateAndPersistFn"]);
});

test("createAccountEvaluation (preview): never resolves accountId or acquires any lock", async () => {
  const { db, calls } = makeFakeDb();
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation({ evaluationMode: "preview" }),
  );

  await createAccountEvaluation(
    {
      db,
      snapshotId: "snap-1",
      profileVersionId: "pv-1",
      evaluatorVersionId: "ev-1",
      evaluationMode: "preview",
    },
    evaluateAndPersistFn,
    noopApplyLifecycleEffectsFn,
  );

  assert.equal(
    calls.filter((c) => c.method === "select").length,
    0,
    "preview must never query accountSnapshots/accounts for locking purposes",
  );
  assert.equal(calls.filter((c) => c.method === "for").length, 0);
});

test("createAccountEvaluation (production): when the snapshot does not exist, skips the lock entirely and lets evaluateAndPersistFn raise its own error, without inventing a new error path", async () => {
  const { db, calls } = makeFakeDb({ snapshotRows: [] });
  const missingSnapshotError = new Error("simulated MissingRecordError");
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    throw missingSnapshotError;
  });

  await assert.rejects(
    createAccountEvaluation(
      {
        db,
        snapshotId: "does-not-exist",
        profileVersionId: "pv-1",
        evaluatorVersionId: "ev-1",
        evaluationMode: "production",
      },
      evaluateAndPersistFn,
      noopApplyLifecycleEffectsFn,
    ),
    missingSnapshotError,
  );

  assert.equal(
    calls.filter((c) => c.method === "for").length,
    0,
    "no account row to lock when the snapshot lookup found nothing",
  );
  assert.equal(evaluateAndPersistFn.mock.calls.length, 1);
});

// ---------------------------------------------------------------------
// getAccountEvaluationById
// ---------------------------------------------------------------------

function makeFakeSelectDb(rows: AccountEvaluation[]) {
  const limitMock = mock.fn(async () => rows);
  const whereMock = mock.fn((_condition: unknown) => ({ limit: limitMock }));
  const fromMock = mock.fn((_table: unknown) => ({ where: whereMock }));
  const selectMock = mock.fn(() => ({ from: fromMock }));
  const db = { select: selectMock } as never;
  return { db, selectMock, fromMock, whereMock, limitMock };
}

test("getAccountEvaluationById queries the canonical account_evaluations table and returns the row", async () => {
  const row = syntheticEvaluation({ id: "eval-42" });
  const { db, fromMock } = makeFakeSelectDb([row]);

  const result = await getAccountEvaluationById(db, "eval-42");

  assert.equal(result, row);
  // Confirms retrieval targets the exact canonical table object, not a
  // re-derived or parallel one.
  assert.equal(fromMock.mock.calls.length, 1);
  assert.equal(fromMock.mock.calls[0]?.arguments[0], accountEvaluations);
});

test("getAccountEvaluationById returns undefined when no row exists", async () => {
  const { db } = makeFakeSelectDb([]);

  const result = await getAccountEvaluationById(db, "does-not-exist");

  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------
// findLatestCompletedProductionEvaluation — GTM V2 Stage 4, Unit 1.
//
// A fake db can only prove query SHAPE (which table, that a filter and a
// two-key deterministic ORDER BY were applied, that exactly one row is
// requested) and straightforward passthrough of whatever row is queued —
// not real SQL filtering semantics. Whether preview/failed rows are
// actually excluded, and whether the newest completed/production row
// really does win among several, is proven against a real Postgres
// instance in ../services/accountFacts.integration.test.ts (the
// preview-only and failed-production-only fixtures) — this file has no
// database to exercise that against.
// ---------------------------------------------------------------------

function makeFakeOrderedSelectDb(rows: AccountEvaluation[]) {
  const limitMock = mock.fn(async (..._args: unknown[]) => rows);
  const orderByMock = mock.fn((..._args: unknown[]) => ({ limit: limitMock }));
  const whereMock = mock.fn((_condition: unknown) => ({ orderBy: orderByMock }));
  const fromMock = mock.fn((_table: unknown) => ({ where: whereMock }));
  const selectMock = mock.fn(() => ({ from: fromMock }));
  const db = { select: selectMock } as never;
  return { db, selectMock, fromMock, whereMock, orderByMock, limitMock };
}

test("findLatestCompletedProductionEvaluation returns undefined when no row is found", async () => {
  const { db } = makeFakeOrderedSelectDb([]);

  const result = await findLatestCompletedProductionEvaluation(db, "acc-1");

  assert.equal(result, undefined);
});

test("findLatestCompletedProductionEvaluation returns the single queued row", async () => {
  const row = syntheticEvaluation({
    id: "eval-latest",
    status: "completed",
    evaluationMode: "production",
  });
  const { db, fromMock, whereMock, orderByMock, limitMock } =
    makeFakeOrderedSelectDb([row]);

  const result = await findLatestCompletedProductionEvaluation(db, "acc-1");

  assert.equal(result, row);
  // Targets the exact canonical table, applies a real (non-undefined)
  // filter, a deterministic two-key ORDER BY (createdAt desc, id desc —
  // the same tie-break already used throughout ../services/accounts.ts),
  // and requests exactly one row.
  assert.equal(fromMock.mock.calls[0]?.arguments[0], accountEvaluations);
  assert.notEqual(whereMock.mock.calls[0]?.arguments[0], undefined);
  assert.equal(orderByMock.mock.calls[0]?.arguments.length, 2);
  assert.equal(limitMock.mock.calls.length, 1);
  assert.equal(limitMock.mock.calls[0]?.arguments[0], 1);
});

// ---------------------------------------------------------------------
// applyProductionEvaluationLifecycleEffects — GTM V2 Stage 4, Unit 2.
//
// A queue-based fake db, same shape/spirit as
// ../services/accountFacts.test.ts's own makeFakeDb (extended here with
// update()/set(), since resolveAttentionItem — unlike anything Unit 1
// needed — issues an UPDATE). Each queue entry is the array of rows the
// NEXT query call resolves to, consumed strictly in call order; this can
// only prove query SHAPE and branch selection (which reasonCode was
// created/resolved, in what order, whether the accountFactCurrent
// comparison ran at all), never real SQL filtering semantics or real
// PostgreSQL lock behavior. Those are proven against a real Postgres
// instance in ../services/accountEvaluations.integration.test.ts.
// ---------------------------------------------------------------------

interface LifecycleRecordedCall {
  method: string;
  args: unknown[];
}

interface LifecycleFakeQueryChain {
  from(...args: unknown[]): LifecycleFakeQueryChain;
  where(...args: unknown[]): LifecycleFakeQueryChain;
  limit(...args: unknown[]): LifecycleFakeQueryChain;
  values(...args: unknown[]): LifecycleFakeQueryChain;
  set(...args: unknown[]): LifecycleFakeQueryChain;
  returning(...args: unknown[]): LifecycleFakeQueryChain;
  then(
    resolve: (value: unknown) => void,
    reject?: (error: unknown) => void,
  ): void;
}

interface LifecycleFakeDbSurface {
  select(...args: unknown[]): LifecycleFakeQueryChain;
  insert(...args: unknown[]): LifecycleFakeQueryChain;
  update(...args: unknown[]): LifecycleFakeQueryChain;
  transaction<T>(cb: (tx: LifecycleFakeDbSurface) => Promise<T>): Promise<T>;
}

function makeLifecycleFakeDb(queue: unknown[][]) {
  let i = 0;
  const calls: LifecycleRecordedCall[] = [];

  function record(
    method: string,
    args: unknown[],
    chainResult: LifecycleFakeQueryChain,
  ): LifecycleFakeQueryChain {
    calls.push({ method, args });
    return chainResult;
  }

  function chain(): LifecycleFakeQueryChain {
    const result: LifecycleFakeQueryChain = {
      from: (...args) => record("from", args, result),
      where: (...args) => record("where", args, result),
      limit: (...args) => record("limit", args, result),
      values: (...args) => record("values", args, result),
      set: (...args) => record("set", args, result),
      returning: (...args) => record("returning", args, result),
      then: (resolve, reject) => {
        if (i >= queue.length) {
          reject?.(
            new Error(
              `makeLifecycleFakeDb: query ${i + 1} ran but only ${queue.length} queue entries were supplied.`,
            ),
          );
          return;
        }
        Promise.resolve(queue[i++]).then(resolve, reject);
      },
    };
    return result;
  }

  const fakeDb: LifecycleFakeDbSurface = {
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

  return { db: fakeDb as unknown as Parameters<typeof applyProductionEvaluationLifecycleEffects>[0], calls };
}

const ACCOUNT_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function syntheticAttentionItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "attn-1",
    accountId: ACCOUNT_ID,
    reasonCode: "evaluation_failed",
    reasonDetail: "fixed detail",
    source: "evaluation",
    sourceRef: null,
    context: {},
    status: "open",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: "system:evaluation",
    resolvedAt: null,
    resolvedBy: null,
    resolutionReason: null,
    ...overrides,
  };
}

function resolvedCopy(item: Record<string, unknown>): Record<string, unknown> {
  return {
    ...item,
    status: "resolved",
    resolvedAt: new Date("2026-01-02T00:00:00Z"),
    resolvedBy: "system:evaluation",
    resolutionReason: "resolved in test",
  };
}

// ---------------------------------------------------------------------
// Causal evidence-comparison fixtures — GTM V2 Stage 4, Unit 2.
// ---------------------------------------------------------------------

const FACT_ID_INDUSTRY_A = "bbbbbbbb-0000-4000-8000-00000000000a";
const FACT_ID_INDUSTRY_B = "bbbbbbbb-0000-4000-8000-00000000000b";

/** A schema-valid account_snapshots.rawInput evidence envelope, with one entry per supplied (field, accountFactId) pair. */
function syntheticEvidenceRawInput(
  evidence: Array<{ field: string; accountFactId: string }> = [],
): Record<string, unknown> {
  return {
    schemaVersion: "account-facts-snapshot-v1",
    account: { id: ACCOUNT_ID },
    identity: [],
    evidence: evidence.map((e) => ({
      field: e.field,
      value: "Banking",
      accountFactId: e.accountFactId,
      source: "manual-operator-v1",
      recordedBy: "operator@example.test",
      observedAt: "2026-01-01T00:00:00.000Z",
      recordedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
}

/** A fully schema-valid, empty-rules profile config — no ACCOUNT_FACT_FIELDS field is relevant to it, so the causal comparison short-circuits to true without querying anything. */
function profileConfigWithNoRelevantFields(): Record<string, unknown> {
  return {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

/** A fully schema-valid profile config whose fit dimension references exactly company.industry — the only ACCOUNT_FACT_FIELDS entry relevant to it. */
function profileConfigReferencingIndustry(): Record<string, unknown> {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "fit_industry_banking",
          description: "Industry is Banking",
          points: 10,
          condition: { op: "eq", field: "company.industry", value: "Banking" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

test("applyProductionEvaluationLifecycleEffects: a preview evaluation is a complete no-op, regardless of status", async () => {
  const { db, calls } = makeLifecycleFakeDb([]);
  const preview = syntheticEvaluation({
    accountId: ACCOUNT_ID,
    evaluationMode: "preview",
    status: "failed",
    errorDetail: "boom",
  });

  await applyProductionEvaluationLifecycleEffects(db, preview);

  assert.equal(calls.length, 0, "no query of any kind may run for a preview evaluation");
});

test("applyProductionEvaluationLifecycleEffects: a failed production evaluation creates one open evaluation_failed item and touches nothing else", async () => {
  const { db, calls } = makeLifecycleFakeDb([
    [{ id: ACCOUNT_ID }], // createAttentionItem's own account-existence check
    [syntheticAttentionItem()], // attention_items insert .returning()
  ]);
  const failed = syntheticEvaluation({
    accountId: ACCOUNT_ID,
    evaluationMode: "production",
    status: "failed",
    errorDetail: "schema validation failed",
  });

  await applyProductionEvaluationLifecycleEffects(db, failed);

  assert.equal(calls.filter((c) => c.method === "select").length, 1);
  assert.equal(calls.filter((c) => c.method === "insert").length, 1);
  assert.equal(calls.filter((c) => c.method === "update").length, 0);
  const valuesCall = calls.find((c) => c.method === "values");
  assert.deepEqual(valuesCall?.args[0], {
    accountId: ACCOUNT_ID,
    reasonCode: "evaluation_failed",
    reasonDetail:
      "A production evaluation for this account failed; see the account's evaluation history for the failure detail.",
    source: "evaluation",
    sourceRef: null,
    context: {},
    createdBy: "system:evaluation",
  });
});

test("applyProductionEvaluationLifecycleEffects: a completed production evaluation with no open conditions and matching (absent) evidence issues only reads, no writes", async () => {
  const { db, calls } = makeLifecycleFakeDb([
    [], // evaluation_failed: findOpenAttentionItems -> none open
    [{ rawInput: syntheticEvidenceRawInput([]) }], // snapshot rawInput: no evidence recorded
    [], // account_fact_current: no current fact for company.industry either -> match (both absent)
    [], // evaluation_stale: findOpenAttentionItems -> none open
    [], // evaluation_missing_inputs: findOpenAttentionItems -> none open
  ]);
  const completed = syntheticEvaluation({
    accountId: ACCOUNT_ID,
    evaluationMode: "production",
    status: "completed",
    profileConfigSnapshot: profileConfigReferencingIndustry(),
    missingInputs: [],
  });

  await applyProductionEvaluationLifecycleEffects(db, completed);

  assert.equal(calls.filter((c) => c.method === "select").length, 5);
  assert.equal(calls.filter((c) => c.method === "insert").length, 0);
  assert.equal(calls.filter((c) => c.method === "update").length, 0);
});

test("applyProductionEvaluationLifecycleEffects: a completed production evaluation resolves an open evaluation_failed item and an open evaluation_stale item whose relevant accountFactId matches current evidence exactly", async () => {
  const openFailed = syntheticAttentionItem({ id: "attn-failed", reasonCode: "evaluation_failed" });
  const openStale = syntheticAttentionItem({ id: "attn-stale", reasonCode: "evaluation_stale" });
  const { db, calls } = makeLifecycleFakeDb([
    [openFailed], // evaluation_failed: findOpenAttentionItems
    [resolvedCopy(openFailed)], // resolveAttentionItem UPDATE .returning()
    [{ rawInput: syntheticEvidenceRawInput([{ field: "company.industry", accountFactId: FACT_ID_INDUSTRY_A }]) }], // snapshot rawInput
    [{ field: "company.industry", factId: FACT_ID_INDUSTRY_A }], // account_fact_current: SAME accountFactId -> match
    [openStale], // evaluation_stale: findOpenAttentionItems
    [resolvedCopy(openStale)], // resolveAttentionItem UPDATE .returning()
    [], // evaluation_missing_inputs: findOpenAttentionItems -> none open
  ]);
  const completed = syntheticEvaluation({
    id: "eval-resolver",
    accountId: ACCOUNT_ID,
    evaluationMode: "production",
    status: "completed",
    profileConfigSnapshot: profileConfigReferencingIndustry(),
    missingInputs: [],
  });

  await applyProductionEvaluationLifecycleEffects(db, completed);

  assert.equal(calls.filter((c) => c.method === "update").length, 2);
  const setCalls = calls.filter((c) => c.method === "set");
  assert.equal(setCalls.length, 2);
  for (const setCall of setCalls) {
    const setArgs = setCall.args[0] as Record<string, unknown>;
    assert.equal(setArgs.status, "resolved");
    assert.equal(setArgs.resolvedBy, "system:evaluation");
    assert.equal(
      setArgs.resolutionReason,
      "Resolved by production evaluation eval-resolver, which completed successfully.",
    );
  }
});

test("applyProductionEvaluationLifecycleEffects: a completed production evaluation does NOT resolve evaluation_stale when the current accountFactId for a relevant field differs from what the snapshot captured", async () => {
  const { db, calls } = makeLifecycleFakeDb([
    [], // evaluation_failed: findOpenAttentionItems -> none open
    [{ rawInput: syntheticEvidenceRawInput([{ field: "company.industry", accountFactId: FACT_ID_INDUSTRY_A }]) }], // snapshot rawInput
    [{ field: "company.industry", factId: FACT_ID_INDUSTRY_B }], // account_fact_current: DIFFERENT accountFactId -> mismatch
    [], // evaluation_missing_inputs: findOpenAttentionItems -> none open
  ]);
  const completed = syntheticEvaluation({
    accountId: ACCOUNT_ID,
    evaluationMode: "production",
    status: "completed",
    profileConfigSnapshot: profileConfigReferencingIndustry(),
    missingInputs: [],
  });

  await applyProductionEvaluationLifecycleEffects(db, completed);

  assert.equal(
    calls.filter((c) => c.method === "update").length,
    0,
    "a mismatched relevant accountFactId must leave evaluation_stale untouched — no evaluation_stale find/resolve may even run",
  );
});

test("applyProductionEvaluationLifecycleEffects: malformed snapshot evidence fails closed — never resolves evaluation_stale, without ever querying account_fact_current", async () => {
  const { db, calls } = makeLifecycleFakeDb([
    [], // evaluation_failed: findOpenAttentionItems -> none open
    [{ rawInput: { foo: "bar" } }], // snapshot rawInput: fails AccountFactsSnapshotEvidenceV1Schema
    [], // evaluation_missing_inputs: findOpenAttentionItems -> none open
  ]);
  const completed = syntheticEvaluation({
    accountId: ACCOUNT_ID,
    evaluationMode: "production",
    status: "completed",
    profileConfigSnapshot: profileConfigReferencingIndustry(),
    missingInputs: [],
  });

  await applyProductionEvaluationLifecycleEffects(db, completed);

  // Only 3 selects total (failed-find, the one rawInput read, missing-
  // inputs-find) — proves the account_fact_current comparison never even
  // ran once the evidence envelope failed to parse.
  assert.equal(calls.filter((c) => c.method === "select").length, 3);
  assert.equal(calls.filter((c) => c.method === "update").length, 0);
});

test("applyProductionEvaluationLifecycleEffects: no ACCOUNT_FACT_FIELDS field relevant to the profile config resolves evaluation_stale without querying any evidence at all", async () => {
  const openStale = syntheticAttentionItem({ id: "attn-stale", reasonCode: "evaluation_stale" });
  const { db, calls } = makeLifecycleFakeDb([
    [], // evaluation_failed: findOpenAttentionItems -> none open
    [openStale], // evaluation_stale: findOpenAttentionItems (causal check was vacuous -> true, no query for it)
    [resolvedCopy(openStale)], // resolveAttentionItem UPDATE .returning()
    [], // evaluation_missing_inputs: findOpenAttentionItems -> none open
  ]);
  const completed = syntheticEvaluation({
    accountId: ACCOUNT_ID,
    evaluationMode: "production",
    status: "completed",
    profileConfigSnapshot: profileConfigWithNoRelevantFields(),
    missingInputs: [],
  });

  await applyProductionEvaluationLifecycleEffects(db, completed);

  assert.equal(
    calls.filter((c) => c.method === "select").length,
    3,
    "vacuous relevance must short-circuit to true without reading rawInput or account_fact_current",
  );
  assert.equal(calls.filter((c) => c.method === "update").length, 1);
});

test("applyProductionEvaluationLifecycleEffects: a completed production evaluation with non-empty missingInputs creates one open evaluation_missing_inputs item instead of resolving it", async () => {
  const { db, calls } = makeLifecycleFakeDb([
    [], // evaluation_failed: findOpenAttentionItems -> none open
    [], // evaluation_stale: findOpenAttentionItems (vacuous relevance -> true, no evidence query)
    [{ id: ACCOUNT_ID }], // createAttentionItem's own account-existence check
    [syntheticAttentionItem({ reasonCode: "evaluation_missing_inputs" })], // attention_items insert .returning()
  ]);
  const completed = syntheticEvaluation({
    accountId: ACCOUNT_ID,
    evaluationMode: "production",
    status: "completed",
    profileConfigSnapshot: profileConfigWithNoRelevantFields(),
    missingInputs: [{ field: "company.industry", affects: ["fit"] }],
  });

  await applyProductionEvaluationLifecycleEffects(db, completed);

  assert.equal(calls.filter((c) => c.method === "insert").length, 1);
  assert.equal(calls.filter((c) => c.method === "update").length, 0);
  const valuesCall = calls.find((c) => c.method === "values");
  assert.deepEqual(valuesCall?.args[0], {
    accountId: ACCOUNT_ID,
    reasonCode: "evaluation_missing_inputs",
    reasonDetail:
      "The account's latest completed production evaluation is missing required inputs; see that evaluation's missingInputs for detail.",
    source: "evaluation",
    sourceRef: null,
    context: {},
    createdBy: "system:evaluation",
  });
});
