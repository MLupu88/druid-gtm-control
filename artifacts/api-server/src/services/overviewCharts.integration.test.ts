// LS5 — integration tests for ./overviewCharts.ts against a real,
// migrated Postgres instance: real observations, real day-bucketing,
// real provider grouping.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// This file's DB is shared across every test in this run (and, in a
// real local/test Postgres, across other test files too — notably
// ./overviewMetrics.integration.test.ts, which inserts its own
// provider="rb2b" observations against overlapping windows). Every test
// below therefore asserts a BEFORE/AFTER DELTA on its own uniquely
// tagged fixtures, exactly like ./overviewMetrics.integration.test.ts's
// own convention — never an absolute day count or absolute provider
// count.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/overviewCharts.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getOverviewCharts } from "./overviewCharts.js";
import { getOverviewMetrics } from "./overviewMetrics.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function addObservation(args: { provider: string; importedAt: Date }): Promise<string> {
  const [row] = await db!
    .insert(schema.observations)
    .values({
      provider: args.provider,
      sourceRecordId: crypto.randomUUID(),
      observationClass: "behavioral_signal",
      semanticKey: "page_view",
      identitySubjectType: null,
      identityValue: null,
      rawValue: { page_visited: "/pricing" },
      normalizedValue: null,
      observedAt: null,
      importedAt: args.importedAt,
      confidence: null,
      evidenceRefs: [],
      providerMetadata: null,
    })
    .returning();
  return row!.id;
}

const FIXED_NOW = new Date("2026-08-21T12:00:00Z");
function uniqueProvider(label: string): string {
  return `test-${label}-${crypto.randomUUID()}`;
}

test("getOverviewCharts returns exactly 7 UTC calendar dates, oldest to newest, with a valid non-negative count each", { skip }, async () => {
  const charts = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });

  assert.equal(charts.signalsOverTime.length, 7);
  assert.deepEqual(
    charts.signalsOverTime.map((p) => p.date),
    ["2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"],
  );
  for (const point of charts.signalsOverTime) {
    assert.equal(typeof point.count, "number");
    assert.ok(point.count >= 0);
  }
  assert.equal(charts.timeframe.days, 7);
});

test("signalsOverTime counts an observation on the correct UTC day bucket", { skip }, async () => {
  const provider = uniqueProvider("day-bucket");
  const before = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });

  // 2026-08-18T09:15:00Z falls inside the 2026-08-18 UTC bucket.
  await addObservation({ provider, importedAt: new Date("2026-08-18T09:15:00Z") });

  const after = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  const beforeCount = before.signalsOverTime.find((p) => p.date === "2026-08-18")!.count;
  const afterCount = after.signalsOverTime.find((p) => p.date === "2026-08-18")!.count;
  assert.equal(afterCount, beforeCount + 1);

  // No other bucket changed because of this one insert.
  for (const point of after.signalsOverTime) {
    if (point.date === "2026-08-18") continue;
    const beforePoint = before.signalsOverTime.find((p) => p.date === point.date)!;
    assert.equal(point.count, beforePoint.count);
  }
});

test("signalsOverTime excludes an observation imported outside the 7-day window", { skip }, async () => {
  const provider = uniqueProvider("outside-window");
  const before = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });

  // 10 days before FIXED_NOW — strictly before the oldest bucket (2026-08-15).
  await addObservation({ provider, importedAt: new Date(FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000) });

  const after = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  assert.deepEqual(after.signalsOverTime, before.signalsOverTime);
  assert.equal(after.signalsByProvider.some((s) => s.provider === provider), false);
});

test("signalsOverTime boundary: an observation imported exactly at the oldest bucket's UTC day-start is counted", { skip }, async () => {
  const provider = uniqueProvider("lower-boundary");
  const before = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });

  await addObservation({ provider, importedAt: new Date("2026-08-15T00:00:00.000Z") });

  const after = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  const beforeCount = before.signalsOverTime.find((p) => p.date === "2026-08-15")!.count;
  const afterCount = after.signalsOverTime.find((p) => p.date === "2026-08-15")!.count;
  assert.equal(afterCount, beforeCount + 1);
});

test("signalsOverTime boundary: an observation imported exactly at 'now' (the upper bound) is counted in today's bucket", { skip }, async () => {
  const provider = uniqueProvider("upper-boundary");
  const before = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });

  await addObservation({ provider, importedAt: FIXED_NOW });

  const after = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  const beforeCount = before.signalsOverTime.find((p) => p.date === "2026-08-21")!.count;
  const afterCount = after.signalsOverTime.find((p) => p.date === "2026-08-21")!.count;
  assert.equal(afterCount, beforeCount + 1);
});

test("signalsOverTime is ordered deterministically oldest to newest across repeated calls", { skip }, async () => {
  const first = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  const second = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  assert.deepEqual(
    first.signalsOverTime.map((p) => p.date),
    second.signalsOverTime.map((p) => p.date),
  );
  const dates = first.signalsOverTime.map((p) => p.date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted);
});

test("signalsByProvider groups exact provider values and counts each observation exactly once", { skip }, async () => {
  const providerA = uniqueProvider("group-a");
  const providerB = uniqueProvider("group-b");

  await addObservation({ provider: providerA, importedAt: FIXED_NOW });
  await addObservation({ provider: providerA, importedAt: FIXED_NOW });
  await addObservation({ provider: providerB, importedAt: FIXED_NOW });

  const charts = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  const sliceA = charts.signalsByProvider.find((s) => s.provider === providerA);
  const sliceB = charts.signalsByProvider.find((s) => s.provider === providerB);

  assert.equal(sliceA?.count, 2);
  assert.equal(sliceB?.count, 1);
});

test("signalsByProvider never mixes two distinct providers into one slice", { skip }, async () => {
  const providerA = uniqueProvider("no-mix-a");
  const providerB = uniqueProvider("no-mix-b");

  await addObservation({ provider: providerA, importedAt: FIXED_NOW });
  await addObservation({ provider: providerB, importedAt: FIXED_NOW });

  const charts = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  const slices = charts.signalsByProvider.filter((s) => s.provider === providerA || s.provider === providerB);

  assert.equal(slices.length, 2);
  assert.equal(slices.find((s) => s.provider === providerA)?.count, 1);
  assert.equal(slices.find((s) => s.provider === providerB)?.count, 1);
});

test("signalsByProvider honestly omits a provider with zero observations in the window — never a fabricated zero slice", { skip }, async () => {
  const neverUsedProvider = uniqueProvider("never-used");
  const charts = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  assert.equal(charts.signalsByProvider.some((s) => s.provider === neverUsedProvider), false);
});

test("signalsByProvider excludes an observation imported outside the window from that provider's count", { skip }, async () => {
  const provider = uniqueProvider("provider-outside-window");
  await addObservation({
    provider,
    importedAt: new Date(FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000),
  });

  const charts = await getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 });
  assert.equal(charts.signalsByProvider.some((s) => s.provider === provider), false);
});

// ---------------------------------------------------------------------
// LS5 correction — proves the metrics KPI and the charts can no longer
// silently disagree: both now derive from the exact same
// ./overviewTimeframe.ts window, so signalsCaptured (a single COUNT(*)
// over that window) must always equal the sum of signalsOverTime's 7
// daily bucket counts (also over that identical window) for the same
// `now`.
// ---------------------------------------------------------------------

test("signalsCaptured equals the sum of signalsOverTime's daily counts for the exact same window", { skip }, async () => {
  const provider = uniqueProvider("reconciliation");
  const before = await Promise.all([
    getOverviewMetrics({ db: db!, now: FIXED_NOW, days: 7 }),
    getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 }),
  ]);
  const beforeChartsSum = before[1].signalsOverTime.reduce((sum, p) => sum + p.count, 0);
  assert.equal(before[0].signalsCaptured, beforeChartsSum);

  // Three observations inside the window, one strictly outside it —
  // both reads must move together by exactly the in-window count (3).
  await addObservation({ provider, importedAt: FIXED_NOW });
  await addObservation({ provider, importedAt: new Date("2026-08-18T09:15:00Z") });
  await addObservation({ provider, importedAt: new Date("2026-08-15T00:00:00.000Z") });
  await addObservation({ provider, importedAt: new Date(FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000) });

  const [metricsAfter, chartsAfter] = await Promise.all([
    getOverviewMetrics({ db: db!, now: FIXED_NOW, days: 7 }),
    getOverviewCharts({ db: db!, now: FIXED_NOW, days: 7 }),
  ]);
  const afterChartsSum = chartsAfter.signalsOverTime.reduce((sum, p) => sum + p.count, 0);

  assert.equal(metricsAfter.signalsCaptured, before[0].signalsCaptured + 3);
  assert.equal(afterChartsSum, beforeChartsSum + 3);
  assert.equal(metricsAfter.signalsCaptured, afterChartsSum);
  assert.deepEqual(metricsAfter.timeframe, chartsAfter.timeframe);
});

test.after(async () => {
  await pool?.end();
});
