// Route-level tests for GET /internal/overview/metrics. No database of
// any kind — real or fake — is ever constructed here:
// createOverviewRouter accepts a dependency shape with no `db` field
// once getOverviewMetricsFn is supplied directly. Runs a real ephemeral
// HTTP server, mirroring ./accounts.route.test.ts.
//
// Run with: tsx --test src/routes/overview.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import {
  createOverviewRouter,
  type GetOverviewMetricsFn,
} from "./overview.js";
import type { OverviewMetrics } from "../services/overviewMetrics.js";

function syntheticMetrics(overrides: Partial<OverviewMetrics> = {}): OverviewMetrics {
  return {
    timeframe: { days: 7, from: "2026-08-08T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" },
    signalsCaptured: 12,
    accountsNeedingAttention: 3,
    totalAccounts: 20,
    ...overrides,
  };
}

function buildTestApp(getOverviewMetricsFn: GetOverviewMetricsFn): Express {
  const app = express();
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {}, error() {} } as never;
    next();
  });
  app.use("/internal/overview", createOverviewRouter({ getOverviewMetricsFn }));
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

test("GET /internal/overview/metrics returns the service's metrics verbatim, calling it exactly once", async () => {
  const metrics = syntheticMetrics();
  const getOverviewMetricsFn = mock.fn<GetOverviewMetricsFn>(async () => metrics);
  const app = buildTestApp(getOverviewMetricsFn);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/metrics`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, metrics);
    assert.equal(getOverviewMetricsFn.mock.calls.length, 1);
  });
});

test("a zero-data result is returned as real zeros, not stripped or nulled", async () => {
  const metrics = syntheticMetrics({ signalsCaptured: 0, accountsNeedingAttention: 0, totalAccounts: 0 });
  const getOverviewMetricsFn = mock.fn<GetOverviewMetricsFn>(async () => metrics);
  const app = buildTestApp(getOverviewMetricsFn);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/metrics`);
    const body = (await res.json()) as OverviewMetrics;

    assert.equal(res.status, 200);
    assert.equal(body.signalsCaptured, 0);
    assert.equal(body.accountsNeedingAttention, 0);
    assert.equal(body.totalAccounts, 0);
  });
});

test("maps an unexpected service error to a safe 500 response, without leaking internal details", async () => {
  const getOverviewMetricsFn = mock.fn<GetOverviewMetricsFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp(getOverviewMetricsFn);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/metrics`);
    const body = (await res.json()) as { error: string; code: string };

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!body.error.includes("pg://internal"));
  });
});
