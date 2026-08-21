// LS3 — unit tests for ./overviewMetrics.ts's pure timeframe helper. No
// database, no network. See ./overviewMetrics.integration.test.ts for the
// real aggregate-counting behavior.
//
// Run with: tsx --test src/services/overviewMetrics.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { timeframeFor } from "./overviewMetrics.js";

test("timeframeFor(7, now) returns a window exactly 7 days wide, ending at now", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const { from, to } = timeframeFor(7, now);
  assert.equal(to.toISOString(), now.toISOString());
  assert.equal(from.toISOString(), "2026-08-08T12:00:00.000Z");
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

test("days=0 collapses the window to a single instant (from equals to)", () => {
  const now = new Date("2026-08-15T12:00:00Z");
  const { from, to } = timeframeFor(0, now);
  assert.equal(from.getTime(), to.getTime());
});
