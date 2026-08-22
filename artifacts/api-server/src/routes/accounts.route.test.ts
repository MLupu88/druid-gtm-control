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
import type { Account } from "@workspace/db/schema";
import type {
  AccountDetail,
  AccountEvaluationDetail,
  AccountListItem,
} from "../services/accounts.js";
import {
  AccountNotFoundError as AccountTruthNotFoundError,
  type AccountTruthFieldDTO,
} from "../services/accountTruth.js";
import {
  AccountNotFoundError as AccountActivityNotFoundError,
  type AccountActivityItemDTO,
} from "../services/accountActivity.js";
import {
  AccountNotFoundError as AccountPeopleNotFoundError,
  type AccountPersonDTO,
} from "../services/people.js";
import {
  AccountNotFoundError as AccountClaimsNotFoundError,
  type AccountClaimDTO,
} from "../services/accountClaims.js";
import {
  createAccountsRouter,
  type GetAccountActivityFn,
  type GetAccountByIdFn,
  type GetAccountClaimsFn,
  type GetAccountPeopleFn,
  type GetAccountTruthFn,
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
  overrides: Partial<AccountEvaluationDetail> = {},
): AccountEvaluationDetail {
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
    // This route test injects a fake getAccountByIdFn — it never runs the
    // real derivation in ../services/accounts.ts/mqlDecisionReadiness.ts,
    // so this is a plain fixture value, not a computed one.
    mqlDecisionReadiness: { ready: true, reasons: [] },
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
    attention: null,
    ...overrides,
  };
}

function syntheticDetail(
  overrides: Partial<AccountDetail> = {},
): AccountDetail {
  return {
    account: syntheticAccount(),
    evaluations: [syntheticEvaluation()],
    // GTM V2 Stage 4, Unit 1 — this route test injects a fake
    // getAccountByIdFn (never runs the real derivation in
    // ../services/accounts.ts), so this is a plain fixture default, not a
    // computed one, mirroring mqlDecisionReadiness above.
    latestProductionEvaluationStaleness: null,
    // M3.5 real-data defect fix — same fixture-default rationale as
    // latestProductionEvaluationStaleness above.
    identityAliasTypes: [],
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
const unusedGetAccountTruthFn: GetAccountTruthFn = async () => {
  throw new Error("getAccountTruthFn should not have been called");
};
const unusedGetAccountActivityFn: GetAccountActivityFn = async () => {
  throw new Error("getAccountActivityFn should not have been called");
};
const unusedGetAccountPeopleFn: GetAccountPeopleFn = async () => {
  throw new Error("getAccountPeopleFn should not have been called");
};
const unusedGetAccountClaimsFn: GetAccountClaimsFn = async () => {
  throw new Error("getAccountClaimsFn should not have been called");
};

function buildTestApp(deps: {
  listAccountsFn?: ListAccountsFn;
  getAccountByIdFn?: GetAccountByIdFn;
  getAccountTruthFn?: GetAccountTruthFn;
  getAccountActivityFn?: GetAccountActivityFn;
  getAccountPeopleFn?: GetAccountPeopleFn;
  getAccountClaimsFn?: GetAccountClaimsFn;
}): Express {
  const app = express();
  app.use(
    "/",
    createAccountsRouter({
      listAccountsFn: deps.listAccountsFn ?? unusedListAccountsFn,
      getAccountByIdFn: deps.getAccountByIdFn ?? unusedGetAccountByIdFn,
      getAccountTruthFn: deps.getAccountTruthFn ?? unusedGetAccountTruthFn,
      getAccountActivityFn: deps.getAccountActivityFn ?? unusedGetAccountActivityFn,
      getAccountPeopleFn: deps.getAccountPeopleFn ?? unusedGetAccountPeopleFn,
      getAccountClaimsFn: deps.getAccountClaimsFn ?? unusedGetAccountClaimsFn,
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

test("GET / with no query parameters uses the default pagination (limit 50, offset 0) and needsAttention defaults to false, calling the service exactly once", async () => {
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
      needsAttention: false,
      search: undefined,
      sort: "updated",
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
      needsAttention: false,
      search: undefined,
      sort: "updated",
    });
  });
});

// ---------------------------------------------------------------------
// GET / — needsAttention
// ---------------------------------------------------------------------

test("GET / with no needsAttention query parameter parses it as false", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?limit=10&offset=0`);
    assert.equal(res.status, 200);
    assert.equal(
      listAccountsFn.mock.calls[0]?.arguments[0].needsAttention,
      false,
    );
  });
});

test("GET / with needsAttention=false parses it as false", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?needsAttention=false`);
    assert.equal(res.status, 200);
    assert.equal(
      listAccountsFn.mock.calls[0]?.arguments[0].needsAttention,
      false,
    );
  });
});

test("GET / with needsAttention=true parses it as true and calls the service with it", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?needsAttention=true`);
    assert.equal(res.status, 200);
    assert.equal(listAccountsFn.mock.calls.length, 1);
    assert.deepEqual(listAccountsFn.mock.calls[0]?.arguments[0], {
      limit: 50,
      offset: 0,
      needsAttention: true,
      search: undefined,
      sort: "updated",
    });
  });
});

// ---------------------------------------------------------------------
// GET / — search / sort (LS8 — "Accounts is capped at 100" fix)
// ---------------------------------------------------------------------

test("GET / with no search/sort query parameters passes search: undefined and sort: 'updated' to the service", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.equal(listAccountsFn.mock.calls[0]?.arguments[0].search, undefined);
    assert.equal(listAccountsFn.mock.calls[0]?.arguments[0].sort, "updated");
  });
});

test("GET / trims and passes through a search query parameter", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?${new URLSearchParams({ search: "  RSM  " }).toString()}`);
    assert.equal(res.status, 200);
    assert.equal(listAccountsFn.mock.calls[0]?.arguments[0].search, "RSM");
  });
});

test("GET / treats a blank search query parameter as absent (empty string, not undefined)", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?search=`);
    assert.equal(res.status, 200);
    assert.equal(listAccountsFn.mock.calls[0]?.arguments[0].search, "");
  });
});

test("GET / rejects a search parameter over the max length with 400 and does not call the service", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(
      `${baseUrl}/?${new URLSearchParams({ search: "x".repeat(201) }).toString()}`,
    );
    assert.equal(res.status, 400);
    assert.equal(listAccountsFn.mock.calls.length, 0);
  });
});

test("GET / accepts sort=name and passes it through", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?sort=name`);
    assert.equal(res.status, 200);
    assert.equal(listAccountsFn.mock.calls[0]?.arguments[0].sort, "name");
  });
});

test("GET / rejects an unrecognized sort value with 400 and does not call the service", async () => {
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items: [],
    total: 0,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?sort=fitScore`);
    assert.equal(res.status, 400);
    assert.equal(listAccountsFn.mock.calls.length, 0);
  });
});

const invalidNeedsAttentionCases: Array<[string, string]> = [
  ["numeric 1", "needsAttention=1"],
  ["yes", "needsAttention=yes"],
  ["uppercase TRUE", "needsAttention=TRUE"],
  ["empty string", "needsAttention="],
];

for (const [label, query] of invalidNeedsAttentionCases) {
  test(`GET / rejects needsAttention=${label} with 400 and does not call the service`, async () => {
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

test("GET / serializes a populated attention summary verbatim", async () => {
  const oldestOpenAttentionAt = new Date("2026-01-01T00:00:00Z");
  const items = [
    syntheticListItem({
      attention: {
        openCount: 2,
        oldestOpenAttentionAt,
        reasonCodes: ["manual_review", "stale_evaluation"],
      },
    }),
  ];
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items,
    total: 1,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/?needsAttention=true`);
    const body = await readJson(res, "GET /?needsAttention=true response body");

    assert.equal(res.status, 200);
    assert.deepEqual(body.items, JSON.parse(JSON.stringify(items)));
    const [item] = body.items as Array<Record<string, unknown>>;
    assert.deepEqual(item?.attention, {
      openCount: 2,
      oldestOpenAttentionAt: oldestOpenAttentionAt.toISOString(),
      reasonCodes: ["manual_review", "stale_evaluation"],
    });
  });
});

test("GET / serializes attention: null verbatim", async () => {
  const items = [syntheticListItem({ attention: null })];
  const listAccountsFn = mock.fn<ListAccountsFn>(async () => ({
    items,
    total: 1,
  }));
  const app = buildTestApp({ listAccountsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    const body = await readJson(res, "GET / response body");

    assert.equal(res.status, 200);
    const [item] = body.items as Array<Record<string, unknown>>;
    assert.equal(item?.attention, null);
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

// ---------------------------------------------------------------------
// GET /:accountId/truth — Milestone 3H
// ---------------------------------------------------------------------

function syntheticTruthField(
  overrides: Partial<AccountTruthFieldDTO> = {},
): AccountTruthFieldDTO {
  return {
    canonicalField: "company.industry",
    canonicalValue: "Software",
    resolutionState: "single_source",
    policyVersion: "fact-reconciliation-policy-v1",
    rationale: "single hubspot observation available",
    computedAt: "2026-08-22T00:00:00.000Z",
    selectedEvidence: {
      kind: "observation",
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      provider: "hubspot",
      value: "Software",
      observedAt: null,
      importedAt: "2026-08-20T00:00:00.000Z",
      displayName: null,
    },
    supportingEvidence: [],
    conflictingEvidence: [],
    canonicalDisplayValue: null,
    ...overrides,
  };
}

test("GET /:accountId/truth returns the fields array from the service, calling it exactly once", async () => {
  const getAccountTruthFn = mock.fn<GetAccountTruthFn>(async () => [syntheticTruthField()]);
  const app = buildTestApp({ getAccountTruthFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/truth`);
    const body = await readJson(res, "GET /:accountId/truth response body");

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(body.fields), true);
    assert.equal((body.fields as unknown[]).length, 1);
    assert.equal(getAccountTruthFn.mock.calls.length, 1);
    assert.equal(getAccountTruthFn.mock.calls[0]?.arguments[0], VALID_ACCOUNT_ID);
  });
});

test("GET /:accountId/truth rejects a non-UUID accountId with 400, without calling the service", async () => {
  const getAccountTruthFn = mock.fn<GetAccountTruthFn>(async () => []);
  const app = buildTestApp({ getAccountTruthFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-a-uuid/truth`);
    const body = await readJson(res, "GET /:accountId/truth 400 response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(getAccountTruthFn.mock.calls.length, 0);
  });
});

test("GET /:accountId/truth maps AccountNotFoundError to a 404 account_not_found response", async () => {
  const getAccountTruthFn = mock.fn<GetAccountTruthFn>(async () => {
    throw new AccountTruthNotFoundError(VALID_ACCOUNT_ID);
  });
  const app = buildTestApp({ getAccountTruthFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/truth`);
    const body = await readJson(res, "GET /:accountId/truth 404 response body");

    assert.equal(res.status, 404);
    assert.equal(body.code, "account_not_found");
  });
});

test("GET /:accountId/truth maps an unexpected service error to a safe 500 response", async () => {
  const getAccountTruthFn = mock.fn<GetAccountTruthFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp({ getAccountTruthFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/truth`);
    const body = await readJson(res, "GET /:accountId/truth 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
  });
});

// ---------------------------------------------------------------------
// GET /:accountId/activity — M3.5
// ---------------------------------------------------------------------

function syntheticActivityItem(
  overrides: Partial<AccountActivityItemDTO> = {},
): AccountActivityItemDTO {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    provider: "rb2b",
    eventType: "page_view",
    occurredAt: "2026-08-22T00:00:00.000Z",
    importedAt: "2026-08-22T00:00:00.000Z",
    rawValue: { page_visited: "https://druidai.com/pricing" },
    ...overrides,
  };
}

test("GET /:accountId/activity returns the items array from the service, calling it exactly once", async () => {
  const getAccountActivityFn = mock.fn<GetAccountActivityFn>(async () => [syntheticActivityItem()]);
  const app = buildTestApp({ getAccountActivityFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/activity`);
    const body = await readJson(res, "GET /:accountId/activity response body");

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(body.items), true);
    assert.equal((body.items as unknown[]).length, 1);
    assert.equal(getAccountActivityFn.mock.calls.length, 1);
    assert.equal(getAccountActivityFn.mock.calls[0]?.arguments[0], VALID_ACCOUNT_ID);
  });
});

test("GET /:accountId/activity rejects a non-UUID accountId with 400, without calling the service", async () => {
  const getAccountActivityFn = mock.fn<GetAccountActivityFn>(async () => []);
  const app = buildTestApp({ getAccountActivityFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-a-uuid/activity`);
    const body = await readJson(res, "GET /:accountId/activity 400 response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(getAccountActivityFn.mock.calls.length, 0);
  });
});

test("GET /:accountId/activity maps AccountNotFoundError to a 404 account_not_found response", async () => {
  const getAccountActivityFn = mock.fn<GetAccountActivityFn>(async () => {
    throw new AccountActivityNotFoundError(VALID_ACCOUNT_ID);
  });
  const app = buildTestApp({ getAccountActivityFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/activity`);
    const body = await readJson(res, "GET /:accountId/activity 404 response body");

    assert.equal(res.status, 404);
    assert.equal(body.code, "account_not_found");
  });
});

test("GET /:accountId/activity maps an unexpected service error to a safe 500 response", async () => {
  const getAccountActivityFn = mock.fn<GetAccountActivityFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp({ getAccountActivityFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/activity`);
    const body = await readJson(res, "GET /:accountId/activity 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
  });
});

// ---------------------------------------------------------------------
// GET /:accountId/people — LS8
// ---------------------------------------------------------------------

function syntheticPerson(overrides: Partial<AccountPersonDTO> = {}): AccountPersonDTO {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    fullName: "Laura Berkey",
    workEmail: "laura.berkey@example.test",
    linkedinUrl: null,
    title: "Associate Software Engineer",
    source: "rb2b",
    firstSeenAt: "2026-08-21T20:33:27.397Z",
    lastSeenAt: "2026-08-21T20:33:27.397Z",
    ...overrides,
  };
}

test("GET /:accountId/people returns the items array from the service, calling it exactly once", async () => {
  const getAccountPeopleFn = mock.fn<GetAccountPeopleFn>(async () => [syntheticPerson()]);
  const app = buildTestApp({ getAccountPeopleFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/people`);
    const body = await readJson(res, "GET /:accountId/people response body");

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(body.items), true);
    assert.deepEqual(body.items, [syntheticPerson()]);
    assert.equal(getAccountPeopleFn.mock.calls.length, 1);
    assert.equal(getAccountPeopleFn.mock.calls[0]?.arguments[0], VALID_ACCOUNT_ID);
  });
});

test("GET /:accountId/people returns an empty array, never a fabricated placeholder, when no people are associated", async () => {
  const getAccountPeopleFn = mock.fn<GetAccountPeopleFn>(async () => []);
  const app = buildTestApp({ getAccountPeopleFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/people`);
    const body = await readJson(res, "GET /:accountId/people empty response body");

    assert.equal(res.status, 200);
    assert.deepEqual(body.items, []);
  });
});

test("GET /:accountId/people rejects a non-UUID accountId with 400, without calling the service", async () => {
  const getAccountPeopleFn = mock.fn<GetAccountPeopleFn>(async () => []);
  const app = buildTestApp({ getAccountPeopleFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-a-uuid/people`);
    const body = await readJson(res, "GET /:accountId/people 400 response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(getAccountPeopleFn.mock.calls.length, 0);
  });
});

test("GET /:accountId/people maps AccountNotFoundError to a 404 account_not_found response", async () => {
  const getAccountPeopleFn = mock.fn<GetAccountPeopleFn>(async () => {
    throw new AccountPeopleNotFoundError(VALID_ACCOUNT_ID);
  });
  const app = buildTestApp({ getAccountPeopleFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/people`);
    const body = await readJson(res, "GET /:accountId/people 404 response body");

    assert.equal(res.status, 404);
    assert.equal(body.code, "account_not_found");
  });
});

test("GET /:accountId/people maps an unexpected service error to a safe 500 response", async () => {
  const getAccountPeopleFn = mock.fn<GetAccountPeopleFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp({ getAccountPeopleFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/people`);
    const body = await readJson(res, "GET /:accountId/people 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
  });
});

// ---------------------------------------------------------------------
// GET /:accountId/claims — Milestone 4A
// ---------------------------------------------------------------------

function syntheticClaim(overrides: Partial<AccountClaimDTO> = {}): AccountClaimDTO {
  return {
    id: "bbbbbbbb-0000-4000-8000-000000000004",
    claimKey: "cx.vendor",
    status: "active",
    valueType: "string",
    value: "Genesys",
    origin: "research",
    confidence: "medium",
    isCurrent: true,
    supersedesClaimId: null,
    correctionReason: null,
    recordedBy: null,
    generatedByVersion: null,
    observedAt: null,
    createdAt: "2026-08-21T20:33:27.397Z",
    evidence: [],
    ...overrides,
  };
}

test("GET /:accountId/claims returns the items array from the service, calling it exactly once", async () => {
  const getAccountClaimsFn = mock.fn<GetAccountClaimsFn>(async () => [syntheticClaim()]);
  const app = buildTestApp({ getAccountClaimsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/claims`);
    const body = await readJson(res, "GET /:accountId/claims response body");

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(body.items), true);
    assert.deepEqual(body.items, [syntheticClaim()]);
    assert.equal(getAccountClaimsFn.mock.calls.length, 1);
    assert.equal(getAccountClaimsFn.mock.calls[0]?.arguments[0], VALID_ACCOUNT_ID);
  });
});

test("GET /:accountId/claims returns an empty array, never a fabricated placeholder, when no claims have been recorded", async () => {
  const getAccountClaimsFn = mock.fn<GetAccountClaimsFn>(async () => []);
  const app = buildTestApp({ getAccountClaimsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/claims`);
    const body = await readJson(res, "GET /:accountId/claims empty response body");

    assert.equal(res.status, 200);
    assert.deepEqual(body.items, []);
  });
});

test("GET /:accountId/claims rejects a non-UUID accountId with 400, without calling the service", async () => {
  const getAccountClaimsFn = mock.fn<GetAccountClaimsFn>(async () => []);
  const app = buildTestApp({ getAccountClaimsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-a-uuid/claims`);
    const body = await readJson(res, "GET /:accountId/claims 400 response body");

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(getAccountClaimsFn.mock.calls.length, 0);
  });
});

test("GET /:accountId/claims maps AccountNotFoundError to a 404 account_not_found response", async () => {
  const getAccountClaimsFn = mock.fn<GetAccountClaimsFn>(async () => {
    throw new AccountClaimsNotFoundError(VALID_ACCOUNT_ID);
  });
  const app = buildTestApp({ getAccountClaimsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/claims`);
    const body = await readJson(res, "GET /:accountId/claims 404 response body");

    assert.equal(res.status, 404);
    assert.equal(body.code, "account_not_found");
  });
});

test("GET /:accountId/claims maps an unexpected service error to a safe 500 response", async () => {
  const getAccountClaimsFn = mock.fn<GetAccountClaimsFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp({ getAccountClaimsFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_ACCOUNT_ID}/claims`);
    const body = await readJson(res, "GET /:accountId/claims 500 response body");

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("pg://internal"));
  });
});
