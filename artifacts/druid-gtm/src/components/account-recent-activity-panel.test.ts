// LS8 — source-inspection tests for ./account-recent-activity-panel.tsx.
// Mirrors this package's established convention (e.g. ../pages/dashboard.test.ts)
// — no React rendering harness exists here.
//
// Run with: tsx --test src/components/account-recent-activity-panel.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "account-recent-activity-panel.tsx"),
  "utf8",
);

test("person/visit fields are extracted and rendered outside TechnicalDetails, not trapped only inside collapsed raw event data", () => {
  assert.ok(SOURCE.includes('from "@/lib/account-activity-presentation"'));
  assert.ok(SOURCE.includes("extractRb2bActivityFields"));

  const techDetailsIndex = SOURCE.indexOf("<TechnicalDetails");
  const rb2bSummaryIndex = SOURCE.indexOf("showRb2bSummary");
  assert.ok(techDetailsIndex > -1, "TechnicalDetails must still exist (raw evidence is never removed)");
  assert.ok(rb2bSummaryIndex > -1, "structured RB2B field summary must exist");
  assert.ok(
    rb2bSummaryIndex < techDetailsIndex,
    "the structured summary must render ABOVE the collapsed raw event data, not only inside it",
  );
});

test("raw event data is preserved verbatim — never removed", () => {
  assert.ok(SOURCE.includes('summary="Raw event data"'));
  assert.ok(SOURCE.includes("JSON.stringify(item.rawValue, null, 2)"));
});

test("RB2B field extraction is provider-scoped — never applied to a non-rb2b row's rawValue", () => {
  assert.ok(SOURCE.includes('item.provider === "rb2b" ? extractRb2bActivityFields(item.rawValue) : null'));
});

test("person name, title, and page visited are all rendered when present", () => {
  assert.ok(SOURCE.includes("rb2bFields.personName"));
  assert.ok(SOURCE.includes("rb2bFields.title"));
  assert.ok(SOURCE.includes("rb2bFields.pageVisited"));
});

test("location and email/LinkedIn availability are surfaced, not just buried in raw JSON", () => {
  assert.ok(SOURCE.includes("formatRb2bLocation"));
  assert.ok(SOURCE.includes("rb2bFields.hasEmail"));
  assert.ok(SOURCE.includes("rb2bFields.hasLinkedin"));
});
