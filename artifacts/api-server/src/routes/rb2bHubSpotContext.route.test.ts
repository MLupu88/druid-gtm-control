// Route-level tests for POST /internal/rb2b/hubspot-context. No database
// of any kind — real or fake — is ever constructed here: createRb2bHubSpotContextRouter
// accepts a dependency shape with no `db` field once refreshHubSpotContextFn
// is supplied directly. Runs a real ephemeral HTTP server, mirroring
// ./rb2bSignalBridge.route.test.ts and ./hubSpotCompanySync.route.test.ts.
//
// This file covers the service-auth route contract only (request
// validation, response shape, error mapping) — the underlying HubSpot
// lookup/sync/conflict decision logic is covered by
// ../services/hubSpotContextRefresh.test.ts. Auth itself
// (requireServiceAuth) is exercised where it is mounted
// (../routes/index.ts), not re-tested per-router — same convention
// ./rb2bSignalBridge.route.test.ts already follows for its own route.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import {
  AccountNotFoundError,
  type RefreshHubSpotContextResult,
} from "../services/hubSpotContextRefresh.js";
import {
  createRb2bHubSpotContextRouter,
  type RefreshHubSpotContextFn,
} from "./rb2bHubSpotContext.js";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function syntheticResult(
  overrides: Partial<RefreshHubSpotContextResult["hubspot"]> = {},
): RefreshHubSpotContextResult {
  return {
    accountId: ACCOUNT_ID,
    hubspot: {
      lookupStatus: "matched",
      companyId: "hs-1",
      syncStatus: "synced",
      conflict: null,
      ...overrides,
    },
  };
}

function buildTestApp(refreshHubSpotContextFn: RefreshHubSpotContextFn): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {}, error() {} } as never;
    next();
  });
  app.use(
    "/internal/rb2b/hubspot-context",
    createRb2bHubSpotContextRouter({ refreshHubSpotContextFn }),
  );
  return app;
}

async function withServer(app: Express, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function postContext(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/internal/rb2b/hubspot-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const unusedRefreshFn: RefreshHubSpotContextFn = async () => {
  throw new Error("refresh must not run");
};

test("accepts a valid request and returns the structured result verbatim", async () => {
  const refreshFn = mock.fn<RefreshHubSpotContextFn>(async ({ accountId }) => {
    assert.equal(accountId, ACCOUNT_ID);
    return syntheticResult();
  });
  await withServer(buildTestApp(refreshFn), async (baseUrl) => {
    const response = await postContext(baseUrl, {
      accountId: ACCOUNT_ID,
      companyDomain: "acme.com",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), syntheticResult());
  });
  assert.equal(refreshFn.mock.calls.length, 1);
});

test("companyDomain is optional and never reaches the refresh function", async () => {
  const refreshFn = mock.fn<RefreshHubSpotContextFn>(async (args) => {
    assert.deepEqual(args, { accountId: ACCOUNT_ID });
    return syntheticResult();
  });
  await withServer(buildTestApp(refreshFn), async (baseUrl) => {
    const response = await postContext(baseUrl, { accountId: ACCOUNT_ID });
    assert.equal(response.status, 200);
  });
});

test("rejects missing, non-uuid, and extra request fields before running the refresh", async () => {
  await withServer(buildTestApp(unusedRefreshFn), async (baseUrl) => {
    for (const body of [
      {},
      { accountId: "not-a-uuid" },
      { accountId: ACCOUNT_ID, extra: true },
    ]) {
      const response = await postContext(baseUrl, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await readJson(response), {
        error: "The request body is invalid.",
        code: "invalid_request",
      });
    }
  });
});

test("an unknown account maps to a 404, not a 500", async () => {
  const refreshFn: RefreshHubSpotContextFn = async () => {
    throw new AccountNotFoundError();
  };
  await withServer(buildTestApp(refreshFn), async (baseUrl) => {
    const response = await postContext(baseUrl, { accountId: ACCOUNT_ID });
    assert.equal(response.status, 404);
    assert.equal((await readJson(response)).code, "account_not_found");
  });
});

test("an unexpected internal error is sanitized to a generic 500", async () => {
  const refreshFn: RefreshHubSpotContextFn = async () => {
    throw new Error("secret internal detail");
  };
  await withServer(buildTestApp(refreshFn), async (baseUrl) => {
    const response = await postContext(baseUrl, { accountId: ACCOUNT_ID });
    const body = await readJson(response);
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(body).includes("secret internal detail"), false);
  });
});

test("returns not_found/ambiguous/failed lookup states and a canonical conflict verbatim", async () => {
  const cases: RefreshHubSpotContextResult[] = [
    syntheticResult({ lookupStatus: "not_found", companyId: null, syncStatus: "skipped" }),
    syntheticResult({ lookupStatus: "ambiguous", companyId: null, syncStatus: "skipped" }),
    syntheticResult({ lookupStatus: "failed", companyId: null, syncStatus: "skipped" }),
    syntheticResult({
      syncStatus: "skipped",
      conflict: {
        code: "canonical_account_mismatch",
        rb2bAccountId: ACCOUNT_ID,
        hubspotAccountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    }),
  ];
  const refreshFn: RefreshHubSpotContextFn = async () => cases[0]!;
  await withServer(buildTestApp(refreshFn), async (baseUrl) => {
    for (const expected of [...cases]) {
      const response = await postContext(baseUrl, { accountId: ACCOUNT_ID });
      assert.equal(response.status, 200);
      assert.deepEqual(await readJson(response), expected);
      cases.shift();
    }
  });
});
