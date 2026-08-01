// Route-level tests for the Client Radar research-run endpoints — focused
// specifically on the failureReason contract addition (see
// ../lib/clientRadarClient.ts's classifyClientRadarFailureReason): every
// endpoint that returns a researchRun must annotate it with a computed
// failureReason distinguishing "not configured" from a genuine runtime
// failure. No database of any kind is constructed — mirrors
// ./accounts.route.test.ts's fully-injected-fakes + real ephemeral HTTP
// server approach.
//
// Run with: tsx --test src/routes/clientRadarResearchRuns.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { ClientRadarResearchRun } from "@workspace/db/schema";
import {
  createClientRadarResearchRunsRouter,
  type StartClientRadarResearchFn,
  type GetLatestClientRadarResearchRunFn,
  type RefreshClientRadarResearchRunFn,
} from "./clientRadarResearchRuns.js";
import { ActiveResearchRunExistsError } from "../services/clientRadarResearchRuns.js";
import { CLIENT_RADAR_BASE_URL_NOT_CONFIGURED_MESSAGE } from "../lib/clientRadarClient.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function syntheticRun(overrides: Partial<ClientRadarResearchRun> = {}): ClientRadarResearchRun {
  return {
    id: RUN_ID,
    accountId: ACCOUNT_ID,
    clientRadarRunId: null,
    status: "submitting",
    submittedAt: null,
    lastPolledAt: null,
    completedAt: null,
    failedAt: null,
    lastError: null,
    accountPayload: null,
    evidencePayload: null,
    resultSchemaVersion: 1,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const value: unknown = await res.json();
  assert.ok(typeof value === "object" && value !== null);
  return value as Record<string, unknown>;
}

const unusedStart: StartClientRadarResearchFn = async () => {
  throw new Error("startClientRadarResearchFn should not have been called");
};
const unusedGet: GetLatestClientRadarResearchRunFn = async () => {
  throw new Error("getLatestClientRadarResearchRunFn should not have been called");
};
const unusedRefresh: RefreshClientRadarResearchRunFn = async () => {
  throw new Error("refreshClientRadarResearchRunFn should not have been called");
};

function buildTestApp(deps: {
  startClientRadarResearchFn?: StartClientRadarResearchFn;
  getLatestClientRadarResearchRunFn?: GetLatestClientRadarResearchRunFn;
  refreshClientRadarResearchRunFn?: RefreshClientRadarResearchRunFn;
}): Express {
  const app = express();
  app.use(
    "/",
    createClientRadarResearchRunsRouter({
      startClientRadarResearchFn: deps.startClientRadarResearchFn ?? unusedStart,
      getLatestClientRadarResearchRunFn: deps.getLatestClientRadarResearchRunFn ?? unusedGet,
      refreshClientRadarResearchRunFn: deps.refreshClientRadarResearchRunFn ?? unusedRefresh,
    }),
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
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

// ---------------------------------------------------------------------
// GET /accounts/:accountId/client-radar-research
// ---------------------------------------------------------------------

test("GET returns failureReason 'not_configured' for a failed run whose lastError is the known config-error message", async () => {
  const getLatestClientRadarResearchRunFn = mock.fn<GetLatestClientRadarResearchRunFn>(
    async () =>
      syntheticRun({
        status: "failed",
        failedAt: new Date("2026-08-01T01:00:00Z"),
        lastError: CLIENT_RADAR_BASE_URL_NOT_CONFIGURED_MESSAGE,
      }),
  );
  const app = buildTestApp({ getLatestClientRadarResearchRunFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/accounts/${ACCOUNT_ID}/client-radar-research`);
    const body = await readJson(res);
    assert.equal(res.status, 200);
    const run = body.researchRun as Record<string, unknown>;
    assert.equal(run.failureReason, "not_configured");
  });
});

test("GET returns failureReason 'runtime_failure' for a failed run with any other lastError", async () => {
  const getLatestClientRadarResearchRunFn = mock.fn<GetLatestClientRadarResearchRunFn>(
    async () =>
      syntheticRun({
        status: "failed",
        failedAt: new Date("2026-08-01T01:00:00Z"),
        lastError: "Client Radar returned HTTP 500.",
      }),
  );
  const app = buildTestApp({ getLatestClientRadarResearchRunFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/accounts/${ACCOUNT_ID}/client-radar-research`);
    const body = await readJson(res);
    const run = body.researchRun as Record<string, unknown>;
    assert.equal(run.failureReason, "runtime_failure");
  });
});

test("GET returns failureReason null for a non-failed run (e.g. completed)", async () => {
  const getLatestClientRadarResearchRunFn = mock.fn<GetLatestClientRadarResearchRunFn>(
    async () => syntheticRun({ status: "completed", completedAt: new Date("2026-08-01T01:00:00Z") }),
  );
  const app = buildTestApp({ getLatestClientRadarResearchRunFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/accounts/${ACCOUNT_ID}/client-radar-research`);
    const body = await readJson(res);
    const run = body.researchRun as Record<string, unknown>;
    assert.equal(run.failureReason, null);
  });
});

test("GET returns researchRun: null (not an object) when no run exists — failureReason is never fabricated for a missing row", async () => {
  const getLatestClientRadarResearchRunFn = mock.fn<GetLatestClientRadarResearchRunFn>(
    async () => undefined,
  );
  const app = buildTestApp({ getLatestClientRadarResearchRunFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/accounts/${ACCOUNT_ID}/client-radar-research`);
    const body = await readJson(res);
    assert.equal(body.researchRun, null);
  });
});

// ---------------------------------------------------------------------
// POST /accounts/:accountId/client-radar-research
// ---------------------------------------------------------------------

test("POST annotates a newly-created run with failureReason too", async () => {
  const startClientRadarResearchFn = mock.fn<StartClientRadarResearchFn>(async () =>
    syntheticRun({ status: "queued", submittedAt: new Date("2026-08-01T01:00:00Z") }),
  );
  const app = buildTestApp({ startClientRadarResearchFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/accounts/${ACCOUNT_ID}/client-radar-research`, {
      method: "POST",
    });
    const body = await readJson(res);
    assert.equal(res.status, 201);
    const run = body.researchRun as Record<string, unknown>;
    assert.equal(run.failureReason, null);
    assert.equal(run.status, "queued");
  });
});

test("POST's 409 active_research_run_exists response also annotates existingRun with failureReason", async () => {
  const existingRun = syntheticRun({ status: "running" });
  const startClientRadarResearchFn = mock.fn<StartClientRadarResearchFn>(async () => {
    throw new ActiveResearchRunExistsError(ACCOUNT_ID, existingRun);
  });
  const app = buildTestApp({ startClientRadarResearchFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/accounts/${ACCOUNT_ID}/client-radar-research`, {
      method: "POST",
    });
    const body = await readJson(res);
    assert.equal(res.status, 409);
    const run = body.existingRun as Record<string, unknown>;
    assert.equal(run.failureReason, null);
  });
});

// ---------------------------------------------------------------------
// POST /client-radar-research/:researchRunId/refresh
// ---------------------------------------------------------------------

test("refresh annotates the returned run with failureReason", async () => {
  const refreshClientRadarResearchRunFn = mock.fn<RefreshClientRadarResearchRunFn>(async () =>
    syntheticRun({
      status: "failed",
      failedAt: new Date("2026-08-01T01:00:00Z"),
      lastError: CLIENT_RADAR_BASE_URL_NOT_CONFIGURED_MESSAGE,
    }),
  );
  const app = buildTestApp({ refreshClientRadarResearchRunFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/client-radar-research/${RUN_ID}/refresh`, {
      method: "POST",
    });
    const body = await readJson(res);
    assert.equal(res.status, 200);
    const run = body.researchRun as Record<string, unknown>;
    assert.equal(run.failureReason, "not_configured");
  });
});
