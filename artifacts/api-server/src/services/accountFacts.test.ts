// Unit tests for the manual-account-facts application service. No
// database needed — every db interaction is a fake queue-based
// query-chain object (see makeFakeDb), same spirit as
// ../services/accountDecisions.test.ts's makeFakeDb, extended here with
// transaction()/onConflictDoUpdate() since this service is the first to
// use a real multi-statement db.transaction().
//
// Run with: tsx --test src/services/accountFacts.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  recordAccountFact,
  listAccountFacts,
  isAccountFactFieldReferencedInProfileConfig,
  CorrectionReasonRequiredError,
  CorrectionReasonNotAllowedError,
  InvalidAccountFactValueError,
  StaleFactCorrectionError,
} from "./accountFacts.js";
import { AccountNotFoundError } from "./icpEvaluationResolvers.js";

type Db = NodePgDatabase<typeof schema>;

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const FACT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function syntheticFact(overrides: Record<string, unknown> = {}) {
  return {
    id: FACT_ID,
    accountId: ACCOUNT_ID,
    field: "company.industry",
    value: "Banking",
    source: "manual-operator-v1",
    recordedBy: "operator@example.com",
    observedAt: new Date("2026-01-01T00:00:00Z"),
    recordedAt: new Date("2026-01-01T00:00:00Z"),
    correctionReason: null,
    supersedesFactId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Fake db: a queue of canned responses, one per root select()/insert()
// call, consumed in call order — same shape as
// ../services/accountDecisions.test.ts's makeFakeDb, extended with
// transaction() (invokes the callback with the fake db itself as `tx` —
// no real isolation is needed to test recordAccountFact's own
// branching/error-mapping logic) and onConflictDoUpdate(). A queued entry
// may be a thrown-error thunk (`() => { throw ... }`) to simulate a
// database constraint violation surfacing from an insert.
// ---------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface FakeQueryChain {
  from(...args: unknown[]): FakeQueryChain;
  innerJoin(...args: unknown[]): FakeQueryChain;
  where(...args: unknown[]): FakeQueryChain;
  orderBy(...args: unknown[]): FakeQueryChain;
  limit(...args: unknown[]): FakeQueryChain;
  // GTM V2 Stage 4, Unit 2: recordAccountFact's account-existence check is
  // now SELECT ... FOR UPDATE, run inside the transaction.
  for(...args: unknown[]): FakeQueryChain;
  values(...args: unknown[]): FakeQueryChain;
  onConflictDoNothing(...args: unknown[]): FakeQueryChain;
  onConflictDoUpdate(...args: unknown[]): FakeQueryChain;
  returning(...args: unknown[]): FakeQueryChain;
  then(
    resolve: (value: unknown) => void,
    reject?: (error: unknown) => void,
  ): void;
}

interface FakeDbSurface {
  select(...args: unknown[]): FakeQueryChain;
  insert(...args: unknown[]): FakeQueryChain;
  transaction<T>(cb: (tx: FakeDbSurface) => Promise<T>): Promise<T>;
}

function makeFakeDb(queue: unknown[]): { db: Db; calls: RecordedCall[] } {
  let i = 0;
  const calls: RecordedCall[] = [];

  function record(
    method: string,
    args: unknown[],
    chainResult: FakeQueryChain,
  ): FakeQueryChain {
    calls.push({ method, args });
    return chainResult;
  }

  function chain(): FakeQueryChain {
    const result: FakeQueryChain = {
      from: (...args) => record("from", args, result),
      innerJoin: (...args) => record("innerJoin", args, result),
      where: (...args) => record("where", args, result),
      orderBy: (...args) => record("orderBy", args, result),
      limit: (...args) => record("limit", args, result),
      for: (...args) => record("for", args, result),
      values: (...args) => record("values", args, result),
      onConflictDoNothing: (...args) =>
        record("onConflictDoNothing", args, result),
      onConflictDoUpdate: (...args) =>
        record("onConflictDoUpdate", args, result),
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
    transaction: async (cb) => cb(fakeDb),
  };

  return { db: fakeDb as unknown as Db, calls };
}

function pgUniqueViolation(constraint: string): Error & {
  code: string;
  constraint: string;
} {
  const err = new Error(
    `duplicate key value violates unique constraint "${constraint}"`,
  ) as Error & { code: string; constraint: string };
  err.code = "23505";
  err.constraint = constraint;
  return err;
}

// Mimics drizzle-orm's real wrapping: a DrizzleQueryError with no
// code/constraint of its own, whose `.cause` is the raw pg
// DatabaseError-shaped object that actually carries them. This is the
// exact shape a real db.transaction() call throws for a constraint
// violation — see accountFacts.integration.test.ts, which first
// surfaced this via a real Postgres connection.
function wrappedPgUniqueViolation(constraint: string): Error {
  const wrapper = new Error(
    `Failed query: insert into "account_facts" ...`,
  ) as Error & { cause?: unknown };
  wrapper.name = "DrizzleQueryError";
  wrapper.cause = pgUniqueViolation(constraint);
  return wrapper;
}

// ---------------------------------------------------------------------
// Application-layer correction-reason iff-and-only-if validation — the
// mirror of account_facts' DB CHECK, checked before any query runs.
// ---------------------------------------------------------------------

test("rejects a correction reason supplied on an initial (non-correcting) assertion", async () => {
  const { db } = makeFakeDb([]);
  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: "not allowed here",
      }),
    CorrectionReasonNotAllowedError,
  );
});

test("rejects a missing/blank correction reason when correcting an existing value", async () => {
  const { db } = makeFakeDb([]);
  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: FACT_ID,
        correctionReason: "   ",
      }),
    CorrectionReasonRequiredError,
  );
});

test("rejects an out-of-vocabulary company.region value", async () => {
  const { db } = makeFakeDb([]);
  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.region",
        value: "apac",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    InvalidAccountFactValueError,
  );
});

test("rejects a blank value for a free-text field", async () => {
  const { db } = makeFakeDb([]);
  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "   ",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    InvalidAccountFactValueError,
  );
});

// ---------------------------------------------------------------------
// Account existence.
// ---------------------------------------------------------------------

test("throws AccountNotFoundError when the account does not exist", async () => {
  const { db } = makeFakeDb([[]]); // account lookup returns no rows
  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    AccountNotFoundError,
  );
});

// ---------------------------------------------------------------------
// Happy paths.
// ---------------------------------------------------------------------

test("first-time confirmation: inserts the fact and claims the pointer via onConflictDoNothing", async () => {
  const fact = syntheticFact();
  const { db, calls } = makeFakeDb([
    [{ id: ACCOUNT_ID }], // account lookup
    [fact], // account_facts insert .returning()
    [{ accountId: ACCOUNT_ID, field: "company.industry", factId: FACT_ID }], // pointer insert .returning()
    [], // GTM V2 Stage 4, Unit 1: findLatestCompletedProductionEvaluation -> none found, staleness check short-circuits
  ]);

  const result = await recordAccountFact({
    db,
    accountId: ACCOUNT_ID,
    field: "company.industry",
    value: "Banking",
    recordedBy: "operator@example.com",
    expectedCurrentFactId: null,
    correctionReason: null,
  });

  assert.equal(result.id, FACT_ID);
  assert.ok(calls.some((c) => c.method === "onConflictDoNothing"));
  assert.ok(!calls.some((c) => c.method === "onConflictDoUpdate"));
});

test("correction: inserts the fact and moves the pointer via onConflictDoUpdate", async () => {
  const priorFactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const fact = syntheticFact({ supersedesFactId: priorFactId, correctionReason: "typo fix" });
  const { db, calls } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    [fact],
    [{ accountId: ACCOUNT_ID, field: "company.industry", factId: FACT_ID }],
    [], // GTM V2 Stage 4, Unit 1: findLatestCompletedProductionEvaluation -> none found, staleness check short-circuits
  ]);

  const result = await recordAccountFact({
    db,
    accountId: ACCOUNT_ID,
    field: "company.industry",
    value: "Banking",
    recordedBy: "operator@example.com",
    expectedCurrentFactId: priorFactId,
    correctionReason: "typo fix",
  });

  assert.equal(result.id, FACT_ID);
  assert.ok(calls.some((c) => c.method === "onConflictDoUpdate"));
  assert.ok(!calls.some((c) => c.method === "onConflictDoNothing"));
});

// ---------------------------------------------------------------------
// Concurrency conflict mapping — StaleFactCorrectionError, HTTP 409 at
// the route layer.
// ---------------------------------------------------------------------

test("maps a 0-row pointer conflict (first-time confirmation raced) to StaleFactCorrectionError", async () => {
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    [syntheticFact()],
    [], // onConflictDoNothing returned nothing -> someone else confirmed first
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    StaleFactCorrectionError,
  );
});

test("maps a 0-row pointer conflict (correction's expected pointer already moved) to StaleFactCorrectionError", async () => {
  const priorFactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    [syntheticFact({ supersedesFactId: priorFactId, correctionReason: "fix" })],
    [], // onConflictDoUpdate's setWhere didn't match -> 0 rows
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: priorFactId,
        correctionReason: "fix",
      }),
    StaleFactCorrectionError,
  );
});

test("maps the known supersedes_fact_id unique-violation (competing correction) to StaleFactCorrectionError", async () => {
  const priorFactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    () => {
      throw pgUniqueViolation("account_facts_supersedes_fact_id_uq");
    },
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: priorFactId,
        correctionReason: "fix",
      }),
    StaleFactCorrectionError,
  );
});

test("maps the known one-root-per-account-field unique-violation (competing first confirmation) to StaleFactCorrectionError", async () => {
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    () => {
      throw pgUniqueViolation("account_facts_one_root_per_account_field");
    },
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    StaleFactCorrectionError,
  );
});

test("does NOT convert an unrelated unique violation into StaleFactCorrectionError", async () => {
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    () => {
      throw pgUniqueViolation("some_unrelated_constraint");
    },
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    (err: unknown) => {
      assert.ok(!(err instanceof StaleFactCorrectionError));
      assert.equal((err as { code?: string }).code, "23505");
      return true;
    },
  );
});

test("does NOT convert an unrelated (non-database) error into StaleFactCorrectionError", async () => {
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    () => {
      throw new Error("connection reset");
    },
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    (err: unknown) => {
      assert.ok(!(err instanceof StaleFactCorrectionError));
      assert.equal((err as Error).message, "connection reset");
      return true;
    },
  );
});

// ---------------------------------------------------------------------
// Cause-chain unwrapping — drizzle-orm wraps the raw pg error inside a
// DrizzleQueryError, exposing code/constraint only via `.cause`. See
// findPgConstraintErrorInfo in ./accountFacts.ts.
// ---------------------------------------------------------------------

test("maps a known constraint violation nested under .cause (DrizzleQueryError-style wrapping) to StaleFactCorrectionError", async () => {
  const priorFactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    () => {
      throw wrappedPgUniqueViolation("account_facts_supersedes_fact_id_uq");
    },
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: priorFactId,
        correctionReason: "fix",
      }),
    StaleFactCorrectionError,
  );
});

test("does NOT convert an unrelated constraint nested under .cause into StaleFactCorrectionError", async () => {
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    () => {
      throw wrappedPgUniqueViolation("some_unrelated_constraint");
    },
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    (err: unknown) => {
      assert.ok(!(err instanceof StaleFactCorrectionError));
      assert.equal(err instanceof Error && err.name, "DrizzleQueryError");
      return true;
    },
  );
});

test("a self-referential (cyclic) cause chain does not crash or hang, and is never misclassified as StaleFactCorrectionError", async () => {
  const cyclic = new Error("cyclic") as Error & { cause?: unknown };
  cyclic.cause = cyclic; // points to itself
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    () => {
      throw cyclic;
    },
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    (err: unknown) => {
      assert.ok(!(err instanceof StaleFactCorrectionError));
      assert.equal(err, cyclic);
      return true;
    },
  );
});

test("a deeply nested cause chain with no constraint-violation shape anywhere does not crash, and is never misclassified", async () => {
  let outer: Error & { cause?: unknown } = new Error("root cause");
  // Deeper than MAX_ERROR_CAUSE_DEPTH (5) — proves the depth limit is
  // enforced, not just theoretically present.
  for (let i = 0; i < 10; i += 1) {
    const next = new Error(`wrapper ${i}`) as Error & { cause?: unknown };
    next.cause = outer;
    outer = next;
  }
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    () => {
      throw outer;
    },
  ]);

  await assert.rejects(
    () =>
      recordAccountFact({
        db,
        accountId: ACCOUNT_ID,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.com",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    (err: unknown) => {
      assert.ok(!(err instanceof StaleFactCorrectionError));
      assert.equal(err, outer);
      return true;
    },
  );
});

// ---------------------------------------------------------------------
// GTM V2 Stage 4, Unit 1 — evaluation staleness signal.
//
// Real-database race/dedup behavior (two concurrent triggers colliding on
// the attention_items partial unique index) is exercised only in
// accountFacts.integration.test.ts — a fake queue-based db has no real
// unique index to race against. This section covers the WIRING (which
// queries run, in what order, and under what conditions) plus the pure
// relevance rule directly.
// ---------------------------------------------------------------------

const EVALUATION_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function syntheticProductionEvaluation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: EVALUATION_ID,
    accountId: ACCOUNT_ID,
    snapshotId: "33333333-3333-4333-8333-333333333333",
    profileVersionId: "44444444-4444-4444-8444-444444444444",
    evaluatorVersionId: "55555555-5555-4555-8555-555555555555",
    evaluationMode: "production",
    status: "completed",
    profileConfigSnapshot: {
      configSchemaVersion: "v1",
      fit: {
        rules: [
          {
            id: "fit_industry",
            description: "Industry match",
            points: 10,
            condition: { op: "eq", field: "company.industry", value: "Banking" },
          },
        ],
        tiers: [{ code: "base", minScore: 0 }],
      },
      intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
      actionability: { rules: [] },
      eligibility: { hardDisqualifiers: [], restrictions: [] },
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    ...overrides,
  };
}

function syntheticAttentionItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "attn-1",
    accountId: ACCOUNT_ID,
    reasonCode: "evaluation_stale",
    reasonDetail: "detail",
    source: "evaluation",
    sourceRef: EVALUATION_ID,
    context: { trigger: "account_fact_changed", evaluationId: EVALUATION_ID },
    status: "open",
    createdAt: new Date("2026-01-02T00:00:00Z"),
    createdBy: "system:evaluation",
    resolvedAt: null,
    resolvedBy: null,
    resolutionReason: null,
    ...overrides,
  };
}

test("recordAccountFact: no completed production evaluation -> no attention item is raised", async () => {
  const fact = syntheticFact();
  const { db, calls } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    [fact],
    [{ accountId: ACCOUNT_ID, field: "company.industry", factId: FACT_ID }],
    [], // findLatestCompletedProductionEvaluation -> none (covers preview-only and failed-only accounts too, which that helper's own unit tests in accountEvaluations.test.ts exercise directly)
  ]);

  await recordAccountFact({
    db,
    accountId: ACCOUNT_ID,
    field: "company.industry",
    value: "Banking",
    recordedBy: "operator@example.com",
    expectedCurrentFactId: null,
    correctionReason: null,
  });

  // Only the fact insert + pointer insert ran — no attention_items insert.
  assert.equal(calls.filter((c) => c.method === "insert").length, 2);
});

test("recordAccountFact: a referenced fit field raises an evaluation_stale attention item, committed via the same transaction", async () => {
  const fact = syntheticFact();
  const evaluation = syntheticProductionEvaluation();
  const { db, calls } = makeFakeDb([
    [{ id: ACCOUNT_ID }], // recordAccountFact's own account lookup
    [fact], // account_facts insert
    [{ accountId: ACCOUNT_ID, field: "company.industry", factId: FACT_ID }], // pointer insert
    [evaluation], // findLatestCompletedProductionEvaluation
    [{ id: ACCOUNT_ID }], // createAttentionItem's own account-existence check
    [syntheticAttentionItem()], // attention_items insert .returning()
  ]);

  const result = await recordAccountFact({
    db,
    accountId: ACCOUNT_ID,
    field: "company.industry",
    value: "Banking",
    recordedBy: "operator@example.com",
    expectedCurrentFactId: null,
    correctionReason: null,
  });

  assert.equal(result.id, FACT_ID);
  // account_facts insert + accountFactCurrent insert + attention_items insert.
  assert.equal(calls.filter((c) => c.method === "insert").length, 3);
  assert.equal(calls.filter((c) => c.method === "select").length, 3);
});

test("recordAccountFact: an unreferenced field never raises an attention item, even with a completed production evaluation present", async () => {
  const fact = syntheticFact({ field: "company.country", value: "Germany" });
  // This evaluation's fit config only references company.industry.
  const evaluation = syntheticProductionEvaluation();
  const { db, calls } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    [fact],
    [{ accountId: ACCOUNT_ID, field: "company.country", factId: FACT_ID }],
    [evaluation], // findLatestCompletedProductionEvaluation
    // no further slots consumed — company.country is not referenced, so
    // createAttentionItem must never be called.
  ]);

  await recordAccountFact({
    db,
    accountId: ACCOUNT_ID,
    field: "company.country",
    value: "Germany",
    recordedBy: "operator@example.com",
    expectedCurrentFactId: null,
    correctionReason: null,
  });

  assert.equal(calls.filter((c) => c.method === "insert").length, 2);
});

test("recordAccountFact: a correction to the SAME value as the fact it supersedes still raises an attention item — no same-value suppression exists", async () => {
  // GTM V2 Stage 4, Unit 1 deliberately does not compare the new value
  // against the value being superseded: fact identity/provenance is
  // meaningful elsewhere in this codebase (see
  // ../services/accountFactsSnapshotEvidence.ts's accountFactId-keyed
  // evidence), so a same-value correction is not provably a no-op for
  // evaluation purposes. Every accepted write to a referenced field is a
  // trigger, full stop — this test locks that in.
  const priorFactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const fact = syntheticFact({ supersedesFactId: priorFactId, correctionReason: "reaffirm" });
  const evaluation = syntheticProductionEvaluation();
  const { db, calls } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    [fact],
    [{ accountId: ACCOUNT_ID, field: "company.industry", factId: FACT_ID }],
    [evaluation], // findLatestCompletedProductionEvaluation
    [{ id: ACCOUNT_ID }], // createAttentionItem's own account-existence check
    [syntheticAttentionItem()], // attention_items insert .returning()
  ]);

  await recordAccountFact({
    db,
    accountId: ACCOUNT_ID,
    field: "company.industry",
    value: "Banking", // same value the superseded fact already held
    recordedBy: "operator@example.com",
    expectedCurrentFactId: priorFactId,
    correctionReason: "reaffirm",
  });

  assert.equal(calls.filter((c) => c.method === "insert").length, 3);
});

test("recordAccountFact: a correction to a different value on a referenced field raises an attention item", async () => {
  const priorFactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const fact = syntheticFact({ supersedesFactId: priorFactId, correctionReason: "corrected" });
  const evaluation = syntheticProductionEvaluation();
  const { db, calls } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    [fact],
    [{ accountId: ACCOUNT_ID, field: "company.industry", factId: FACT_ID }],
    [evaluation],
    [{ id: ACCOUNT_ID }],
    [syntheticAttentionItem()],
  ]);

  await recordAccountFact({
    db,
    accountId: ACCOUNT_ID,
    field: "company.industry",
    value: "Banking",
    recordedBy: "operator@example.com",
    expectedCurrentFactId: priorFactId,
    correctionReason: "corrected",
  });

  assert.equal(calls.filter((c) => c.method === "insert").length, 3);
});

test("recordAccountFact: conservatively raises an attention item when the latest evaluation's frozen profileConfigSnapshot fails schema validation", async () => {
  const fact = syntheticFact({ field: "company.employeeRange", value: "51-200" });
  const evaluation = syntheticProductionEvaluation({
    profileConfigSnapshot: { configSchemaVersion: "v1" }, // missing fit/intent/actionability/eligibility
  });
  const { db, calls } = makeFakeDb([
    [{ id: ACCOUNT_ID }],
    [fact],
    [{ accountId: ACCOUNT_ID, field: "company.employeeRange", factId: FACT_ID }],
    [evaluation],
    [{ id: ACCOUNT_ID }],
    [syntheticAttentionItem({ context: { trigger: "account_fact_changed", evaluationId: EVALUATION_ID } })],
  ]);

  await recordAccountFact({
    db,
    accountId: ACCOUNT_ID,
    field: "company.employeeRange",
    value: "51-200",
    recordedBy: "operator@example.com",
    expectedCurrentFactId: null,
    correctionReason: null,
  });

  assert.equal(calls.filter((c) => c.method === "insert").length, 3);
});

test(
  "recordAccountFact: a genuine (non-dedup) failure while raising the staleness signal propagates unswallowed, never converted to StaleFactCorrectionError",
  async () => {
    const fact = syntheticFact();
    const evaluation = syntheticProductionEvaluation();
    const boom = new Error("simulated infra failure");
    const { db } = makeFakeDb([
      [{ id: ACCOUNT_ID }],
      [fact],
      [{ accountId: ACCOUNT_ID, field: "company.industry", factId: FACT_ID }],
      [evaluation],
      [{ id: ACCOUNT_ID }],
      () => {
        throw boom;
      },
    ]);

    // A real db.transaction() callback that throws an uncaught error rolls
    // back the ENTIRE transaction (the same mechanism recordAccountFact
    // already relies on for StaleFactCorrectionError below) — this proves
    // the application-layer half of that guarantee: the error must reach
    // the caller completely unswallowed and unconverted, so it is never
    // mistaken for a benign, already-handled outcome. What db.transaction()
    // does with an unswallowed throw (ROLLBACK) is standard drizzle-orm/
    // Postgres behavior, proven separately by real-Postgres coverage
    // elsewhere (see ./attentionItems.integration.test.ts and
    // ./accountFacts.integration.test.ts's atomic-commit tests), not
    // something a fake db can demonstrate.
    await assert.rejects(
      () =>
        recordAccountFact({
          db,
          accountId: ACCOUNT_ID,
          field: "company.industry",
          value: "Banking",
          recordedBy: "operator@example.com",
          expectedCurrentFactId: null,
          correctionReason: null,
        }),
      (err: unknown) => {
        assert.equal(err, boom);
        assert.ok(!(err instanceof StaleFactCorrectionError));
        return true;
      },
    );
  },
);

// ---------------------------------------------------------------------
// isAccountFactFieldReferencedInProfileConfig — the pure relevance rule,
// tested directly against the full range of RuleCondition shapes.
// ---------------------------------------------------------------------

function configWithFitCondition(condition: unknown): unknown {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [{ id: "r1", description: "d", points: 1, condition }],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

test("isAccountFactFieldReferencedInProfileConfig: true for a direct eq condition on the field", () => {
  const config = configWithFitCondition({ op: "eq", field: "company.industry", value: "Banking" });
  assert.equal(isAccountFactFieldReferencedInProfileConfig(config, "company.industry"), true);
});

test("isAccountFactFieldReferencedInProfileConfig: false for a field never referenced anywhere in fit", () => {
  const config = configWithFitCondition({ op: "eq", field: "company.industry", value: "Banking" });
  assert.equal(isAccountFactFieldReferencedInProfileConfig(config, "company.employeeRange"), false);
});

test("isAccountFactFieldReferencedInProfileConfig: false when fit has no rules at all", () => {
  const config = {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
  assert.equal(isAccountFactFieldReferencedInProfileConfig(config, "company.industry"), false);
});

test("isAccountFactFieldReferencedInProfileConfig: nested and/or/not references are found at any depth", () => {
  const config = configWithFitCondition({
    op: "and",
    conditions: [
      {
        op: "or",
        conditions: [
          { op: "not", condition: { op: "eq", field: "company.region", value: "us" } },
          { op: "eq", field: "company.domain", value: "example.com" },
        ],
      },
      { op: "exists", field: "company.employeeRange" },
    ],
  });
  assert.equal(isAccountFactFieldReferencedInProfileConfig(config, "company.region"), true);
  assert.equal(isAccountFactFieldReferencedInProfileConfig(config, "company.employeeRange"), true);
  assert.equal(isAccountFactFieldReferencedInProfileConfig(config, "company.revenueRange"), false);
});

test("isAccountFactFieldReferencedInProfileConfig: conservatively true when profileConfigSnapshot fails schema validation", () => {
  assert.equal(
    isAccountFactFieldReferencedInProfileConfig({ configSchemaVersion: "v1" }, "company.industry"),
    true,
  );
  assert.equal(isAccountFactFieldReferencedInProfileConfig(null, "company.industry"), true);
  assert.equal(isAccountFactFieldReferencedInProfileConfig("not an object", "company.industry"), true);
});

// ---------------------------------------------------------------------
// listAccountFacts
// ---------------------------------------------------------------------

test("listAccountFacts: splits current vs. history by comparing against the pointer-joined rows", async () => {
  const current = syntheticFact({ id: FACT_ID });
  const superseded = syntheticFact({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    supersedesFactId: null,
  });
  const { db } = makeFakeDb([
    [{ id: ACCOUNT_ID }], // account lookup
    [{ fact: current }], // current (pointer-joined)
    [current, superseded], // all facts for this account
  ]);

  const result = await listAccountFacts(db, ACCOUNT_ID);
  assert.deepEqual(result.current.map((f) => f.id), [FACT_ID]);
  assert.deepEqual(result.history.map((f) => f.id), [superseded.id]);
});

test("listAccountFacts throws AccountNotFoundError when the account does not exist", async () => {
  const { db } = makeFakeDb([[]]);
  await assert.rejects(() => listAccountFacts(db, ACCOUNT_ID), AccountNotFoundError);
});
