// LS5 — source-inspection tests for ./overview-metrics-strip.tsx.
// Mirrors ../pages/dashboard.test.ts's convention — no React rendering
// harness exists in this package.
//
// Covers two corrections layered on the same file:
// 1. (LS5 timeframe correction) the chip's wording is explicit about the
//    canonical timeframe (UTC calendar days, matching
//    ../lib/overview-charts-api.ts's charts, not an ambiguous "last N
//    days" that could be misread as an exact rolling window).
// 2. (LS5 terminology correction) the chip reads "Observations
//    captured", not "Signals captured" — a raw canonical observation-row
//    count is not the same thing as a count of distinct external
//    events. The underlying API field name (metrics.signalsCaptured)
//    is deliberately left unchanged — user-facing copy only.
//
// Run with: tsx --test src/components/overview-metrics-strip.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "overview-metrics-strip.tsx"),
  "utf8",
);

test("the Observations captured label is explicit that the window is calendar days, not an ambiguous 'last N days'", () => {
  assert.ok(SOURCE.includes("calendar days"));
  assert.ok(SOURCE.includes("Observations captured"));
});

test("the retired 'Signals captured' label is no longer rendered", () => {
  // Checks the actual label= attribute usage, not bare mentions — this
  // file's own explanatory comments legitimately reference the retired
  // label by name for historical/traceability context.
  assert.ok(!SOURCE.includes("label={`Signals captured"));
});

test("the underlying API field (metrics.signalsCaptured) is untouched by the terminology correction — no API churn", () => {
  assert.ok(SOURCE.includes("metrics.signalsCaptured"));
});

test("LS7 — Observations captured and Accounts needing attention carry a DefinitionHint; Total accounts does not need one", () => {
  assert.ok(SOURCE.includes('hint="observations_captured"'));
  assert.ok(SOURCE.includes('hint="accounts_needing_attention"'));
});

test("LS8 — the stat grid stacks to one column below the sm breakpoint instead of cramming 3 columns on mobile", () => {
  assert.ok(SOURCE.includes("grid-cols-1"));
  assert.ok(SOURCE.includes("sm:grid-cols-3"));
});

