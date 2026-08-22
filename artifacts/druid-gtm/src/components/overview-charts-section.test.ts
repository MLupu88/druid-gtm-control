// LS5 — source-inspection tests for ./overview-charts-section.tsx.
// Mirrors ../pages/dashboard.test.ts's convention — no React rendering
// harness exists in this package.
//
// Run with: tsx --test src/components/overview-charts-section.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "overview-charts-section.tsx"),
  "utf8",
);

test("chart titles are the LS5-corrected 'Observations' labels — never the retired 'Signals' labels or interpretive language", () => {
  // Checks the actual title= attribute usage, not bare mentions — this
  // file's own explanatory comments legitimately reference the retired
  // "Signals over time"/"Signals by source" labels by name for
  // historical/traceability context.
  assert.ok(SOURCE.includes('title="Observations over time"'));
  assert.ok(SOURCE.includes('title="Observations by source"'));
  assert.ok(!SOURCE.includes('title="Signals over time"'));
  assert.ok(!SOURCE.includes('title="Signals by source"'));
  for (const forbidden of [
    "Engagement momentum",
    "Intent acceleration",
    "Buying surge",
    "Hot account",
    "Conversion velocity",
    "engagement",
    "momentum",
  ]) {
    assert.ok(!SOURCE.toLowerCase().includes(forbidden.toLowerCase()), `interpretive language present: ${forbidden}`);
  }
});

test("uses the existing recharts + ui/chart.tsx primitives — no new charting dependency, no pie/gauge/3D", () => {
  assert.ok(SOURCE.includes('from "recharts"'));
  assert.ok(SOURCE.includes('from "@/components/ui/chart"'));
  assert.ok(SOURCE.includes("BarChart"));
  // Checks actual usage (JSX element names), not this file's own
  // explanatory comments, which legitimately name what was deliberately
  // avoided.
  for (const forbidden of ["<PieChart", "<RadialBarChart", "<Gauge"]) {
    assert.ok(!SOURCE.includes(forbidden), `non-compact/decorative chart primitive present: ${forbidden}`);
  }
});

test("has honest loading, error, and empty states — no sample fallback", () => {
  assert.ok(SOURCE.includes("isLoading"));
  assert.ok(SOURCE.includes("isError"));
  assert.ok(SOURCE.includes("No observations recorded yet."));
  assert.ok(!SOURCE.includes("No signals recorded yet."));
  assert.ok(!SOURCE.includes("MOCK_"));
  assert.ok(!SOURCE.includes("SAMPLE_"));
});

test("provider composition reuses the shared providerDisplayName helper rather than a second label map", () => {
  assert.ok(SOURCE.includes("providerDisplayName"));
});

test("chart subtitle wording is explicit about calendar days — matches the Observations captured KPI's wording", () => {
  const calendarDaysMentions = SOURCE.split("calendar days").length - 1;
  assert.ok(calendarDaysMentions >= 2, "expected both chart subtitles to say 'calendar days'");
});

test("LS7 — both chart titles carry a DefinitionHint from the central registry", () => {
  assert.ok(SOURCE.includes('hint="observations_captured"'));
  assert.ok(SOURCE.includes('hint="observations_by_source"'));
  assert.ok(SOURCE.includes('from "@/components/definition-hint"'));
});

test("underlying API fields (signalsOverTime/signalsByProvider) are untouched by the terminology correction — no API churn", () => {
  assert.ok(SOURCE.includes("charts.signalsOverTime"));
  assert.ok(SOURCE.includes("charts.signalsByProvider"));
});
