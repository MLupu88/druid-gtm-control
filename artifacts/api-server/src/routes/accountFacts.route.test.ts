// Route-level tests for /api/internal/accounts/:accountId/facts. No
// database of any kind — real or fake — is ever constructed here:
// createAccountFactsRouter accepts a dependency shape with no `db` field
// at all once both service functions are supplied directly (see
// AccountFactsRouterDeps in ./accountFacts.ts), so these tests inject
// fully-typed fakes instead of casting a stand-in object to the database
// type. Runs a real ephemeral HTTP server (app.listen(0)) and issues real
// fetch() requests, mirroring ./accountDecisions.route.test.ts.
//
// Run with: tsx --test src/routes/accountFacts.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { AccountFact } from "@workspace/db/schema";
import {
  CorrectionReasonRequiredError,
  CorrectionReasonNotAllowedError,
  InvalidAccountFactValueError,
  StaleFactCorrectionError,
} from "../services/accountFacts.js";
import { AccountNotFoundError } from "../services/icpEvaluationResolvers.js";
import type { Operator } from "../lib/operators.js";
import {
  createAccountFactsRouter,
  type RecordAccountFactFn,
  type ListAccountFactsFn,
} from "./accountFacts.js";

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_FACT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function syntheticFact(overrides: Partial<AccountFact> = {}): AccountFact {
  return {
    id: VALID_FACT_ID,
    accountId: VALID_ACCOUNT_ID,
    field: "company.industry",
    value: "Banking",
    source: "manual-operator-v1",
    recordedBy: "operator@example.test",
    observedAt: new Date("2026-01-01T00:00:00Z"),
    recordedAt: new Date("2026-01-01T00:00:00Z"),
    correctionReason: null,
    supersedesFactId: null,
    ...overrides,
  } as AccountFact;
}

function assertIsRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${context} must be a JSON object`,
  );
}

async function readJson(
  res: Response,
  context: string,
): Promise<Record<string, unknown>> {
  const value: unknown = await res.json();
  assertIsRecord(value, context);
  return value;
}

const unusedRecordAccountFactFn: RecordAccountFactFn = async () => {
  throw new Error("recordAccountFactFn should not have been called");
};
const unusedListAccountFactsFn: ListAccountFactsFn = async () => {
  throw new Error("listAccountFactsFn should not have been called");
};

const DEFAULT_TEST_OPERATOR: Operator = {
  name: "Test Operator",
  email: "operator@example.test",
  role: "operator",
};

function buildTestApp(
  deps: {
    recordAccountFactFn?: RecordAccountFactFn;
    listAccountFactsFn?: ListAccountFactsFn;
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
    createAccountFactsRouter({
      recordAccountFactFn: deps.recordAccountFactFn ?? unusedRecordAccountFactFn,
      listAccountFactsFn: deps.listAccountFactsFn ?? unusedListAccountFactsFn,
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

function validPostBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    field: "company.industry",
    value: "Banking",
    ...overrides,
  };
}

async function postFact(
  baseUrl: string,
  accountId: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/accounts/${accountId}/facts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------
// POST — success paths
// ---------------------------------------------------------------------

test("POST with a valid first-time confirmation returns 201 with the persisted fact", async () => {
  const fact = syntheticFact();
  const recordAccountFactFn = mock.fn<RecordAccountFactFn>(async () => fact);
  const app = buildTestApp({ recordAccountFactFn });

  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, validPostBody());
    const body = await readJson(res, "POST 201 response body");

    assert.equal(res.status, 201);
    assert.equal(body.id, VALID_FACT_ID);
    assert.equal(body.value, "Banking");
    assert.equal(recordAccountFactFn.mock.calls.length, 1);
    const [args] = recordAccountFactFn.mock.calls[0]!.arguments;
    assert.equal(args.recordedBy, "operator@example.test");
    assert.equal(args.expectedCurrentFactId, null);
    assert.equal(args.correctionReason, null);
  });
});

test("POST recordedBy is always server-derived from req.operator, never accepted from the client", async () => {
  const fact = syntheticFact();
  const recordAccountFactFn = mock.fn<RecordAccountFactFn>(async () => fact);
  const app = buildTestApp({ recordAccountFactFn });

  await withServer(app, async (baseUrl) => {
    // recordedBy is not even in the schema — a strict() body with an
    // unrecognized field is rejected as invalid, never silently accepted.
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, {
      ...validPostBody(),
      recordedBy: "attacker@example.test",
    });
    assert.equal(res.status, 400);
  });
});

test("POST rejects a blank operator identity with 403 operator_identity_required", async () => {
  const app = buildTestApp({}, { name: "x", email: "", role: "operator" });

  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, validPostBody());
    const body = await readJson(res, "POST 403 response body");
    assert.equal(res.status, 403);
    assert.equal(body.code, "operator_identity_required");
  });
});

test("POST rejects an invalid field with 400", async () => {
  const app = buildTestApp({});
  await withServer(app, async (baseUrl) => {
    const res = await postFact(
      baseUrl,
      VALID_ACCOUNT_ID,
      validPostBody({ field: "company.notARealField" }),
    );
    assert.equal(res.status, 400);
  });
});

test("POST rejects an invalid accountId path param with 400", async () => {
  const app = buildTestApp({});
  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, "not-a-uuid", validPostBody());
    assert.equal(res.status, 400);
  });
});

// ---------------------------------------------------------------------
// POST — error mapping
// ---------------------------------------------------------------------

test("POST maps AccountNotFoundError to 404", async () => {
  const recordAccountFactFn: RecordAccountFactFn = async () => {
    throw new AccountNotFoundError(VALID_ACCOUNT_ID);
  };
  const app = buildTestApp({ recordAccountFactFn });
  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, validPostBody());
    const body = await readJson(res, "POST 404 response body");
    assert.equal(res.status, 404);
    assert.equal(body.code, "account_not_found");
  });
});

test("POST maps CorrectionReasonRequiredError to 400", async () => {
  const recordAccountFactFn: RecordAccountFactFn = async () => {
    throw new CorrectionReasonRequiredError("company.industry");
  };
  const app = buildTestApp({ recordAccountFactFn });
  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, validPostBody());
    assert.equal(res.status, 400);
  });
});

test("POST maps CorrectionReasonNotAllowedError to 400", async () => {
  const recordAccountFactFn: RecordAccountFactFn = async () => {
    throw new CorrectionReasonNotAllowedError("company.industry");
  };
  const app = buildTestApp({ recordAccountFactFn });
  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, validPostBody());
    assert.equal(res.status, 400);
  });
});

test("POST maps InvalidAccountFactValueError to 400", async () => {
  const recordAccountFactFn: RecordAccountFactFn = async () => {
    throw new InvalidAccountFactValueError("company.region", "bad value");
  };
  const app = buildTestApp({ recordAccountFactFn });
  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, validPostBody());
    assert.equal(res.status, 400);
  });
});

test("POST maps StaleFactCorrectionError to 409", async () => {
  const recordAccountFactFn: RecordAccountFactFn = async () => {
    throw new StaleFactCorrectionError(VALID_ACCOUNT_ID, "company.industry");
  };
  const app = buildTestApp({ recordAccountFactFn });
  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, validPostBody());
    const body = await readJson(res, "POST 409 response body");
    assert.equal(res.status, 409);
    assert.equal(body.code, "stale_fact_correction");
  });
});

test("POST maps an unexpected error to 500", async () => {
  const recordAccountFactFn: RecordAccountFactFn = async () => {
    throw new Error("boom");
  };
  const app = buildTestApp({ recordAccountFactFn });
  await withServer(app, async (baseUrl) => {
    const res = await postFact(baseUrl, VALID_ACCOUNT_ID, validPostBody());
    assert.equal(res.status, 500);
  });
});

// ---------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------

test("GET returns current and history facts", async () => {
  const current = syntheticFact();
  const listAccountFactsFn = mock.fn<ListAccountFactsFn>(async () => ({
    current: [current],
    history: [],
  }));
  const app = buildTestApp({ listAccountFactsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/accounts/${VALID_ACCOUNT_ID}/facts`);
    const body = await readJson(res, "GET 200 response body");
    assert.equal(res.status, 200);
    assert.equal((body.current as unknown[]).length, 1);
    assert.equal((body.history as unknown[]).length, 0);
  });
});

test("GET maps AccountNotFoundError to 404", async () => {
  const listAccountFactsFn: ListAccountFactsFn = async () => {
    throw new AccountNotFoundError(VALID_ACCOUNT_ID);
  };
  const app = buildTestApp({ listAccountFactsFn });
  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/accounts/${VALID_ACCOUNT_ID}/facts`);
    assert.equal(res.status, 404);
  });
});
