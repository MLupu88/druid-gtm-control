// LS5 correction — unit tests for ./overviewTimeframe.ts's pure helpers:
// the single canonical "last N UTC calendar days" window shared by
// ./overviewMetrics.ts's signalsCaptured KPI and ./overviewCharts.ts's
// two charts. No database, no network.
//
// Run with: tsx --test src/services/overviewTimeframe.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { dailyBucketsFor, overviewWindowFor } from "./overviewTimeframe.js";

test("dailyBucketsFor(7, now) returns exactly 7 UTC calendar dates, oldest first, ending with today", () => {
  const now = new Date("2026-08-21T10:00:00Z");
  const dates = dailyBucketsFor(7, now);
  assert.deepEqual(dates, [
    "2026-08-15",
    "2026-08-16",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
  ]);
});

test("dailyBucketsFor uses the UTC calendar date, not the local/server timezone date", () => {
  // 23:30 UTC is still the same UTC calendar day — a naive local-time
  // implementation in a timezone west of UTC could wrongly roll this
  // back to the previous date.
  const now = new Date("2026-08-21T23:30:00Z");
  const dates = dailyBucketsFor(1, now);
  assert.deepEqual(dates, ["2026-08-21"]);
});

test("dailyBucketsFor is deterministic for the same inputs", () => {
  const now = new Date("2026-08-21T10:00:00Z");
  assert.deepEqual(dailyBucketsFor(7, now), dailyBucketsFor(7, now));
});

test("dailyBucketsFor(1, now) returns exactly today's single UTC date", () => {
  const now = new Date("2026-08-21T00:00:01Z");
  assert.deepEqual(dailyBucketsFor(1, now), ["2026-08-21"]);
});

test("dailyBucketsFor correctly crosses a UTC month boundary", () => {
  const now = new Date("2026-09-02T10:00:00Z");
  assert.deepEqual(dailyBucketsFor(4, now), ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
});

test("overviewWindowFor(7, now) starts at the UTC day-start of the oldest of the last 7 calendar days, and ends exactly at now", () => {
  const now = new Date("2026-08-21T10:00:00Z");
  const { from, to } = overviewWindowFor(7, now);
  assert.equal(from.toISOString(), "2026-08-15T00:00:00.000Z");
  assert.equal(to.toISOString(), now.toISOString());
});

test("overviewWindowFor is a calendar-day-aligned window, NOT an exact rolling 24h*days window", () => {
  // A rolling 7*24h window from 2026-08-21T10:00:00Z would start at
  // 2026-08-14T10:00:00Z. The canonical calendar-aligned window instead
  // starts at the UTC day-start of 2026-08-15 — a full day later than
  // the old rolling definition, by design (see module comment: this is
  // exactly the LS3-vs-LS5 drift that was corrected).
  const now = new Date("2026-08-21T10:00:00Z");
  const { from } = overviewWindowFor(7, now);
  assert.notEqual(from.toISOString(), "2026-08-14T10:00:00.000Z");
  assert.equal(from.toISOString(), "2026-08-15T00:00:00.000Z");
});

test("overviewWindowFor is deterministic for the same inputs", () => {
  const now = new Date("2026-08-21T10:00:00Z");
  const first = overviewWindowFor(7, now);
  const second = overviewWindowFor(7, now);
  assert.equal(first.from.getTime(), second.from.getTime());
  assert.equal(first.to.getTime(), second.to.getTime());
});

test("overviewWindowFor's 'to' boundary is always exactly 'now', so today's bucket is honestly partial, not a bug", () => {
  const now = new Date("2026-08-21T10:00:00Z");
  const { to } = overviewWindowFor(7, now);
  assert.equal(to.getTime(), now.getTime());
});

test("a larger days value produces an earlier (or equal) from boundary", () => {
  const now = new Date("2026-08-21T10:00:00Z");
  const sevenDay = overviewWindowFor(7, now);
  const thirtyDay = overviewWindowFor(30, now);
  assert.ok(thirtyDay.from.getTime() < sevenDay.from.getTime());
});

test("days=1 collapses the window to just today's UTC day-start through now", () => {
  const now = new Date("2026-08-21T10:00:00Z");
  const { from, to } = overviewWindowFor(1, now);
  assert.equal(from.toISOString(), "2026-08-21T00:00:00.000Z");
  assert.equal(to.getTime(), now.getTime());
});
