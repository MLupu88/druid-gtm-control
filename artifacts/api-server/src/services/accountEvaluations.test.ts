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
  type EvaluateAndPersistFn,
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

const fakeDb = {} as never;

// ---------------------------------------------------------------------
// createAccountEvaluation
// ---------------------------------------------------------------------

test("createAccountEvaluation calls the injected evaluateAndPersistFn exactly once with the exact args it was given", async () => {
  const returned = syntheticEvaluation();
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(
    async () => returned,
  );

  const result = await createAccountEvaluation(
    {
      db: fakeDb,
      snapshotId: "snap-1",
      profileVersionId: "pv-1",
      evaluatorVersionId: "ev-1",
      evaluationMode: "production",
      createdBy: "operator@example.test",
    },
    evaluateAndPersistFn,
  );

  assert.equal(evaluateAndPersistFn.mock.calls.length, 1);
  assert.deepEqual(evaluateAndPersistFn.mock.calls[0]?.arguments[0], {
    db: fakeDb,
    snapshotId: "snap-1",
    profileVersionId: "pv-1",
    evaluatorVersionId: "ev-1",
    evaluationMode: "production",
    createdBy: "operator@example.test",
  });
  assert.equal(result, returned);
});

test("createAccountEvaluation defaults createdBy to null when omitted", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation(),
  );

  await createAccountEvaluation(
    {
      db: fakeDb,
      snapshotId: "snap-1",
      profileVersionId: "pv-1",
      evaluatorVersionId: "ev-1",
      evaluationMode: "preview",
    },
    evaluateAndPersistFn,
  );

  assert.equal(
    evaluateAndPersistFn.mock.calls[0]?.arguments[0].createdBy,
    null,
  );
});

test("createAccountEvaluation propagates whatever the injected fn throws, without swallowing it", async () => {
  const boom = new Error("simulated failure");
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    throw boom;
  });

  await assert.rejects(
    createAccountEvaluation(
      {
        db: fakeDb,
        snapshotId: "snap-1",
        profileVersionId: "pv-1",
        evaluatorVersionId: "ev-1",
        evaluationMode: "preview",
      },
      evaluateAndPersistFn,
    ),
    boom,
  );
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
