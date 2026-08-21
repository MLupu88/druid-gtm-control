// LS5 — unit tests for ./overview-charts-presentation.ts's pure
// formatting helper. Run with:
// tsx --test src/lib/overview-charts-presentation.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { formatChartDayLabel } from "./overview-charts-presentation.js";

test("formatChartDayLabel formats a canonical UTC date as a compact month/day label", () => {
  assert.equal(formatChartDayLabel("2026-08-15"), "Aug 15");
});

test("formatChartDayLabel never shifts the date due to local timezone", () => {
  assert.equal(formatChartDayLabel("2026-01-01"), "Jan 1");
  assert.equal(formatChartDayLabel("2026-12-31"), "Dec 31");
});

test("formatChartDayLabel falls back to the raw string for an unparseable input", () => {
  assert.equal(formatChartDayLabel("not-a-date"), "not-a-date");
});
