import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const COMPONENT_SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "needs-attention-view.tsx"),
  "utf8",
);
const PAGE_SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../pages/accounts.tsx"),
  "utf8",
);
const ACCOUNT_DETAIL_SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../pages/account-detail.tsx"),
  "utf8",
);
const DECISION_CONTROLS_SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "decision-controls.tsx"),
  "utf8",
);

function functionBlock(source: string, name: string, nextName?: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > -1, `function ${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start) : source.length;
  assert.ok(end > start, `function ${name} must have a valid end`);
  return source.slice(start, end);
}

test("Live Needs Attention uses only the canonical filtered accounts query", () => {
  assert.ok(COMPONENT_SOURCE.includes("needsAttention: true"));
  assert.ok(COMPONENT_SOURCE.includes("fetchAccounts(queryArgs)"));
  assert.ok(!COMPONENT_SOURCE.includes("/api/sheets/queue"));
  assert.ok(!COMPONENT_SOURCE.includes("latestDecision.routingOutput"));
});

test("the consumed transformation and canonical summary fields drive the live rows", () => {
  assert.ok(COMPONENT_SOURCE.includes("filterCanonicalNeedsAttentionItems(items, search)"));
  for (const field of ["openCount", "oldestOpenAttentionAt", "reasonCodes"]) {
    assert.ok(COMPONENT_SOURCE.includes(field), `missing attention summary field ${field}`);
  }
});

test("returning from canonical account actions forces fresh attention membership", () => {
  assert.ok(COMPONENT_SOURCE.includes('refetchOnMount: "always"'));
});

test("Dismiss is exposed only through canonical account detail entered from Needs Attention", () => {
  const liveRow = functionBlock(
    COMPONENT_SOURCE,
    "CanonicalAttentionRow",
    "SampleNeedsAttentionView",
  );
  assert.ok(liveRow.includes("?from=attention"));
  assert.ok(ACCOUNT_DETAIL_SOURCE.includes('searchParams.get("from") === "attention"'));
  assert.ok(ACCOUNT_DETAIL_SOURCE.includes("showDismiss={showDismiss}"));
  assert.ok(DECISION_CONTROLS_SOURCE.includes("showDismiss = false"));
  assert.ok(DECISION_CONTROLS_SOURCE.includes('submit("dismissed")'));
  assert.ok(DECISION_CONTROLS_SOURCE.includes("Dismiss account"));
  assert.ok(!DECISION_CONTROLS_SOURCE.includes("resolve attention"));
});

test("Sample Mode preserves the former preview presentation without live queue invalidations", () => {
  const sampleBlock = functionBlock(COMPONENT_SOURCE, "SampleNeedsAttentionView", "FilterChip");
  for (const marker of [
    "SAMPLE_ROWS",
    "previewOnly",
    "Start with the recommendation on the left",
    "Recommendation",
    "MQL / Ready for Sales",
    "Showing accounts that are ready for sales action now.",
  ]) {
    assert.ok(COMPONENT_SOURCE.includes(marker), `missing restored Sample marker: ${marker}`);
  }
  assert.ok(sampleBlock.includes("canonicalAccountId={null}"));
  assert.ok(!sampleBlock.includes("invalidateQueries"));
  assert.ok(!COMPONENT_SOURCE.includes("QUEUE_QUERY_KEY"));
  assert.ok(!COMPONENT_SOURCE.includes("ACTION_LOG_QUERY_KEY"));
});

test("Sheet-derived recommendation filters remain Sample-only", () => {
  const liveBlock = functionBlock(
    COMPONENT_SOURCE,
    "CanonicalNeedsAttentionView",
    "CanonicalAttentionRow",
  );
  const sampleBlock = functionBlock(COMPONENT_SOURCE, "SampleNeedsAttentionView", "FilterChip");
  assert.ok(!liveBlock.includes("FilterChip"));
  assert.ok(!liveBlock.includes("rowOutputType"));
  assert.ok(sampleBlock.includes("rowOutputType"));
  assert.ok(sampleBlock.includes("rowNeedsReview"));
});

test("Accounts page describes the canonical open-attention model", () => {
  assert.ok(PAGE_SOURCE.includes("Canonical accounts with one or more open attention items."));
  assert.ok(!PAGE_SOURCE.includes("Signals that still need a human decision"));
});
