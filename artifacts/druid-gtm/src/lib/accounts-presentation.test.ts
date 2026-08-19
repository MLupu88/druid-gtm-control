// Tests for ./accounts-presentation.ts — pure display logic behind
// ../pages/accounts.tsx's EvaluationSummaryLine. No DOM needed (this
// package has no jsdom/testing-library — see ./accounts-api.limit.test.ts).
//
// Run with: tsx --test src/lib/accounts-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountDecisionLabel,
  formatAccountListDate,
  getEvaluationSummaryIntentLabel,
} from "./accounts-presentation.js";

test("getEvaluationSummaryIntentLabel returns 'Intent not configured' when intentConfigured is false, even if a fallback tier string is present", () => {
  assert.equal(
    getEvaluationSummaryIntentLabel({ intentConfigured: false, intentTier: "no_observed_intent" }),
    "Intent not configured",
  );
});

test("getEvaluationSummaryIntentLabel returns the real tier when intentConfigured is true and a tier exists", () => {
  assert.equal(
    getEvaluationSummaryIntentLabel({ intentConfigured: true, intentTier: "warm" }),
    "Intent: warm",
  );
});

test("getEvaluationSummaryIntentLabel returns null when intentConfigured is true but there is no tier", () => {
  assert.equal(
    getEvaluationSummaryIntentLabel({ intentConfigured: true, intentTier: null }),
    null,
  );
});

test("accountDecisionLabel covers every persisted routing output with operator language", () => {
  assert.equal(accountDecisionLabel("mql"), "Promoted to MQL");
  assert.equal(accountDecisionLabel("dismissed"), "Dismissed");
  assert.equal(accountDecisionLabel("pipeline_assist"), "Pipeline assist");
});

test("formatAccountListDate renders valid timestamps and safely rejects invalid ones", () => {
  assert.notEqual(formatAccountListDate("2026-08-18T00:00:00.000Z"), "—");
  assert.equal(formatAccountListDate("not-a-date"), "—");
});
