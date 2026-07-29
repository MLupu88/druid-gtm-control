// Unit tests for the account-decisions application service. No database
// needed — every db interaction is a fake queue-based query-chain object
// (see makeFakeDb), same spirit as ../services/accounts.test.ts's
// makeFakeDb and ../services/icpProfiles.test.ts's makeQueueTx, extended
// here with innerJoin/offset/onConflictDoNothing since this service both
// joins account_evaluations and performs race-safe get-or-create inserts.
// Each root select()/insert() call consumes the next canned response in
// call order, and every chain method call is recorded so tests can assert
// on call counts/shape without a real Postgres connection.
//
// Unlike the fake-db helpers elsewhere in this package, this one is
// narrowly typed (FakeQueryChain/FakeDbSurface) instead of `any` — the
// fake is cast into the production Db type with a single explicit,
// documented cast at the makeFakeDb boundary, not scattered `any`s.
//
// Run with: tsx --test src/services/accountDecisions.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accountDecisions,
  type AccountDecision,
  type AccountEvaluation,
  type DecisionPolicyVersion,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  MANUAL_DECISION_POLICY_VERSION,
  resolveManualDecisionPolicyVersion,
  deriveOverallDecisionGate,
  createAccountDecision,
  listAccountDecisions,
  getAccountDecisionById,
  AccountEvaluationNotFoundError,
  AccountEvaluationNotEligibleError,
  IdempotencyKeyConflictError,
  type OverallDecisionGate,
} from "./accountDecisions.js";

type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function syntheticEvaluation(
  overrides: Partial<AccountEvaluation> = {},
): AccountEvaluation {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    accountId: "11111111-1111-4111-8111-111111111111",
    snapshotId: "33333333-3333-4333-8333-333333333333",
    profileVersionId: "44444444-4444-4444-8444-444444444444",
    profileConfigSnapshot: { configSchemaVersion: "v1" },
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
    eligibilityRestrictions: [],
    hardDisqualifiers: [],
    scoreComponents: [],
    matchedRules: [],
    missingInputs: [],
    createdAt: new Date("2026-01-02T00:00:00Z"),
    createdBy: null,
    ...overrides,
  };
}

function syntheticDecisionPolicyVersion(
  overrides: Partial<DecisionPolicyVersion> = {},
): DecisionPolicyVersion {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    version: MANUAL_DECISION_POLICY_VERSION.version,
    description: MANUAL_DECISION_POLICY_VERSION.description,
    releasedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function syntheticDecision(
  overrides: Partial<AccountDecision> = {},
): AccountDecision {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    accountEvaluationId: "22222222-2222-4222-8222-222222222222",
    decisionPolicyVersionId: "66666666-6666-4666-8666-666666666666",
    operationalContextSnapshot: { source: "manual_operator_decision" },
    routingOutput: "mql",
    routingReason: null,
    channelAvailability: {},
    overallDecisionGate: "actionable",
    blockers: [],
    createdAt: new Date("2026-01-03T00:00:00Z"),
    createdBy: "operator@example.test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Runtime narrowing for a recorded call's raw argument (no cast).
// ---------------------------------------------------------------------

function assertIsRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${context} must be a plain object`,
  );
}

// ---------------------------------------------------------------------
// Fake db: a queue of canned responses, one per root select()/insert()
// call, consumed in call order. Every chain method call is recorded (with
// its arguments) onto a shared `calls` array.
//
// FakeQueryChain/FakeDbSurface are narrower than the real
// NodePgDatabase<typeof schema> — they cover exactly the surface
// accountDecisions.ts actually calls (select/insert plus the chain
// methods used). No member anywhere in this fake is typed `any`; the one
// unavoidable cast is the single `as unknown as Db` at the very end of
// makeFakeDb, bridging the narrow fake into the production Db type.
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
  offset(...args: unknown[]): FakeQueryChain;
  values(...args: unknown[]): FakeQueryChain;
  onConflictDoNothing(...args: unknown[]): FakeQueryChain;
  returning(...args: unknown[]): FakeQueryChain;
  then(
    resolve: (value: unknown) => void,
    reject?: (error: unknown) => void,
  ): void;
}

interface FakeDbSurface {
  select(...args: unknown[]): FakeQueryChain;
  insert(...args: unknown[]): FakeQueryChain;
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
      offset: (...args) => record("offset", args, result),
      values: (...args) => record("values", args, result),
      onConflictDoNothing: (...args) =>
        record("onConflictDoNothing", args, result),
      returning: (...args) => record("returning", args, result),
      then: (resolve, reject) => {
        Promise.resolve(queue[i++]).then(resolve, reject);
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
  };

  return { db: fakeDb as unknown as Db, calls };
}

// ---------------------------------------------------------------------
// deriveOverallDecisionGate — complete matrix, including precedence
// between the "blocked" and "restricted" branches.
// ---------------------------------------------------------------------

const gateMatrix: Array<
  [
    string,
    Partial<
      Pick<
        AccountEvaluation,
        "eligibilityOutcome" | "hardDisqualifiers" | "eligibilityRestrictions"
      >
    >,
    OverallDecisionGate,
  ]
> = [
  [
    "eligible outcome, no restrictions or disqualifiers",
    {
      eligibilityOutcome: "eligible",
      hardDisqualifiers: [],
      eligibilityRestrictions: [],
    },
    "actionable",
  ],
  [
    "restricted outcome, empty eligibilityRestrictions array",
    {
      eligibilityOutcome: "restricted",
      hardDisqualifiers: [],
      eligibilityRestrictions: [],
    },
    "restricted",
  ],
  [
    "eligible outcome but non-empty eligibilityRestrictions",
    {
      eligibilityOutcome: "eligible",
      hardDisqualifiers: [],
      eligibilityRestrictions: ["some-restriction"],
    },
    "restricted",
  ],
  [
    "ineligible outcome, empty hardDisqualifiers array",
    {
      eligibilityOutcome: "ineligible",
      hardDisqualifiers: [],
      eligibilityRestrictions: [],
    },
    "blocked",
  ],
  [
    "eligible outcome but non-empty hardDisqualifiers",
    {
      eligibilityOutcome: "eligible",
      hardDisqualifiers: ["some-disqualifier"],
      eligibilityRestrictions: [],
    },
    "blocked",
  ],
  [
    "ineligible outcome AND non-empty eligibilityRestrictions — blocked takes precedence over restricted",
    {
      eligibilityOutcome: "ineligible",
      hardDisqualifiers: [],
      eligibilityRestrictions: ["some-restriction"],
    },
    "blocked",
  ],
  [
    "non-empty hardDisqualifiers AND non-empty eligibilityRestrictions — blocked takes precedence",
    {
      eligibilityOutcome: "eligible",
      hardDisqualifiers: ["some-disqualifier"],
      eligibilityRestrictions: ["some-restriction"],
    },
    "blocked",
  ],
];

for (const [label, fields, expected] of gateMatrix) {
  test(`deriveOverallDecisionGate: ${label} => "${expected}"`, () => {
    const evaluation = syntheticEvaluation(fields);
    assert.equal(deriveOverallDecisionGate(evaluation), expected);
  });
}

// ---------------------------------------------------------------------
// resolveManualDecisionPolicyVersion
// ---------------------------------------------------------------------

test("resolveManualDecisionPolicyVersion returns the inserted row on first-ever insert, with no fallback select", async () => {
  const inserted = syntheticDecisionPolicyVersion();
  const { db, calls } = makeFakeDb([[inserted]]);

  const result = await resolveManualDecisionPolicyVersion(db);

  assert.equal(result, inserted);
  assert.equal(calls.filter((c) => c.method === "insert").length, 1);
  assert.equal(calls.filter((c) => c.method === "select").length, 0);
  const valuesCall = calls.find((c) => c.method === "values");
  assert.deepEqual(valuesCall?.args[0], {
    version: "manual-operator-v1",
    description:
      "Represents a direct human decision recorded by an operator — no automated decision/routing policy produced this row.",
  });
});

test("resolveManualDecisionPolicyVersion falls back to SELECT when the row already exists (insert conflict)", async () => {
  const existing = syntheticDecisionPolicyVersion();
  const { db, calls } = makeFakeDb([[], [existing]]);

  const result = await resolveManualDecisionPolicyVersion(db);

  assert.equal(result, existing);
  assert.equal(calls.filter((c) => c.method === "insert").length, 1);
  assert.equal(calls.filter((c) => c.method === "select").length, 1);
});

test("resolveManualDecisionPolicyVersion throws if the insert conflicted but no existing row is found", async () => {
  const { db } = makeFakeDb([[], []]);

  await assert.rejects(
    resolveManualDecisionPolicyVersion(db),
    /no existing row was found/,
  );
});

// ---------------------------------------------------------------------
// createAccountDecision — validation short-circuits
// ---------------------------------------------------------------------

test("createAccountDecision throws AccountEvaluationNotFoundError when the referenced evaluation does not exist, and touches nothing else", async () => {
  const { db, calls } = makeFakeDb([[]]);

  await assert.rejects(
    createAccountDecision({
      db,
      idempotencyKey: "88888888-8888-4888-8888-888888888801",
      accountEvaluationId: "99999999-9999-4999-8999-999999999999",
      routingOutput: "mql",
      createdBy: "operator@example.test",
    }),
    AccountEvaluationNotFoundError,
  );
  assert.equal(calls.filter((c) => c.method === "select").length, 1);
  assert.equal(calls.filter((c) => c.method === "insert").length, 0);
});

test("createAccountDecision throws AccountEvaluationNotEligibleError for a preview evaluation, and touches nothing else", async () => {
  const evaluation = syntheticEvaluation({ evaluationMode: "preview" });
  const { db, calls } = makeFakeDb([[evaluation]]);

  await assert.rejects(
    createAccountDecision({
      db,
      idempotencyKey: "88888888-8888-4888-8888-888888888802",
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      createdBy: "operator@example.test",
    }),
    AccountEvaluationNotEligibleError,
  );
  assert.equal(calls.filter((c) => c.method === "insert").length, 0);
});

test("createAccountDecision throws AccountEvaluationNotEligibleError for a failed evaluation, and touches nothing else", async () => {
  const evaluation = syntheticEvaluation({
    status: "failed",
    errorDetail: "some validation failure",
    fitScore: null,
    fitTier: null,
    intentScore: null,
    intentTier: null,
    identityResolutionLevel: null,
    identityConfidence: null,
    actionabilityScore: null,
    eligibilityOutcome: null,
  });
  const { db, calls } = makeFakeDb([[evaluation]]);

  await assert.rejects(
    createAccountDecision({
      db,
      idempotencyKey: "88888888-8888-4888-8888-888888888803",
      accountEvaluationId: evaluation.id,
      routingOutput: "sales_review",
      createdBy: "operator@example.test",
    }),
    AccountEvaluationNotEligibleError,
  );
  assert.equal(calls.filter((c) => c.method === "insert").length, 0);
});

test("createAccountDecision throws when createdBy is an empty/whitespace-only string, before touching the database", async () => {
  const { db, calls } = makeFakeDb([]);

  await assert.rejects(
    createAccountDecision({
      db,
      idempotencyKey: "88888888-8888-4888-8888-888888888804",
      accountEvaluationId: "22222222-2222-4222-8222-222222222222",
      routingOutput: "mql",
      createdBy: "   ",
    }),
    /createdBy is required/,
  );
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------
// createAccountDecision — successful creation
// ---------------------------------------------------------------------

test("createAccountDecision inserts exactly the expected row and returns created:true when the policy version already exists", async () => {
  const evaluation = syntheticEvaluation({
    eligibilityOutcome: "restricted",
    eligibilityRestrictions: ["needs_review"],
  });
  const policyVersion = syntheticDecisionPolicyVersion();
  const insertedDecision = syntheticDecision({
    accountEvaluationId: evaluation.id,
    overallDecisionGate: "restricted",
    routingOutput: "mql",
    routingReason: "Strong signal, needs review",
  });
  const { db, calls } = makeFakeDb([
    [evaluation],
    [], // policy version insert conflicts
    [policyVersion], // policy version select fallback
    [insertedDecision], // decision insert succeeds
  ]);

  const result = await createAccountDecision({
    db,
    idempotencyKey: insertedDecision.id,
    accountEvaluationId: evaluation.id,
    routingOutput: "mql",
    routingReason: "Strong signal, needs review",
    createdBy: "operator@example.test",
  });

  assert.equal(result.created, true);
  assert.equal(result.decision, insertedDecision);
  assert.equal(result.accountId, evaluation.accountId);

  const valuesCalls = calls.filter((c) => c.method === "values");
  const decisionValuesCall = valuesCalls[valuesCalls.length - 1];
  assert.ok(
    decisionValuesCall,
    "expected a values() call for the decision insert",
  );
  assert.deepEqual(decisionValuesCall.args[0], {
    id: insertedDecision.id,
    accountEvaluationId: evaluation.id,
    decisionPolicyVersionId: policyVersion.id,
    operationalContextSnapshot: { source: "manual_operator_decision" },
    channelAvailability: {},
    blockers: [],
    routingOutput: "mql",
    routingReason: "Strong signal, needs review",
    overallDecisionGate: "restricted",
    createdBy: "operator@example.test",
  });
});

test("createAccountDecision normalizes an omitted routingReason to null on insert", async () => {
  const evaluation = syntheticEvaluation();
  const policyVersion = syntheticDecisionPolicyVersion();
  const insertedDecision = syntheticDecision({
    accountEvaluationId: evaluation.id,
    routingOutput: "sales_review",
    routingReason: null,
  });
  const { db, calls } = makeFakeDb([
    [evaluation],
    [policyVersion],
    [insertedDecision],
  ]);

  await createAccountDecision({
    db,
    idempotencyKey: insertedDecision.id,
    accountEvaluationId: evaluation.id,
    routingOutput: "sales_review",
    createdBy: "operator@example.test",
  });

  const valuesCalls = calls.filter((c) => c.method === "values");
  const decisionValuesCall = valuesCalls[valuesCalls.length - 1];
  assert.ok(
    decisionValuesCall,
    "expected a values() call for the decision insert",
  );
  const insertedValues = decisionValuesCall.args[0];
  assertIsRecord(insertedValues, "decision insert values()");
  assert.equal(insertedValues.routingReason, null);
});

// ---------------------------------------------------------------------
// createAccountDecision — idempotency
// ---------------------------------------------------------------------

test("createAccountDecision: same idempotency key + same effective request returns created:false with the existing row", async () => {
  const evaluation = syntheticEvaluation();
  const idempotencyKey = "88888888-8888-4888-8888-888888888805";
  const existing = syntheticDecision({
    id: idempotencyKey,
    accountEvaluationId: evaluation.id,
    routingOutput: "mql",
    routingReason: null,
    createdBy: "operator@example.test",
  });
  const { db } = makeFakeDb([
    [evaluation],
    [syntheticDecisionPolicyVersion()],
    [], // decision insert conflicts
    [existing], // decision select fallback
  ]);

  const result = await createAccountDecision({
    db,
    idempotencyKey,
    accountEvaluationId: evaluation.id,
    routingOutput: "mql",
    routingReason: undefined,
    createdBy: "operator@example.test",
  });

  assert.equal(result.created, false);
  assert.deepEqual(result.decision, existing);
  assert.equal(result.accountId, evaluation.accountId);
});

test("createAccountDecision: an explicit null routingReason matches an existing row whose routingReason is also null (undefined/null treated equivalently)", async () => {
  const evaluation = syntheticEvaluation();
  const idempotencyKey = "88888888-8888-4888-8888-888888888806";
  const existing = syntheticDecision({
    id: idempotencyKey,
    accountEvaluationId: evaluation.id,
    routingOutput: "mql",
    routingReason: null,
    createdBy: "operator@example.test",
  });
  const { db } = makeFakeDb([
    [evaluation],
    [syntheticDecisionPolicyVersion()],
    [],
    [existing],
  ]);

  const result = await createAccountDecision({
    db,
    idempotencyKey,
    accountEvaluationId: evaluation.id,
    routingOutput: "mql",
    routingReason: null,
    createdBy: "operator@example.test",
  });

  assert.equal(result.created, false);
});

const idempotencyMismatchCases: Array<[string, Partial<AccountDecision>]> = [
  [
    "accountEvaluationId",
    { accountEvaluationId: "99999999-9999-4999-8999-999999999999" },
  ],
  ["routingOutput", { routingOutput: "sales_review" }],
  ["routingReason", { routingReason: "a completely different reason" }],
  ["createdBy", { createdBy: "someone-else@example.test" }],
];

for (const [field, override] of idempotencyMismatchCases) {
  test(`createAccountDecision throws IdempotencyKeyConflictError when the existing row's ${field} differs from the incoming request`, async () => {
    const evaluation = syntheticEvaluation();
    const idempotencyKey = "88888888-8888-4888-8888-888888888807";
    const existing = syntheticDecision({
      id: idempotencyKey,
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      routingReason: null,
      createdBy: "operator@example.test",
      ...override,
    });
    const { db } = makeFakeDb([
      [evaluation],
      [syntheticDecisionPolicyVersion()],
      [],
      [existing],
    ]);

    await assert.rejects(
      createAccountDecision({
        db,
        idempotencyKey,
        accountEvaluationId: evaluation.id,
        routingOutput: "mql",
        routingReason: null,
        createdBy: "operator@example.test",
      }),
      IdempotencyKeyConflictError,
    );
  });
}

test("createAccountDecision throws if the decision insert conflicted on id but no existing row is found", async () => {
  const evaluation = syntheticEvaluation();
  const { db } = makeFakeDb([
    [evaluation],
    [syntheticDecisionPolicyVersion()],
    [], // decision insert conflicts
    [], // decision select fallback finds nothing
  ]);

  await assert.rejects(
    createAccountDecision({
      db,
      idempotencyKey: "88888888-8888-4888-8888-888888888808",
      accountEvaluationId: evaluation.id,
      routingOutput: "mql",
      createdBy: "operator@example.test",
    }),
    /insert conflicted on id but no existing row was found/,
  );
});

// ---------------------------------------------------------------------
// listAccountDecisions
// ---------------------------------------------------------------------

test("listAccountDecisions issues exactly two queries total regardless of how many decisions are on the page (no N+1)", async () => {
  const manyItems = Array.from({ length: 25 }, (_, i) => ({
    decision: syntheticDecision({
      id: `77777777-7777-4777-8777-77777777${String(i).padStart(4, "0")}`,
    }),
    accountId: "11111111-1111-4111-8111-111111111111",
  }));
  const { db, calls } = makeFakeDb([[{ value: 25 }], manyItems]);

  const result = await listAccountDecisions({ db, limit: 100, offset: 0 });

  assert.equal(result.items.length, 25);
  const rootCalls = calls.filter((c) => c.method === "select");
  assert.equal(rootCalls.length, 2);
});

test("listAccountDecisions shapes total and items correctly, surfacing accountId per item", async () => {
  const items = [
    {
      decision: syntheticDecision({
        id: "77777777-7777-4777-8777-777777777771",
      }),
      accountId: "acc-1",
    },
    {
      decision: syntheticDecision({
        id: "77777777-7777-4777-8777-777777777772",
      }),
      accountId: "acc-2",
    },
  ];
  const { db } = makeFakeDb([[{ value: 2 }], items]);

  const result = await listAccountDecisions({ db, limit: 50, offset: 0 });

  assert.equal(result.total, 2);
  assert.deepEqual(result.items, items);
  assert.equal(result.items[0]?.accountId, "acc-1");
  assert.equal(result.items[1]?.accountId, "acc-2");
});

test("listAccountDecisions orders by createdAt desc, then id desc — the exact ordering expressions, not just their count", async () => {
  const { db, calls } = makeFakeDb([[{ value: 0 }], []]);

  await listAccountDecisions({ db, limit: 50, offset: 0 });

  const orderByCall = calls.find((c) => c.method === "orderBy");
  assert.ok(orderByCall, "expected an orderBy() call");
  // Compares against the same desc()/column construction the service
  // itself uses (real drizzle-orm desc() over the real schema column
  // objects) — the strongest check the fake-db pattern supports, since
  // it verifies the actual ordering expressions rather than only their
  // count.
  assert.deepEqual(orderByCall.args, [
    desc(accountDecisions.createdAt),
    desc(accountDecisions.id),
  ]);
});

test("listAccountDecisions omits the accountId filter (where receives undefined) when accountId is not supplied", async () => {
  const { db, calls } = makeFakeDb([[{ value: 0 }], []]);

  await listAccountDecisions({ db, limit: 50, offset: 0 });

  const whereCalls = calls.filter((c) => c.method === "where");
  assert.equal(whereCalls.length, 2); // one for count, one for the page query
  for (const call of whereCalls) {
    assert.equal(call.args[0], undefined);
  }
});

test("listAccountDecisions applies a real SQL filter (where receives a defined condition) when accountId is supplied, on both the count and page queries", async () => {
  const { db, calls } = makeFakeDb([[{ value: 0 }], []]);

  await listAccountDecisions({
    db,
    limit: 50,
    offset: 0,
    accountId: "11111111-1111-4111-8111-111111111111",
  });

  const whereCalls = calls.filter((c) => c.method === "where");
  assert.equal(whereCalls.length, 2);
  for (const call of whereCalls) {
    assert.notEqual(call.args[0], undefined);
  }
});

// ---------------------------------------------------------------------
// getAccountDecisionById
// ---------------------------------------------------------------------

test("getAccountDecisionById returns undefined when no such row exists", async () => {
  const { db } = makeFakeDb([[]]);

  const result = await getAccountDecisionById(
    db,
    "99999999-9999-4999-8999-999999999999",
  );

  assert.equal(result, undefined);
});

test("getAccountDecisionById returns the exact decision row and its accountId", async () => {
  const row = {
    decision: syntheticDecision(),
    accountId: "11111111-1111-4111-8111-111111111111",
  };
  const { db } = makeFakeDb([[row]]);

  const result = await getAccountDecisionById(db, row.decision.id);

  assert.deepEqual(result, row);
});
