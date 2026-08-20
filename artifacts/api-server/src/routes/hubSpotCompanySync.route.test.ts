import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  HubSpotApiError,
  HubSpotCompanyArchivedError,
  HubSpotCompanyDomainUnavailableError,
  HubSpotNotConfiguredError,
  HubSpotResponseError,
} from "../lib/hubSpotClient.js";
import {
  createHubSpotCompanySyncRouter,
  type SyncHubSpotCompanyFn,
} from "./hubSpotCompanySync.js";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function buildTestApp(syncHubSpotCompanyFn: SyncHubSpotCompanyFn): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {}, error() {} } as never;
    // requireAuth itself is real. This test-only input supplies the same
    // already-verified signed-cookie value cookie-parser would expose after
    // validating a production druid_auth cookie.
    req.signedCookies =
      req.header("x-test-authenticated") === "true" ? { druid_auth: "1" } : {};
    next();
  });
  app.use(
    "/internal/hubspot/company-sync",
    requireAuth,
    createHubSpotCompanySyncRouter({ syncHubSpotCompanyFn }),
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
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function postSync(
  baseUrl: string,
  body: unknown,
  authenticated = true,
): Promise<Response> {
  return fetch(`${baseUrl}/internal/hubspot/company-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { "x-test-authenticated": "true" } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const unusedSyncFn: SyncHubSpotCompanyFn = async () => {
  throw new Error("sync must not run");
};

test("the manual trigger is rejected without the existing signed operator auth boundary", async () => {
  await withServer(buildTestApp(unusedSyncFn), async (baseUrl) => {
    const response = await postSync(baseUrl, { companyId: "12345" }, false);
    assert.equal(response.status, 401);
    assert.deepEqual(await readJson(response), { error: "Authentication required." });
  });
});

test("accepts exactly one trimmed companyId and returns the created canonical account id", async () => {
  const syncFn = mock.fn<SyncHubSpotCompanyFn>(async ({ companyId }) => {
    assert.equal(companyId, "12345");
    return {
      outcome: "created",
      accountId: ACCOUNT_ID,
      source: "hubspot",
      attachedAliasTypes: ["domain", "external_id:hubspot"],
      observations: [],
    };
  });
  await withServer(buildTestApp(syncFn), async (baseUrl) => {
    const response = await postSync(baseUrl, { companyId: " 12345 " });
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson(response), {
      status: "created",
      source: "hubspot",
      accountId: ACCOUNT_ID,
      attachedAliasTypes: ["domain", "external_id:hubspot"],
      observations: [],
    });
  });
  assert.equal(syncFn.mock.calls.length, 1);
});

test("returns the canonical account id for a matched company", async () => {
  const syncFn: SyncHubSpotCompanyFn = async () => ({
    outcome: "matched",
    accountId: ACCOUNT_ID,
    source: "hubspot",
    attachedAliasTypes: [],
    observations: [],
  });
  await withServer(buildTestApp(syncFn), async (baseUrl) => {
    const response = await postSync(baseUrl, { companyId: "12345" });
    assert.equal(response.status, 200);
    assert.equal((await readJson(response)).accountId, ACCOUNT_ID);
  });
});

test("rejects missing, blank, non-string, and extra request fields before sync", async () => {
  await withServer(buildTestApp(unusedSyncFn), async (baseUrl) => {
    for (const body of [
      {},
      { companyId: " " },
      { companyId: ["12345"] },
      { companyId: "12345", extra: true },
    ]) {
      const response = await postSync(baseUrl, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await readJson(response), {
        error: "The request body is invalid.",
        code: "invalid_request",
      });
    }
  });
});

test("returns an explicit canonical conflict without choosing an account", async () => {
  const syncFn: SyncHubSpotCompanyFn = async () => ({
    outcome: "conflict",
    code: "account_identifier_conflict",
    source: "hubspot",
    candidateMatches: [
      { entityType: "account", identifierType: "domain", matchedId: ACCOUNT_ID },
      {
        entityType: "account",
        identifierType: "external_id",
        source: "hubspot",
        matchedId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    ],
    observations: [],
  });
  await withServer(buildTestApp(syncFn), async (baseUrl) => {
    const response = await postSync(baseUrl, { companyId: "12345" });
    const body = await readJson(response);
    assert.equal(response.status, 409);
    assert.equal(body.code, "account_identifier_conflict");
    assert.equal("accountId" in body, false);
    assert.ok(Array.isArray(body.candidateMatches));
  });
});

test("maps archived and missing-domain companies to explicit non-mutating errors", async () => {
  const errors = [
    new HubSpotCompanyArchivedError(),
    new HubSpotCompanyDomainUnavailableError(),
  ];
  const syncFn: SyncHubSpotCompanyFn = async () => {
    throw errors.shift()!;
  };
  await withServer(buildTestApp(syncFn), async (baseUrl) => {
    const archived = await postSync(baseUrl, { companyId: "12345" });
    assert.equal(archived.status, 422);
    assert.equal((await readJson(archived)).code, "hubspot_company_archived");

    const domainless = await postSync(baseUrl, { companyId: "12346" });
    assert.equal(domainless.status, 422);
    assert.equal(
      (await readJson(domainless)).code,
      "hubspot_company_domain_unavailable",
    );
  });
});

test("maps configuration, not-found, provider, invalid-response, and unexpected failures safely", async () => {
  const cases: Array<{
    error: Error;
    status: number;
    code: string;
  }> = [
    { error: new HubSpotNotConfiguredError(), status: 503, code: "hubspot_not_configured" },
    { error: new HubSpotApiError(404), status: 404, code: "hubspot_company_not_found" },
    { error: new HubSpotApiError(429), status: 502, code: "hubspot_request_failed" },
    { error: new HubSpotResponseError(), status: 502, code: "hubspot_response_invalid" },
    { error: new Error("secret provider detail"), status: 500, code: "internal_error" },
  ];
  const syncFn: SyncHubSpotCompanyFn = async () => {
    throw cases[0]!.error;
  };
  await withServer(buildTestApp(syncFn), async (baseUrl) => {
    for (const expected of [...cases]) {
      const response = await postSync(baseUrl, { companyId: "12345" });
      const body = await readJson(response);
      assert.equal(response.status, expected.status);
      assert.equal(body.code, expected.code);
      assert.equal(JSON.stringify(body).includes("secret provider detail"), false);
      cases.shift();
    }
  });
});
