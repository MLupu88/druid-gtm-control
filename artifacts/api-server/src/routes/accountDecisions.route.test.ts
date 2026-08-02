// Route-level tests for /api/internal/account-decisions. No database of
// any kind — real or fake — is ever constructed here:
// createAccountDecisionsRouter accepts a dependency shape with no `db`
// field at all once all three service functions are supplied directly
// (see AccountDecisionsRouterDeps in ./accountDecisions.ts), so these
// tests inject fully-typed fakes instead of casting a stand-in object to
// the database type. Runs a real ephemeral HTTP server (app.listen(0))
// and issues real fetch() requests, mirroring ./accounts.route.test.ts
// and ./accountEvaluations.route.test.ts.
//
// Run with: tsx --test src/routes/accountDecisions.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { AccountDecision } from "@workspace/db/schema";
import {
  AccountEvaluationNotFoundError,
  AccountEvaluationNotEligibleError,
  EvaluationNotDecisionReadyError,
  IdempotencyKeyConflictError,
} from "../services/accountDecisions.js";
import type { Operator } from "../lib/operators.js";
import {
  createAccountDecisionsRouter,
  type CreateAccountDecisionFn,
  type ListAccountDecisionsFn,
  type GetAccountDecisionByIdFn,
} from "./accountDecisions.js";

const VALID_EVALUATION_ID = "11111111-1111-4111-8111-111111111111";
const VALID_DECISION_ID = "22222222-2222-4222-8222-222222222222";
const VALID_ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const VALID_POLICY_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const VALID_IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";

function syntheticDecision(
  overrides: Partial<AccountDecision> = {},
): AccountDecision {
  return {
    id: VALID_DECISION_ID,
    accountEvaluationId: VALID_EVALUATION_ID,
    decisionPolicyVersionId: VALID_POLICY_VERSION_ID,
    operationalContextSnapshot: { source: "manual_operator_decision" },
    routingOutput: "mql",
    routingReason: null,
    channelAvailability: {},
    overallDecisionGate: "actionable",
    blockers: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: "operator@example.test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Runtime narrowing for a real, un-typed fetch() response body — no cast.
// ---------------------------------------------------------------------

function assertIsRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${context} must be a JSON object`,
  );
}

function assertIsNumber(
  value: unknown,
  context: string,
): asserts value is number {
  assert.ok(typeof value === "number", `${context} must be a number`);
}

async function readJson(
  res: Response,
  context: string,
): Promise<Record<string, unknown>> {
  const value: unknown = await res.json();
  assertIsRecord(value, context);
  return value;
}

// ---------------------------------------------------------------------
// Test app scaffolding
// ---------------------------------------------------------------------

const unusedCreateAccountDecisionFn: CreateAccountDecisionFn = async () => {
  throw new Error("createAccountDecisionFn should not have been called");
};
const unusedListAccountDecisionsFn: ListAccountDecisionsFn = async () => {
  throw new Error("listAccountDecisionsFn should not have been called");
};
const unusedGetAccountDecisionByIdFn: GetAccountDecisionByIdFn = async () => {
  throw new Error("getAccountDecisionByIdFn should not have been called");
};

const DEFAULT_TEST_OPERATOR: Operator = {
  name: "Test Operator",
  email: "operator@example.test",
  role: "operator",
};

function buildTestApp(
  deps: {
    createAccountDecisionFn?: CreateAccountDecisionFn;
    listAccountDecisionsFn?: ListAccountDecisionsFn;
    getAccountDecisionByIdFn?: GetAccountDecisionByIdFn;
  },
  operator: Operator | null = DEFAULT_TEST_OPERATOR,
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (operator) req.operator = operator;
    next();
  });
  app.use(
    "/",
    createAccountDecisionsRouter({
      createAccountDecisionFn:
        deps.createAccountDecisionFn ?? unusedCreateAccountDecisionFn,
      listAccountDecisionsFn:
        deps.listAccountDecisionsFn ?? unusedListAccountDecisionsFn,
      getAccountDecisionByIdFn:
        deps.getAccountDecisionByIdFn ?? unusedGetAccountDecisionByIdFn,
    }),
  );
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

function validPostBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    accountEvaluationId: VALID_EVALUATION_ID,
    routingOutput: "mql",
    ...overrides,
  };
}

// idempotencyKey is always explicit at the call site (null = omit the
// header entirely) — a default parameter can't represent "omit" here,
// since passing `undefined` explicitly would just re-trigger the default.
async function postDecision(
  baseUrl: string,
  body: unknown,
  idempotencyKey: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (idempotencyKey !== null) headers["Idempotency-Key"] = idempotencyKey;
  return fetch(`${baseUrl}/`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------
// POST / — success paths
// ---------------------------------------------------------------------

test("POST with a valid request and created:true returns 201 with the persisted decision and accountId", async () => {
  const decision = syntheticDecision();
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision,
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody(),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(res, "POST / 201 response body");

    assert.equal(res.status, 201);
    assert.deepEqual(body.decision, JSON.parse(JSON.stringify(decision)));
    assert.equal(body.accountId, VALID_ACCOUNT_ID);
    assert.equal(createAccountDecisionFn.mock.calls.length, 1);
  });
});

test("POST accepts routingOutput \"dismissed\" and returns 201 with the persisted decision", async () => {
  const decision = syntheticDecision({ routingOutput: "dismissed" });
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision,
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody({ routingOutput: "dismissed" }),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(res, "POST / dismissed response body");

    assert.equal(res.status, 201);
    assert.deepEqual(body.decision, JSON.parse(JSON.stringify(decision)));
    assert.equal(createAccountDecisionFn.mock.calls.length, 1);
    assert.equal(
      createAccountDecisionFn.mock.calls[0]?.arguments[0].routingOutput,
      "dismissed",
    );
  });
});

test("POST with created:false (idempotent replay) returns 200 with the existing persisted decision", async () => {
  const decision = syntheticDecision();
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision,
      accountId: VALID_ACCOUNT_ID,
      created: false,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody(),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(res, "POST / 200 replay response body");

    assert.equal(res.status, 200);
    assert.deepEqual(body.decision, JSON.parse(JSON.stringify(decision)));
    assert.equal(body.accountId, VALID_ACCOUNT_ID);
    assert.equal(createAccountDecisionFn.mock.calls.length, 1);
  });
});

test("POST calls the service exactly once with the exact parsed arguments, including a trimmed operator email", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp(
    { createAccountDecisionFn },
    { name: "Operator", email: "  operator@example.test  ", role: "operator" },
  );

  await withServer(app, async (baseUrl) => {
    await postDecision(
      baseUrl,
      validPostBody({ routingReason: "Strong signal" }),
      VALID_IDEMPOTENCY_KEY,
    );
  });

  assert.equal(createAccountDecisionFn.mock.calls.length, 1);
  assert.deepEqual(createAccountDecisionFn.mock.calls[0]?.arguments[0], {
    idempotencyKey: VALID_IDEMPOTENCY_KEY,
    accountEvaluationId: VALID_EVALUATION_ID,
    routingOutput: "mql",
    routingReason: "Strong signal",
    createdBy: "operator@example.test",
  });
});

test("POST passes routingReason as undefined when omitted from the body", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    await postDecision(baseUrl, validPostBody(), VALID_IDEMPOTENCY_KEY);
  });

  assert.equal(createAccountDecisionFn.mock.calls.length, 1);
  assert.equal(
    createAccountDecisionFn.mock.calls[0]?.arguments[0].routingReason,
    undefined,
  );
});

test("POST passes an explicit null routingReason through as null", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    await postDecision(
      baseUrl,
      validPostBody({ routingReason: null }),
      VALID_IDEMPOTENCY_KEY,
    );
  });

  assert.equal(createAccountDecisionFn.mock.calls.length, 1);
  assert.equal(
    createAccountDecisionFn.mock.calls[0]?.arguments[0].routingReason,
    null,
  );
});

// ---------------------------------------------------------------------
// POST / — Idempotency-Key validation
// ---------------------------------------------------------------------

test("POST rejects a missing Idempotency-Key header with 400 and does not call the service", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(baseUrl, validPostBody(), null);
    const body = await readJson(
      res,
      "POST / missing Idempotency-Key response body",
    );

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(createAccountDecisionFn.mock.calls.length, 0);
  });
});

test("POST rejects a malformed Idempotency-Key header with 400 and does not call the service", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(baseUrl, validPostBody(), "not-a-uuid");
    const body = await readJson(
      res,
      "POST / malformed Idempotency-Key response body",
    );

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(createAccountDecisionFn.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------
// POST / — body validation
// ---------------------------------------------------------------------

test("POST rejects a non-UUID accountEvaluationId with 400 and does not call the service", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody({ accountEvaluationId: "not-a-uuid" }),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(
      res,
      "POST / invalid accountEvaluationId response body",
    );

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(createAccountDecisionFn.mock.calls.length, 0);
  });
});

const invalidRoutingOutputs = [
  "dismiss",
  "suppressed",
  "nurture",
  "pipeline_assist",
  "owner_alert",
  "retarget",
  "not-a-real-value",
];

for (const routingOutput of invalidRoutingOutputs) {
  test(`POST rejects routingOutput "${routingOutput}" with 400 and does not call the service`, async () => {
    const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
      async () => ({
        decision: syntheticDecision(),
        accountId: VALID_ACCOUNT_ID,
        created: true,
      }),
    );
    const app = buildTestApp({ createAccountDecisionFn });

    await withServer(app, async (baseUrl) => {
      const res = await postDecision(
        baseUrl,
        validPostBody({ routingOutput }),
        VALID_IDEMPOTENCY_KEY,
      );
      const body = await readJson(
        res,
        `POST / routingOutput="${routingOutput}" response body`,
      );

      assert.equal(res.status, 400);
      assert.equal(body.code, "invalid_request");
      assert.equal(createAccountDecisionFn.mock.calls.length, 0);
    });
  });
}

test("POST rejects a body containing an unknown field with 400 and does not call the service", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody({ unknownField: "nope" }),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(res, "POST / unknown field response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(createAccountDecisionFn.mock.calls.length, 0);
  });
});

test("POST rejects a body that supplies createdBy — it is never accepted from the client", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody({ createdBy: "spoofed@example.test" }),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(res, "POST / createdBy in body response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(createAccountDecisionFn.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------
// POST / — operator identity
// ---------------------------------------------------------------------

test("POST rejects a blank operator email with 403 operator_identity_required and does not call the service", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp(
    { createAccountDecisionFn },
    { name: "Authenticated operator", email: "", role: "operator" },
  );

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody(),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(
      res,
      "POST / blank operator email response body",
    );

    assert.equal(res.status, 403);
    assert.equal(body.code, "operator_identity_required");
    assert.equal(createAccountDecisionFn.mock.calls.length, 0);
  });
});

test("POST rejects a request with no operator on it at all with 403 operator_identity_required and does not call the service", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
    async () => ({
      decision: syntheticDecision(),
      accountId: VALID_ACCOUNT_ID,
      created: true,
    }),
  );
  const app = buildTestApp({ createAccountDecisionFn }, null);

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody(),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(res, "POST / missing operator response body");

    assert.equal(res.status, 403);
    assert.equal(body.code, "operator_identity_required");
    assert.equal(createAccountDecisionFn.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------
// POST / — service error mapping
// ---------------------------------------------------------------------

const postServiceErrorCases: Array<{
  label: string;
  makeError: () => Error;
  status: number;
  code: string;
}> = [
  {
    label: "AccountEvaluationNotFoundError",
    makeError: () => new AccountEvaluationNotFoundError(VALID_EVALUATION_ID),
    status: 404,
    code: "record_not_found",
  },
  {
    label: "AccountEvaluationNotEligibleError",
    makeError: () =>
      new AccountEvaluationNotEligibleError(
        VALID_EVALUATION_ID,
        "completed",
        "preview",
      ),
    status: 409,
    code: "evaluation_not_eligible",
  },
  {
    label: "IdempotencyKeyConflictError",
    makeError: () => new IdempotencyKeyConflictError(VALID_IDEMPOTENCY_KEY),
    status: 409,
    code: "idempotency_conflict",
  },
  {
    label: "EvaluationNotDecisionReadyError",
    makeError: () =>
      new EvaluationNotDecisionReadyError(VALID_EVALUATION_ID, [
        {
          code: "intent_not_configured",
          message: "This profile has no configured intent rule.",
        },
      ]),
    status: 422,
    code: "evaluation_not_decision_ready",
  },
];

for (const { label, makeError, status, code } of postServiceErrorCases) {
  test(`POST maps ${label} to ${status} ${code}`, async () => {
    const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(
      async () => {
        throw makeError();
      },
    );
    const app = buildTestApp({ createAccountDecisionFn });

    await withServer(app, async (baseUrl) => {
      const res = await postDecision(
        baseUrl,
        validPostBody(),
        VALID_IDEMPOTENCY_KEY,
      );
      const body = await readJson(res, `POST / ${code} response body`);

      assert.equal(res.status, status);
      assert.equal(body.code, code);
      assert.equal(createAccountDecisionFn.mock.calls.length, 1);
    });
  });
}

test("POST 422 evaluation_not_decision_ready carries the structured reasons array from EvaluationNotDecisionReadyError verbatim", async () => {
  const reasons = [
    {
      code: "intent_not_configured" as const,
      message: "This profile has no configured intent rule.",
    },
    {
      code: "required_condition_unresolved" as const,
      dimension: "fit" as const,
      ruleId: "fit_industry",
      fields: ["company.industry"],
      message: "The fit rule could not be resolved.",
    },
  ];
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(async () => {
    throw new EvaluationNotDecisionReadyError(VALID_EVALUATION_ID, reasons);
  });
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody(),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(res, "POST / 422 response body");

    assert.equal(res.status, 422);
    assert.equal(body.code, "evaluation_not_decision_ready");
    assert.deepEqual(body.reasons, reasons);
  });
});

test("POST maps an unexpected service error to a safe 500 response, without leaking internal details", async () => {
  const createAccountDecisionFn = mock.fn<CreateAccountDecisionFn>(async () => {
    throw new Error(
      "relation account_decisions violates constraint xyz at connection pg://internal",
    );
  });
  const app = buildTestApp({ createAccountDecisionFn });

  await withServer(app, async (baseUrl) => {
    const res = await postDecision(
      baseUrl,
      validPostBody(),
      VALID_IDEMPOTENCY_KEY,
    );
    const body = await readJson(res, "POST / 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
    assert.ok(!String(body.error).includes("constraint"));
    assert.equal(createAccountDecisionFn.mock.calls.length, 1);
  });
});

// ---------------------------------------------------------------------
// GET / — pagination
// ---------------------------------------------------------------------

test("GET / with no query parameters uses default pagination (limit 50, offset 0) and calls the service exactly once", async () => {
  const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountDecisionsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    const body = await readJson(res, "GET / default pagination response body");

    assert.equal(res.status, 200);
    assert.deepEqual(body.pagination, { limit: 50, offset: 0, total: 0 });
    assert.equal(listAccountDecisionsFn.mock.calls.length, 1);
    assert.deepEqual(listAccountDecisionsFn.mock.calls[0]?.arguments[0], {
      limit: 50,
      offset: 0,
    });
  });
});

test("GET / with explicit limit, offset, and accountId calls the service exactly once with the parsed values", async () => {
  const items = [
    { decision: syntheticDecision(), accountId: VALID_ACCOUNT_ID },
  ];
  const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(async () => ({
    items,
    total: 3,
  }));
  const app = buildTestApp({ listAccountDecisionsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/?limit=10&offset=20&accountId=${VALID_ACCOUNT_ID}`,
    );
    const body = await readJson(res, "GET / explicit pagination response body");

    assert.equal(res.status, 200);
    assert.deepEqual(body.pagination, { limit: 10, offset: 20, total: 3 });
    assert.deepEqual(body.items, JSON.parse(JSON.stringify(items)));
    assert.equal(listAccountDecisionsFn.mock.calls.length, 1);
    assert.deepEqual(listAccountDecisionsFn.mock.calls[0]?.arguments[0], {
      limit: 10,
      offset: 20,
      accountId: VALID_ACCOUNT_ID,
    });
  });
});

const validBoundaryCases: Array<[string, string, number, number]> = [
  ["the minimum limit (1)", "limit=1", 1, 0],
  ["the maximum limit (100)", "limit=100", 100, 0],
  ["an explicit offset of 0", "limit=50&offset=0", 50, 0],
];

for (const [
  label,
  query,
  expectedLimit,
  expectedOffset,
] of validBoundaryCases) {
  test(`GET / accepts ${label} and calls the service exactly once with the exact parsed values`, async () => {
    const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(
      async () => ({
        items: [],
        total: 0,
      }),
    );
    const app = buildTestApp({ listAccountDecisionsFn });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?${query}`);
      const body = await readJson(res, `GET /?${query} response body`);

      assert.equal(res.status, 200);
      assert.deepEqual(body.pagination, {
        limit: expectedLimit,
        offset: expectedOffset,
        total: 0,
      });
      assert.equal(listAccountDecisionsFn.mock.calls.length, 1);
      assert.deepEqual(listAccountDecisionsFn.mock.calls[0]?.arguments[0], {
        limit: expectedLimit,
        offset: expectedOffset,
      });
    });
  });
}

test("GET / response exposes items and pagination.total/limit/offset as numbers", async () => {
  const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(async () => ({
    items: [],
    total: 5,
  }));
  const app = buildTestApp({ listAccountDecisionsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?limit=25&offset=5`);
    const body = await readJson(res, "GET / response shape body");

    assert.ok(
      Array.isArray(body.items),
      "response body.items must be an array",
    );
    assertIsRecord(body.pagination, "response body.pagination");
    assertIsNumber(body.pagination.total, "response body.pagination.total");
    assertIsNumber(body.pagination.limit, "response body.pagination.limit");
    assertIsNumber(body.pagination.offset, "response body.pagination.offset");
    assert.equal(body.pagination.total, 5);
    assert.equal(body.pagination.limit, 25);
    assert.equal(body.pagination.offset, 5);
    assert.equal(listAccountDecisionsFn.mock.calls.length, 1);
  });
});

const invalidLimitCases: Array<[string, string]> = [
  ["fractional", "limit=1.5"],
  ["negative", "limit=-1"],
  ["zero", "limit=0"],
  ["above the maximum", "limit=101"],
  ["non-numeric", "limit=abc"],
  ["empty", "limit="],
  ["whitespace-only", "limit=%20"],
];

for (const [label, query] of invalidLimitCases) {
  test(`GET / rejects a ${label} limit with 400 and does not call the service`, async () => {
    const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(
      async () => ({
        items: [],
        total: 0,
      }),
    );
    const app = buildTestApp({ listAccountDecisionsFn });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?${query}`);
      const body = await readJson(res, `GET /?${query} response body`);

      assert.equal(res.status, 400);
      assert.equal(body.code, "invalid_request");
      assert.equal(listAccountDecisionsFn.mock.calls.length, 0);
    });
  });
}

const invalidOffsetCases: Array<[string, string]> = [
  ["fractional", "offset=1.5"],
  ["negative", "offset=-1"],
  ["non-numeric", "offset=abc"],
  ["empty", "offset="],
  ["whitespace-only", "offset=%20"],
];

for (const [label, query] of invalidOffsetCases) {
  test(`GET / rejects a ${label} offset with 400 and does not call the service`, async () => {
    const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(
      async () => ({
        items: [],
        total: 0,
      }),
    );
    const app = buildTestApp({ listAccountDecisionsFn });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?${query}`);
      const body = await readJson(res, `GET /?${query} response body`);

      assert.equal(res.status, 400);
      assert.equal(body.code, "invalid_request");
      assert.equal(listAccountDecisionsFn.mock.calls.length, 0);
    });
  });
}

test("GET / rejects a malformed accountId with 400 and does not call the service", async () => {
  const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountDecisionsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?accountId=not-a-uuid`);
    const body = await readJson(
      res,
      "GET /?accountId=not-a-uuid response body",
    );

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(listAccountDecisionsFn.mock.calls.length, 0);
  });
});

test("GET / rejects an unknown query parameter with 400 and does not call the service", async () => {
  const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountDecisionsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?limit=10&sort=asc`);
    const body = await readJson(res, "GET /?limit=10&sort=asc response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(listAccountDecisionsFn.mock.calls.length, 0);
  });
});

test("GET / maps an unexpected service error to a safe 500 response, without leaking internal details", async () => {
  const listAccountDecisionsFn = mock.fn<ListAccountDecisionsFn>(async () => {
    throw new Error(
      "relation account_decisions violates constraint xyz at connection pg://internal",
    );
  });
  const app = buildTestApp({ listAccountDecisionsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    const body = await readJson(res, "GET / 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
    assert.equal(listAccountDecisionsFn.mock.calls.length, 1);
  });
});

// ---------------------------------------------------------------------
// GET /:decisionId
// ---------------------------------------------------------------------

test("GET /:decisionId returns 200 with the exact persisted decision and accountId, and calls the service exactly once", async () => {
  const row = { decision: syntheticDecision(), accountId: VALID_ACCOUNT_ID };
  const getAccountDecisionByIdFn = mock.fn<GetAccountDecisionByIdFn>(
    async () => row,
  );
  const app = buildTestApp({ getAccountDecisionByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_DECISION_ID}`);
    const body = await readJson(res, "GET /:decisionId 200 response body");

    assert.equal(res.status, 200);
    assert.deepEqual(body, JSON.parse(JSON.stringify(row)));
    assert.equal(getAccountDecisionByIdFn.mock.calls.length, 1);
    assert.equal(
      getAccountDecisionByIdFn.mock.calls[0]?.arguments[0],
      VALID_DECISION_ID,
    );
  });
});

test("GET /:decisionId returns 404 decision_not_found when no decision exists with that ID, and calls the service exactly once", async () => {
  const getAccountDecisionByIdFn = mock.fn<GetAccountDecisionByIdFn>(
    async () => undefined,
  );
  const app = buildTestApp({ getAccountDecisionByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_DECISION_ID}`);
    const body = await readJson(res, "GET /:decisionId 404 response body");

    assert.equal(res.status, 404);
    assert.equal(body.code, "decision_not_found");
    assert.equal(getAccountDecisionByIdFn.mock.calls.length, 1);
  });
});

test("GET /:decisionId rejects a non-UUID decisionId with 400 and does not call the service", async () => {
  const getAccountDecisionByIdFn = mock.fn<GetAccountDecisionByIdFn>(
    async () => undefined,
  );
  const app = buildTestApp({ getAccountDecisionByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-a-uuid`);
    const body = await readJson(res, "GET /not-a-uuid response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(getAccountDecisionByIdFn.mock.calls.length, 0);
  });
});

test("GET /:decisionId maps an unexpected service error to a safe 500 response, without leaking internal details, and still calls the service exactly once", async () => {
  const getAccountDecisionByIdFn = mock.fn<GetAccountDecisionByIdFn>(
    async () => {
      throw new Error("connection terminated unexpectedly at pg://internal");
    },
  );
  const app = buildTestApp({ getAccountDecisionByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_DECISION_ID}`);
    const body = await readJson(res, "GET /:decisionId 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
    assert.equal(getAccountDecisionByIdFn.mock.calls.length, 1);
  });
});
