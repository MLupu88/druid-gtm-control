// Milestone 4B — unit tests for ./account-brain-presentation.ts's pure
// logic. No DOM, no React — see ./account-truth-presentation.test.ts's
// own module comment for the same discipline.
//
// Run with: tsx --test src/lib/account-brain-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountActivitySummary } from "@/lib/account-brain-api";
import { activitySummaryLine, narrativeUnavailableCopy } from "./account-brain-presentation.js";

function activitySummary(overrides: Partial<AccountActivitySummary> = {}): AccountActivitySummary {
  return {
    totalEvents: 0,
    firstObservedAt: null,
    lastObservedAt: null,
    distinctDaysObserved: 0,
    providers: [],
    ...overrides,
  };
}

test("activitySummaryLine states a truthful zero when no activity has been observed", () => {
  assert.equal(activitySummaryLine(activitySummary()), "No activity has been observed for this account yet.");
});

test("activitySummaryLine states counts, distinct days, provider list, and a date range", () => {
  const line = activitySummaryLine(
    activitySummary({
      totalEvents: 12,
      distinctDaysObserved: 5,
      providers: ["rb2b"],
      firstObservedAt: "2026-08-01T10:00:00.000Z",
      lastObservedAt: "2026-08-20T15:30:00.000Z",
    }),
  );
  assert.ok(line.includes("12 events"));
  assert.ok(line.includes("5 distinct days"));
  assert.ok(line.includes("rb2b"));
  assert.ok(line.includes("between"));
});

test("activitySummaryLine uses singular event/day wording for a count of exactly one", () => {
  const line = activitySummaryLine(
    activitySummary({ totalEvents: 1, distinctDaysObserved: 1, providers: ["hubspot"], firstObservedAt: "2026-08-20T00:00:00.000Z", lastObservedAt: "2026-08-20T00:00:00.000Z" }),
  );
  assert.ok(line.includes("1 event "));
  assert.ok(line.includes("1 distinct day"));
});

test("narrativeUnavailableCopy never surfaces the raw reason string, and falls back for an unknown reason", () => {
  const copy = narrativeUnavailableCopy("not_configured");
  assert.ok(!copy.includes("not_configured"));
  assert.ok(narrativeUnavailableCopy("something_new").length > 0);
});
