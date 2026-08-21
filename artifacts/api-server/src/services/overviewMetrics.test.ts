// LS3/LS5 — unit tests for ./overviewMetrics.ts's re-exported timeframe
// helper. No database, no network. See
// ./overviewMetrics.integration.test.ts for the real aggregate-counting
// behavior, and ./overviewTimeframe.test.ts for full coverage of the
// underlying canonical window logic (dailyBucketsFor/overviewWindowFor)
// that timeframeFor below is now just an alias for.
//
// LS5 correction: timeframeFor used to define its own exact rolling
// 7*24h window here. It is now exactly
// ./overviewTimeframe.ts's overviewWindowFor (last N UTC calendar days,
// including today) — the single canonical Overview signal timeframe
// also used by ./overviewCharts.ts's two charts, so the KPI and the
// charts can never disagree about what "last 7 days" means. These tests
// were updated from asserting the old rolling-window numbers to
// asserting the new calendar-aligned ones.
//
// Run with: tsx --test src/services/overviewMetrics.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { timeframeFor } from "./overviewMetrics.js";
import { overviewWindowFor } from "./overviewTimeframe.js";

test("timeframeFor(7, now) starts at the UTC day-start of the oldest of the last 7 calendar days, not an exact rolling 7*24h window", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const { from, to } = timeframeFor(7, now);
  assert.equal(to.toISOString(), now.toISOString());
  // The old rolling-window definition would have produced
  // "2026-08-08T12:00:00.000Z" here; the canonical calendar-aligned
  // window instead starts at the UTC day-start of 2026-08-09.
  assert.equal(from.toISOString(), "2026-08-09T00:00:00.000Z");
});

test("timeframeFor is deterministic for the same inputs", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const first = timeframeFor(7, now);
  const second = timeframeFor(7, now);
  assert.equal(first.from.getTime(), second.from.getTime());
  assert.equal(first.to.getTime(), second.to.getTime());
});

test("a larger days value produces an earlier (or equal) from boundary", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const sevenDay = timeframeFor(7, now);
  const thirtyDay = timeframeFor(30, now);
  assert.ok(thirtyDay.from.getTime() < sevenDay.from.getTime());
});

test("timeframeFor is exactly overviewWindowFor — the metrics KPI and the LS5 charts can never independently drift", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  assert.equal(timeframeFor, overviewWindowFor);
  const fromMetrics = timeframeFor(7, now);
  const fromCharts = overviewWindowFor(7, now);
  assert.equal(fromMetrics.from.getTime(), fromCharts.from.getTime());
  assert.equal(fromMetrics.to.getTime(), fromCharts.to.getTime());
});
