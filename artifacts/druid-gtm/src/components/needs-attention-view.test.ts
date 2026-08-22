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
  const membershipBlock = functionBlock(
    COMPONENT_SOURCE,
    "CanonicalNeedsAttentionView",
    "CanonicalAttentionRow",
  );
  assert.ok(COMPONENT_SOURCE.includes("needsAttention: true"));
  assert.ok(COMPONENT_SOURCE.includes("fetchAccounts(queryArgs)"));
  assert.ok(!COMPONENT_SOURCE.includes("/api/sheets/queue"));
  assert.ok(!membershipBlock.includes("latestDecision"));
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
    "CanonicalAccountState",
  );
  assert.ok(liveRow.includes("?from=attention"));
  assert.ok(ACCOUNT_DETAIL_SOURCE.includes('searchParams.get("from") === "attention"'));
  assert.ok(ACCOUNT_DETAIL_SOURCE.includes("showDismiss={showDismiss}"));
  assert.ok(DECISION_CONTROLS_SOURCE.includes("showDismiss = false"));
  assert.ok(DECISION_CONTROLS_SOURCE.includes('submit("dismissed")'));
  assert.ok(DECISION_CONTROLS_SOURCE.includes("Dismiss account"));
  assert.ok(!DECISION_CONTROLS_SOURCE.includes("resolve attention"));
});

// LS1 — Live Shell Closure: sample/demo mode was removed from production.
// There is no SampleNeedsAttentionView, no view-mode toggle, and no
// Sheet-derived recommendation/filter logic anywhere in this component
// any more — Needs Attention is canonical-only, unconditionally.
test("no sample/demo mode remains — no toggle, no mock rows, no Sheet-derived recommendation filters", () => {
  for (const marker of [
    "SampleNeedsAttentionView",
    "SAMPLE_ROWS",
    "MOCK_ACCOUNT_QUEUE",
    "useSampleMode",
    "ViewModeToggle",
    "FilterChip",
    "rowOutputType",
    "rowNeedsReview",
    "View sample workflow",
  ]) {
    assert.ok(!COMPONENT_SOURCE.includes(marker), `stale sample-mode marker still present: ${marker}`);
  }
});

test("Accounts page describes the canonical open-attention model", () => {
  assert.ok(PAGE_SOURCE.includes("Triage canonical accounts with open attention items."));
  assert.ok(!PAGE_SOURCE.includes("Signals that still need a human decision"));
});

test("Accounts and Needs Attention use dense canonical account tables without research joins", () => {
  for (const marker of ["<Table", "Current evaluation", "Latest decision", "Updated"]) {
    assert.ok(PAGE_SOURCE.includes(marker), `missing All Accounts table marker: ${marker}`);
  }
  for (const marker of ["Why attention", "Current state", "Oldest open", "Inspect"]) {
    assert.ok(COMPONENT_SOURCE.includes(marker), `missing Needs Attention table marker: ${marker}`);
  }
  assert.ok(!PAGE_SOURCE.includes("fetchLatestClientRadarResearchRun"));
  assert.ok(!COMPONENT_SOURCE.includes("fetchLatestClientRadarResearchRun"));
});

test("LS7 — Accounts and Needs Attention column headers carry DefinitionHints from the central registry, never a second hardcoded tooltip", () => {
  assert.ok(PAGE_SOURCE.includes('from "@/components/definition-hint"'));
  assert.ok(PAGE_SOURCE.includes('<DefinitionHint term="icp_fit"'));
  assert.ok(PAGE_SOURCE.includes('<DefinitionHint term="accounts_needing_attention"'));

  assert.ok(COMPONENT_SOURCE.includes('from "@/components/definition-hint"'));
  assert.ok(COMPONENT_SOURCE.includes('<DefinitionHint term="accounts_needing_attention"'));
});
