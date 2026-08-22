// LS7 — source-inspection tests for reports.tsx. This is a first-class,
// live surface (campaign setup/reporting/exports) — LS7 makes only a
// single, additive, low-risk change here (one DefinitionHint on the
// Attribution section title). These tests exist to prove that change
// landed correctly AND that every existing live behavior/endpoint this
// page depends on is still present, unmodified.
//
// Run with: tsx --test src/pages/reports.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "reports.tsx"),
  "utf8",
);

test("LS7 — the Attribution section title carries a campaign_attribution DefinitionHint from the central registry", () => {
  assert.ok(SOURCE.includes('from "@/components/definition-hint"'));
  assert.ok(SOURCE.includes('<DefinitionHint term="campaign_attribution"'));
  assert.ok(SOURCE.includes("Attribution and data limitations"));
});

test("existing live campaign-report and action-log endpoints are untouched by LS7", () => {
  assert.ok(SOURCE.includes('fetch(`/api/sheets/campaign-report'));
  assert.ok(SOURCE.includes('fetch("/api/sheets/action-log"'));
});

test("CSV/export behavior is untouched by LS7", () => {
  assert.ok(SOURCE.includes("function downloadCsv"));
  assert.ok(SOURCE.includes("function buildOperationalCsvRows"));
});

test("no sample/demo mode was reintroduced", () => {
  for (const marker of ["SAMPLE_ROWS", "MOCK_ACCOUNT_QUEUE", "useSampleMode", "ViewModeToggle"]) {
    assert.ok(!SOURCE.includes(marker), `stale/reintroduced sample-mode marker present: ${marker}`);
  }
});
