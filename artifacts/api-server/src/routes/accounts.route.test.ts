// Route-level tests for /api/internal/accounts. No database of any kind —
// real or fake — is ever constructed here: createAccountsRouter accepts a
// dependency shape with no `db` field at all once both listAccountsFn and
// getAccountByIdFn are supplied directly (see AccountsRouterDeps in
// ./accounts.ts), so these tests inject fully-typed fakes instead of
// casting a stand-in object to the database type. Runs a real ephemeral
// HTTP server (app.listen(0)) and issues real fetch() requests, mirroring
// ./accountEvaluations.route.test.ts.
//
// Run with: tsx --test src/routes/accounts.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { Account, AccountEvaluation } from "@workspace/db/schema";
import type { AccountDetail, AccountListItem } from "../services/accounts.js";
import {
  createAccountsRouter,
  type GetAccountByIdFn,
  type ListAccountsFn,
} from "./accounts.js";

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function syntheticAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: VALID_ACCOUNT_ID,
    accountKey: "dom:example.test",
    companyDomain: "example.test",
    companyName: "Example Co",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function syntheticEvaluation(
  overrides: Partial<AccountEvaluation> = {},
): AccountEvaluation {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    accountId: VALID_ACCOUNT_ID,
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

function syntheticListItem(
  overrides: Partial<AccountListItem> = {},
): AccountListItem {
  return {
    account: syntheticAccount(),
    latestEvaluation: null,
    latestProductionEvaluation: null,
    latestDecision: null,
    ...overrides,
  };
}

function syntheticDetail(
  overrides: Partial<AccountDetail> = {},
): AccountDetail {
  return {
    account: syntheticAccount(),
    evaluations: [syntheticEvaluation()],
    ...overrides,
  };
}

// Runtime narrowing for a real, un-typed fetch() response body — no cast.
// A JSON response is always an object here (never an array, string,
// number, etc.), so this also rules out those shapes explicitly rather
// than accepting "any object-ish value".
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

// Called by whichever route a given test is NOT exercising — throwing
// turns any unexpected cross-route invocation into a loud test failure
// instead of a silently wrong response.
const unusedListAccountsFn: ListAccountsFn = async () => {
  throw new Error("listAccountsFn should not have been called");
};
const unusedGetAccountByIdFn: GetAccountByIdFn = async () => {
  throw new Error("getAccountByIdFn should not have been called");
};

function buildTestApp(deps: {
  listAccountsFn?: ListAccountsFn;
  getAccountByIdFn?: GetAccountByIdFn;
}): Express {
  const app = express();
  app.use(
    "/",
    createAccountsRouter({
      listAccountsFn: deps.listAccountsFn ?? unusedListAccountsFn,
      getAccountByIdFn: deps.getAccountByIdFn ?? unusedGetAccountByIdFn,
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

// ---------------------------------------------------------------------
// GET / — pagination
// ---------------------------------------------------------------------

test("GET / with no query parameters uses the default pagination (limit 50, offset 0) and calls the service exactly once", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    const body = await readJson(res, "GET / with no query parameters");

    assert.equal(res.status, 200);
    assert.deepEqual(body.pagination, { limit: 50, offset: 0, total: 0 });
    assert.equal(listAccountsFn.mock.calls.length, 1);
    assert.deepEqual(listAccountsFn.mock.calls[0]?.arguments[0], {
      limit: 50,
      offset: 0,
    });
  });
});

test("GET / with an explicit valid limit and offset calls the service exactly once with the parsed values", async () => {
  const items = [syntheticListItem()];
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items,
    total: 7,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?limit=10&offset=20`);
    const body = await readJson(res, "GET /?limit=10&offset=20");

    assert.equal(res.status, 200);
    assert.deepEqual(body.items, JSON.parse(JSON.stringify(items)));
    assert.deepEqual(body.pagination, { limit: 10, offset: 20, total: 7 });
    assert.equal(listAccountsFn.mock.calls.length, 1);
    assert.deepEqual(listAccountsFn.mock.calls[0]?.arguments[0], {
      limit: 10,
      offset: 20,
    });
  });
});

const invalidLimitCases: Array<[string, string]> = [
  ["fractional", "limit=1.5"],
  ["negative", "limit=-1"],
  ["zero", "limit=0"],
  ["above the maximum", "limit=101"],
  ["non-numeric", "limit=abc"],
];

for (const [label, query] of invalidLimitCases) {
  test(`GET / rejects a ${label} limit with 400 and does not call the service`, async () => {
    const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
      items: [],
      total: 0,
    }));
    const app = buildTestApp({ listAccountsFn });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?${query}`);
      const body = await readJson(res, `GET /?${query} response body`);

      assert.equal(res.status, 400);
      assert.equal(body.code, "invalid_request");
      assert.equal(listAccountsFn.mock.calls.length, 0);
    });
  });
}

const invalidOffsetCases: Array<[string, string]> = [
  ["fractional", "offset=1.5"],
  ["negative", "offset=-1"],
  ["non-numeric", "offset=abc"],
];

for (const [label, query] of invalidOffsetCases) {
  test(`GET / rejects a ${label} offset with 400 and does not call the service`, async () => {
    const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
      items: [],
      total: 0,
    }));
    const app = buildTestApp({ listAccountsFn });

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?${query}`);
      const body = await readJson(res, `GET /?${query} response body`);

      assert.equal(res.status, 400);
      assert.equal(body.code, "invalid_request");
      assert.equal(listAccountsFn.mock.calls.length, 0);
    });
  });
}

test("GET / rejects an unknown query parameter with 400 and does not call the service", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?limit=10&sort=asc`);
    const body = await readJson(res, "GET /?limit=10&sort=asc response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(listAccountsFn.mock.calls.length, 0);
  });
});

test("GET / maps an unexpected service error to a safe 500 response, without leaking internal details", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => {
    throw new Error(
      "relation accounts violates constraint xyz at connection pg://internal",
    );
  });
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    const body = await readJson(res, "GET / 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
    assert.ok(!String(body.error).includes("constraint"));
  });
});

// ---------------------------------------------------------------------
// GET /:accountId
// ---------------------------------------------------------------------

test("GET /:accountId returns 200 with the account detail and calls the service exactly once with the accountId", async () => {
  const detail = syntheticDetail();
  const getAccountByIdFn = mock.fn<GetAccountByIdFn>(async () => detail);
  const app = buildTestApp({ getAccountByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}`);
    const body = await readJson(res, "GET /:accountId 200 response body");

    assert.equal(res.status, 200);
    assert.deepEqual(body, JSON.parse(JSON.stringify(detail)));
    assert.equal(getAccountByIdFn.mock.calls.length, 1);
    assert.equal(
      getAccountByIdFn.mock.calls[0]?.arguments[0],
      VALID_ACCOUNT_ID,
    );
  });
});

test("GET /:accountId rejects a non-UUID accountId with 400 and does not call the service", async () => {
  const getAccountByIdFn = mock.fn<GetAccountByIdFn>(async () =>
    syntheticDetail(),
  );
  const app = buildTestApp({ getAccountByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-a-uuid`);
    const body = await readJson(res, "GET /not-a-uuid response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(getAccountByIdFn.mock.calls.length, 0);
  });
});

test("GET /:accountId returns 404 account_not_found when no account exists with that ID, and calls the service exactly once", async () => {
  const getAccountByIdFn = mock.fn<GetAccountByIdFn>(async () => undefined);
  const app = buildTestApp({ getAccountByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}`);
    const body = await readJson(res, "GET /:accountId 404 response body");

    assert.equal(res.status, 404);
    assert.equal(body.code, "account_not_found");
    assert.equal(getAccountByIdFn.mock.calls.length, 1);
  });
});

test("GET /:accountId maps an unexpected service error to a safe 500 response, without leaking internal details, and still calls the service exactly once", async () => {
  const getAccountByIdFn = mock.fn<GetAccountByIdFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp({ getAccountByIdFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}`);
    const body = await readJson(res, "GET /:accountId 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
    assert.equal(getAccountByIdFn.mock.calls.length, 1);
  });
});
