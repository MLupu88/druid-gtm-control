// Route-level tests for /api/internal/account-evaluations. No database
// needed — createAccountEvaluationsRouter's db is a required but unused
// fake object here, and evaluateAndPersistFn/getAccountEvaluationByIdFn
// are always injected fakes. Runs a real ephemeral HTTP server
// (app.listen(0)) and issues real fetch() requests, since Express 5's
// routing/JSON-parsing/status-code behavior is exactly what these tests
// need to exercise — no supertest or other new dependency required.
//
// Run with: tsx --test src/routes/accountEvaluations.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { AccountEvaluation } from "@workspace/db/schema";
import {
  MissingRecordError,
  ProductionRequiresPublishedProfileError,
} from "@workspace/evaluator-persistence";
import { UnsupportedEvaluatorVersionError } from "@workspace/evaluator";
import type { Operator } from "../lib/operators.js";
import type {
  EvaluateAndPersistFn,
  GetAccountEvaluationByIdFn,
} from "../services/accountEvaluations.js";
import {
  createAccountEvaluationsRouter,
  type AccountEvaluationsRouterDeps,
} from "./accountEvaluations.js";

const VALID_UUID_A = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_B = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_C = "33333333-3333-4333-8333-333333333333";

function syntheticEvaluation(
  overrides: Partial<AccountEvaluation> = {},
): AccountEvaluation {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    accountId: "acc-1",
    snapshotId: VALID_UUID_A,
    profileVersionId: VALID_UUID_B,
    profileConfigSnapshot: { configSchemaVersion: "v1" },
    evaluatorVersionId: VALID_UUID_C,
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

const validRequestBody = {
  snapshotId: VALID_UUID_A,
  profileVersionId: VALID_UUID_B,
  evaluatorVersionId: VALID_UUID_C,
  evaluationMode: "preview" as const,
};

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function buildTestApp(
  deps: Omit<AccountEvaluationsRouterDeps, "db">,
  operator?: Operator,
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Stubs req.log so the route's req.log?.info/.error calls have
    // something to call — mirrors what pino-http provides in production
    // (see app.ts) without requiring that middleware here.
    req.log = { info: () => {}, warn: () => {}, error: () => {} } as never;
    if (operator) req.operator = operator;
    next();
  });
  app.use("/", createAccountEvaluationsRouter({ db: {} as never, ...deps }));
  return app;
}

async function withServer(
  app: Express,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

// ---------------------------------------------------------------------
// POST /
// ---------------------------------------------------------------------

test("POST with a valid body invokes the service exactly once and returns 201 with the persisted evaluation", async () => {
  const persisted = syntheticEvaluation();
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(
    async () => persisted,
  );
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody),
    });
    const body = await readJson(res);

    assert.equal(res.status, 201);
    assert.deepEqual(body, JSON.parse(JSON.stringify(persisted)));
    assert.equal(evaluateAndPersistFn.mock.calls.length, 1);
  });
});

test("POST returns 201 for a persisted evaluation whose status is 'failed' — a truthfully-recorded outcome, not an HTTP error", async () => {
  const failedRow = syntheticEvaluation({
    status: "failed",
    errorDetail:
      "account snapshot failed NormalizedAccountInputV1 validation: ...",
    fitScore: null,
    fitTier: null,
    intentScore: null,
    intentTier: null,
    identityResolutionLevel: null,
    identityConfidence: null,
    actionabilityScore: null,
    eligibilityOutcome: null,
  });
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(
    async () => failedRow,
  );
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody),
    });
    const body = await readJson(res);

    assert.equal(res.status, 201);
    assert.equal(body.status, "failed");
  });
});

test("POST rejects a body containing an unknown field with 400 and does not call the service", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation(),
  );
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validRequestBody, unknownField: "nope" }),
    });

    assert.equal(res.status, 400);
    const body = await readJson(res);
    assert.equal(body.code, "invalid_request");
    assert.equal(evaluateAndPersistFn.mock.calls.length, 0);
  });
});

test("POST rejects a body that supplies createdBy — it is never accepted from the client", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation(),
  );
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validRequestBody,
        createdBy: "spoofed@example.test",
      }),
    });

    assert.equal(res.status, 400);
    assert.equal(evaluateAndPersistFn.mock.calls.length, 0);
  });
});

test("POST rejects a non-UUID snapshotId with 400 and does not call the service", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation(),
  );
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validRequestBody, snapshotId: "not-a-uuid" }),
    });

    assert.equal(res.status, 400);
    assert.equal(evaluateAndPersistFn.mock.calls.length, 0);
  });
});

test("POST maps MissingRecordError to 404 record_not_found and calls the service exactly once (no retry)", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    throw new MissingRecordError("accountSnapshot", VALID_UUID_A);
  });
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody),
    });
    const body = await readJson(res);

    assert.equal(res.status, 404);
    assert.equal(body.code, "record_not_found");
    assert.equal(evaluateAndPersistFn.mock.calls.length, 1);
  });
});

test("POST maps ProductionRequiresPublishedProfileError to 409", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    throw new ProductionRequiresPublishedProfileError(VALID_UUID_B, "draft");
  });
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validRequestBody,
        evaluationMode: "production",
      }),
    });
    const body = await readJson(res);

    assert.equal(res.status, 409);
    assert.equal(body.code, "production_requires_published_profile");
  });
});

test("POST maps UnsupportedEvaluatorVersionError to 422", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    throw new UnsupportedEvaluatorVersionError("not-a-real-version");
  });
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody),
    });
    const body = await readJson(res);

    assert.equal(res.status, 422);
    assert.equal(body.code, "unsupported_evaluator_version");
  });
});

test("POST maps an unexpected error to the existing safe 500 response, without leaking internal details", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () => {
    throw new Error(
      "relation account_evaluations violates constraint xyz at connection pg://internal",
    );
  });
  const app = buildTestApp({ evaluateAndPersistFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody),
    });
    const body = await readJson(res);

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
    assert.ok(!String(body.error).includes("constraint"));
  });
});

// ---------------------------------------------------------------------
// createdBy derivation (server-side only, never from the request body)
// ---------------------------------------------------------------------

test("POST derives createdBy from a verified operator's non-empty email", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation(),
  );
  const app = buildTestApp(
    { evaluateAndPersistFn },
    { name: "Jane Operator", email: "jane@example.test", role: "operator" },
  );

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody),
    });
  });

  assert.equal(
    evaluateAndPersistFn.mock.calls[0]?.arguments[0].createdBy,
    "jane@example.test",
  );
});

test("POST persists createdBy as null when the authenticated operator has no non-empty email (e.g. the unconfigured OPERATORS fallback)", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation(),
  );
  const app = buildTestApp(
    { evaluateAndPersistFn },
    { name: "Authenticated operator", email: "", role: "operator" },
  );

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody),
    });
  });

  assert.equal(
    evaluateAndPersistFn.mock.calls[0]?.arguments[0].createdBy,
    null,
  );
});

test("POST persists createdBy as null when no operator is present on the request at all", async () => {
  const evaluateAndPersistFn = mock.fn<EvaluateAndPersistFn>(async () =>
    syntheticEvaluation(),
  );
  const app = buildTestApp({ evaluateAndPersistFn }); // no operator argument

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validRequestBody),
    });
  });

  assert.equal(
    evaluateAndPersistFn.mock.calls[0]?.arguments[0].createdBy,
    null,
  );
});

// ---------------------------------------------------------------------
// GET /:evaluationId
// ---------------------------------------------------------------------

test("GET returns 200 with the persisted evaluation", async () => {
  const row = syntheticEvaluation();
  const getAccountEvaluationByIdFn = mock.fn<GetAccountEvaluationByIdFn>(
    async () => row,
  );
  const app = buildTestApp({ getAccountEvaluationByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${row.id}`);
    const body = await readJson(res);

    assert.equal(res.status, 200);
    assert.deepEqual(body, JSON.parse(JSON.stringify(row)));
    assert.equal(getAccountEvaluationByIdFn.mock.calls.length, 1);
    assert.equal(
      getAccountEvaluationByIdFn.mock.calls[0]?.arguments[1],
      row.id,
    );
  });
});

test("GET returns 404 evaluation_not_found when no evaluation exists with that id", async () => {
  const getAccountEvaluationByIdFn = mock.fn<GetAccountEvaluationByIdFn>(
    async () => undefined,
  );
  const app = buildTestApp({ getAccountEvaluationByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_UUID_A}`);
    const body = await readJson(res);

    assert.equal(res.status, 404);
    assert.equal(body.code, "evaluation_not_found");
  });
});

test("GET rejects a non-UUID evaluationId with 400 and does not call the service", async () => {
  const getAccountEvaluationByIdFn = mock.fn<GetAccountEvaluationByIdFn>(
    async () => undefined,
  );
  const app = buildTestApp({ getAccountEvaluationByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-a-uuid`);
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(getAccountEvaluationByIdFn.mock.calls.length, 0);
  });
});

test("GET maps an unexpected error to the existing safe 500 response", async () => {
  const getAccountEvaluationByIdFn = mock.fn<GetAccountEvaluationByIdFn>(
    async () => {
      throw new Error("connection terminated unexpectedly");
    },
  );
  const app = buildTestApp({ getAccountEvaluationByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_UUID_A}`);
    const body = await readJson(res);

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("connection terminated"));
  });
});
