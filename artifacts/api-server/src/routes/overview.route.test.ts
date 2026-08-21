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
  type GetGlobalActivityFn,
  type GetOverviewChartsFn,
  type GetOverviewSummaryFn,
} from "./overview.js";
import type { OverviewMetrics } from "../services/overviewMetrics.js";
import type { GlobalActivityItemDTO } from "../services/accountActivity.js";
import type { OverviewCharts } from "../services/overviewCharts.js";
import type { OverviewSummaryResult } from "../services/overviewSummary.js";
import { OverviewSummaryUnavailableError } from "../services/overviewSummary.js";

function syntheticMetrics(overrides: Partial<OverviewMetrics> = {}): OverviewMetrics {
  return {
    timeframe: { days: 7, from: "2026-08-08T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" },
    signalsCaptured: 12,
    accountsNeedingAttention: 3,
    totalAccounts: 20,
    ...overrides,
  };
}

function syntheticActivityItem(overrides: Partial<GlobalActivityItemDTO> = {}): GlobalActivityItemDTO {
  return {
    id: "obs-1",
    provider: "rb2b",
    eventType: "page_view",
    occurredAt: "2026-08-15T00:00:00.000Z",
    importedAt: "2026-08-15T00:00:00.000Z",
    rawValue: { page_visited: "/pricing" },
    accountId: "account-1",
    accountName: "Acme",
    companyDomain: "acme.com",
    ...overrides,
  };
}

function syntheticCharts(overrides: Partial<OverviewCharts> = {}): OverviewCharts {
  return {
    timeframe: { days: 7, from: "2026-08-08T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" },
    signalsOverTime: [
      { date: "2026-08-08", count: 2 },
      { date: "2026-08-09", count: 0 },
    ],
    signalsByProvider: [{ provider: "rb2b", count: 2 }],
    ...overrides,
  };
}

function syntheticSummary(overrides: Partial<OverviewSummaryResult> = {}): OverviewSummaryResult {
  return {
    timeframe: { days: 7, from: "2026-08-08T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" },
    summary: "12 observations were captured across the last 7 calendar days.",
    factsUsed: ["observationsCaptured"],
    generatedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function buildTestApp(
  getOverviewMetricsFn: GetOverviewMetricsFn,
  getGlobalActivityFn: GetGlobalActivityFn = async () => [],
  getOverviewChartsFn: GetOverviewChartsFn = async () => syntheticCharts(),
  getOverviewSummaryFn: GetOverviewSummaryFn = async () => syntheticSummary(),
): Express {
  const app = express();
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {}, error() {} } as never;
    next();
  });
  app.use(
    "/internal/overview",
    createOverviewRouter({
      getOverviewMetricsFn,
      getGlobalActivityFn,
      getOverviewChartsFn,
      getOverviewSummaryFn,
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

// ---------------------------------------------------------------------
// LS4 — GET /internal/overview/activity
// ---------------------------------------------------------------------

test("GET /internal/overview/activity returns the service's items verbatim, passing the default limit", async () => {
  const items = [syntheticActivityItem()];
  const getGlobalActivityFn = mock.fn<GetGlobalActivityFn>(async () => items);
  const app = buildTestApp(mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()), getGlobalActivityFn);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/activity`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { items });
    assert.equal(getGlobalActivityFn.mock.calls.length, 1);
    assert.equal(getGlobalActivityFn.mock.calls[0]?.arguments[0], 20);
  });
});

test("GET /internal/overview/activity?limit=5 passes the parsed numeric limit through", async () => {
  const getGlobalActivityFn = mock.fn<GetGlobalActivityFn>(async () => []);
  const app = buildTestApp(mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()), getGlobalActivityFn);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/activity?limit=5`);
    assert.equal(res.status, 200);
    assert.equal(getGlobalActivityFn.mock.calls[0]?.arguments[0], 5);
  });
});

test("GET /internal/overview/activity rejects an out-of-range limit with 400, never silently clamped", async () => {
  const getGlobalActivityFn = mock.fn<GetGlobalActivityFn>(async () => []);
  const app = buildTestApp(mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()), getGlobalActivityFn);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/activity?limit=0`);
    assert.equal(res.status, 400);
    assert.equal(getGlobalActivityFn.mock.calls.length, 0);
  });
});

test("GET /internal/overview/activity: a zero-data result is an empty list, not sample content", async () => {
  const getGlobalActivityFn = mock.fn<GetGlobalActivityFn>(async () => []);
  const app = buildTestApp(mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()), getGlobalActivityFn);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/activity`);
    const body = (await res.json()) as { items: unknown[] };
    assert.equal(res.status, 200);
    assert.deepEqual(body.items, []);
  });
});

test("GET /internal/overview/activity maps an unexpected service error to a safe 500 response", async () => {
  const getGlobalActivityFn = mock.fn<GetGlobalActivityFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp(mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()), getGlobalActivityFn);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/activity`);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!body.error.includes("pg://internal"));
  });
});

// ---------------------------------------------------------------------
// LS5 — GET /internal/overview/charts
// ---------------------------------------------------------------------

test("GET /internal/overview/charts returns the service's charts verbatim, calling it exactly once", async () => {
  const charts = syntheticCharts();
  const getOverviewChartsFn = mock.fn<GetOverviewChartsFn>(async () => charts);
  const app = buildTestApp(
    mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()),
    undefined,
    getOverviewChartsFn,
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/charts`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, charts);
    assert.equal(getOverviewChartsFn.mock.calls.length, 1);
  });
});

test("GET /internal/overview/charts: a zero-data result returns real zero-filled buckets and an empty provider list, not sample content", async () => {
  const charts = syntheticCharts({
    signalsOverTime: [
      { date: "2026-08-08", count: 0 },
      { date: "2026-08-09", count: 0 },
    ],
    signalsByProvider: [],
  });
  const getOverviewChartsFn = mock.fn<GetOverviewChartsFn>(async () => charts);
  const app = buildTestApp(
    mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()),
    undefined,
    getOverviewChartsFn,
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/charts`);
    const body = (await res.json()) as OverviewCharts;

    assert.equal(res.status, 200);
    assert.deepEqual(
      body.signalsOverTime.map((p) => p.count),
      [0, 0],
    );
    assert.deepEqual(body.signalsByProvider, []);
  });
});

test("GET /internal/overview/charts maps an unexpected service error to a safe 500 response, without leaking internal details", async () => {
  const getOverviewChartsFn = mock.fn<GetOverviewChartsFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp(
    mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()),
    undefined,
    getOverviewChartsFn,
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/charts`);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!body.error.includes("pg://internal"));
  });
});

// ---------------------------------------------------------------------
// LS6 — GET /internal/overview/summary
// ---------------------------------------------------------------------

test("GET /internal/overview/summary returns the service's summary verbatim, calling it exactly once", async () => {
  const summary = syntheticSummary();
  const getOverviewSummaryFn = mock.fn<GetOverviewSummaryFn>(async () => summary);
  const app = buildTestApp(
    mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()),
    undefined,
    undefined,
    getOverviewSummaryFn,
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/summary`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, summary);
    assert.equal(getOverviewSummaryFn.mock.calls.length, 1);
  });
});

test("GET /internal/overview/summary maps OverviewSummaryUnavailableError to a safe 503, not a hard failure", async () => {
  const getOverviewSummaryFn = mock.fn<GetOverviewSummaryFn>(async () => {
    throw new OverviewSummaryUnavailableError("DEEPSEEK_API_KEY is not configured.", "not_configured");
  });
  const app = buildTestApp(
    mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()),
    undefined,
    undefined,
    getOverviewSummaryFn,
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/summary`);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(res.status, 503);
    assert.equal(body.code, "ai_summary_unavailable");
  });
});

test("GET /internal/overview/summary maps every OverviewSummaryUnavailableError reason to the same safe 503 — the frontend never needs to distinguish why", async () => {
  const reasons = [
    "not_configured",
    "api_error",
    "invalid_json",
    "invalid_shape",
    "forbidden_language",
    "ungrounded",
  ] as const;

  for (const reason of reasons) {
    const getOverviewSummaryFn = mock.fn<GetOverviewSummaryFn>(async () => {
      throw new OverviewSummaryUnavailableError(`failed: ${reason}`, reason);
    });
    const app = buildTestApp(
      mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()),
      undefined,
      undefined,
      getOverviewSummaryFn,
    );

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/internal/overview/summary`);
      assert.equal(res.status, 503, `expected 503 for reason "${reason}"`);
    });
  }
});

test("GET /internal/overview/summary maps an unexpected (non-AI) service error to a safe 500 response, without leaking internal details", async () => {
  const getOverviewSummaryFn = mock.fn<GetOverviewSummaryFn>(async () => {
    throw new Error("connection terminated unexpectedly at pg://internal");
  });
  const app = buildTestApp(
    mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()),
    undefined,
    undefined,
    getOverviewSummaryFn,
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/summary`);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!body.error.includes("pg://internal"));
  });
});

test("GET /internal/overview/summary: the returned summary text never contains the word 'signal'", async () => {
  const summary = syntheticSummary({ summary: "42 observations were captured across the last 7 calendar days." });
  const getOverviewSummaryFn = mock.fn<GetOverviewSummaryFn>(async () => summary);
  const app = buildTestApp(
    mock.fn<GetOverviewMetricsFn>(async () => syntheticMetrics()),
    undefined,
    undefined,
    getOverviewSummaryFn,
  );

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/overview/summary`);
    const body = (await res.json()) as OverviewSummaryResult;
    assert.equal(res.status, 200);
    assert.ok(!body.summary.toLowerCase().includes("signal"));
  });
});
