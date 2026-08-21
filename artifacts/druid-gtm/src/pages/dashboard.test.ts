// LS3 — Live Shell Closure: Overview no longer depends on the legacy
// Google Sheets queue for its metrics or its Needs Attention preview.
// Mirrors ../components/needs-attention-view.test.ts's and
// ../components/app-shell.test.ts's source-inspection convention — no
// React rendering harness exists in this package, so structural markers
// in the page's own source are what these tests assert on.
//
// Run with: tsx --test src/pages/dashboard.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "dashboard.tsx"),
  "utf8",
);

test("Overview no longer reads the legacy Sheets queue for metrics or Needs Attention", () => {
  // Checks the actual fetch call, not bare mentions of the URL — this
  // file's own comments legitimately reference the retired endpoint by
  // name for historical context.
  assert.ok(!SOURCE.includes('fetch("/api/sheets/queue"'));
  for (const marker of [
    "QUEUE_QUERY_KEY",
    "AccountDetailSheet",
    "QueueRowCard",
    "rowOutputType",
    "rowNeedsReview",
    "OUTPUT_TYPE_LABELS",
    "Signals to review",
  ]) {
    assert.ok(!SOURCE.includes(marker), `stale legacy-queue marker still present: ${marker}`);
  }
});

test("Overview no longer reads the legacy Sheets config — the 'What is live right now?' panel is retired, not replaced", () => {
  assert.ok(!SOURCE.includes('fetch("/api/sheets/config"'));
  for (const marker of [
    "What is live right now?",
    "StatusCard",
    "ENGINE_MODE_LABELS",
    "QUEUE_SOURCE_LABELS",
    "configQ",
    "ConfigResponse",
  ]) {
    assert.ok(!SOURCE.includes(marker), `stale legacy-config marker still present: ${marker}`);
  }
  // usingSampleData legitimately remains as a field on ActionLogResponse
  // (Recent Activity's still-Sheets-backed shape, scheduled for LS4) — the
  // config-badge usage (configQ.data?.usingSampleData) is what's retired.
  assert.ok(!SOURCE.includes("configQ.data?.usingSampleData"));
});

test("Overview's metric strip is backed by the canonical Overview metrics endpoint", () => {
  assert.ok(SOURCE.includes("fetchOverviewMetrics"));
  assert.ok(SOURCE.includes("OverviewMetricsStrip"));
});

test("Overview's Needs Attention preview reuses the exact canonical accounts contract Accounts?view=attention uses", () => {
  assert.ok(SOURCE.includes("fetchAccounts"));
  assert.ok(SOURCE.includes("needsAttention: true"));
  assert.ok(SOURCE.includes('/accounts/${item.account.id}?from=attention'));
  // Never rebuilt/re-derived client-side.
  assert.ok(!SOURCE.includes("filterCanonicalNeedsAttentionItems"));
});

test("Recent Activity intentionally still reads the legacy action log — scheduled for LS4, not LS3", () => {
  assert.ok(SOURCE.includes('"/api/sheets/action-log"'));
  assert.ok(SOURCE.includes("ACTION_LOG_QUERY_KEY"));
});

test("Needs Attention preview has honest loading, error, and empty states — no sample fallback", () => {
  assert.ok(SOURCE.includes("needsAttentionQ.isLoading"));
  assert.ok(SOURCE.includes("needsAttentionQ.isError"));
  assert.ok(SOURCE.includes("No accounts need attention right now."));
  assert.ok(!SOURCE.includes("MOCK_ACCOUNT_QUEUE"));
  assert.ok(!SOURCE.includes("SAMPLE_ROWS"));
});
