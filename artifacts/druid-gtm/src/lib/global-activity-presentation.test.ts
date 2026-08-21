// LS4 — unit tests for ./global-activity-presentation.ts's pure,
// factual-only formatting helpers. Run with:
// tsx --test src/lib/global-activity-presentation.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { describeActivityEvent, activityAccountLabel } from "./global-activity-presentation.js";
import type { GlobalActivityItem } from "./global-activity-api.js";

function item(overrides: Partial<GlobalActivityItem> = {}): GlobalActivityItem {
  return {
    id: "obs-1",
    provider: "rb2b",
    eventType: "page_view",
    occurredAt: "2026-08-20T00:00:00.000Z",
    importedAt: "2026-08-20T00:00:00.000Z",
    rawValue: null,
    accountId: "account-1",
    accountName: "Acme",
    companyDomain: "acme.com",
    ...overrides,
  };
}

test("describeActivityEvent prefers rawValue.page_visited when present", () => {
  const result = describeActivityEvent(item({ rawValue: { page_visited: "/m3-6-country-proof" } }));
  assert.equal(result, "visited /m3-6-country-proof");
});

test("describeActivityEvent falls back to rawValue.signal_detail when page_visited is absent", () => {
  const result = describeActivityEvent(item({ rawValue: { signal_detail: "Downloaded pricing PDF" } }));
  assert.equal(result, "Downloaded pricing PDF");
});

test("describeActivityEvent falls back to a factual provider + humanized event type when neither field is present", () => {
  const result = describeActivityEvent(item({ provider: "rb2b", eventType: "page_view", rawValue: {} }));
  assert.equal(result, "RB2B activity: Page View");
});

test("describeActivityEvent never fabricates a value from a blank or non-string field", () => {
  const result = describeActivityEvent(
    item({ provider: "rb2b", eventType: "form_submit", rawValue: { page_visited: "   ", signal_detail: 42 } }),
  );
  assert.equal(result, "RB2B activity: Form Submit");
});

test("describeActivityEvent treats a non-object rawValue the same as an absent one", () => {
  const result = describeActivityEvent(item({ provider: "rb2b", eventType: "page_view", rawValue: "not-an-object" }));
  assert.equal(result, "RB2B activity: Page View");
});

test("activityAccountLabel prefers accountName", () => {
  assert.equal(activityAccountLabel(item({ accountName: "Acme", companyDomain: "acme.com" })), "Acme");
});

test("activityAccountLabel falls back to companyDomain when accountName is null", () => {
  assert.equal(activityAccountLabel(item({ accountName: null, companyDomain: "acme.com" })), "acme.com");
});

test("activityAccountLabel falls back to a truthful 'Unknown account' when neither is available", () => {
  assert.equal(activityAccountLabel(item({ accountName: null, companyDomain: null })), "Unknown account");
});
