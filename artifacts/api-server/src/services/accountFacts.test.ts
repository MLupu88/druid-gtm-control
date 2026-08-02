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
