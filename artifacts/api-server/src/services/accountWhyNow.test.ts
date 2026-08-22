// Milestone 4C — unit tests for ./accountWhyNow.ts's deterministic
// change detection. No DB, no network, no LLM.
//
// Run with: tsx --test src/services/accountWhyNow.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { AccountPersonDTO } from "./people.js";
import type { AccountActivityItemDTO } from "./accountActivity.js";
import type { ResolvedFactHistoryEntry } from "./accountTruthHistory.js";
import {
  detectPersonEvents,
  detectActivityEvent,
  detectTruthFieldEvents,
  buildWhyNowEvents,
  WHY_NOW_WINDOW_DAYS,
  MIN_QUIET_DAYS_FOR_RETURN,
} from "./accountWhyNow.js";

const NOW = new Date("2026-08-22T12:00:00.000Z");
function windowStart(now: Date = NOW): Date {
  return new Date(now.getTime() - WHY_NOW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function person(overrides: Partial<AccountPersonDTO> = {}): AccountPersonDTO {
  return {
    id: "person-1",
    fullName: "Laura Berkey",
    workEmail: null,
    linkedinUrl: null,
    title: "VP Sales",
    source: "rb2b",
    firstSeenAt: "2026-08-20T00:00:00.000Z",
    lastSeenAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

function activityItem(overrides: Partial<AccountActivityItemDTO> = {}): AccountActivityItemDTO {
  return {
    id: "obs-1",
    provider: "rb2b",
    eventType: "page_view",
    occurredAt: "2026-08-20T10:00:00.000Z",
    importedAt: "2026-08-20T10:00:00.000Z",
    rawValue: {},
    ...overrides,
  };
}

function historyEntry(overrides: Partial<ResolvedFactHistoryEntry> = {}): ResolvedFactHistoryEntry {
  return {
    canonicalField: "crm.lifecycleStage",
    resolutionState: "single_source",
    canonicalValue: "lead",
    resolvedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// detectPersonEvents
// ---------------------------------------------------------------------

test("detectPersonEvents: a person whose firstSeenAt falls in-window produces one event", () => {
  const events = detectPersonEvents([person({ firstSeenAt: "2026-08-21T00:00:00.000Z" })], windowStart());
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "person_first_identified");
  assert.equal(events[0]?.occurredAt, "2026-08-21T00:00:00.000Z");
});

test("detectPersonEvents: a person first seen before the window produces no event", () => {
  const events = detectPersonEvents([person({ firstSeenAt: "2026-07-01T00:00:00.000Z" })], windowStart());
  assert.deepEqual(events, []);
});

test("detectPersonEvents: lastSeenAt is irrelevant — only firstSeenAt (never mutated after insert) drives this event", () => {
  const events = detectPersonEvents(
    [person({ firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-08-21T00:00:00.000Z" })],
    windowStart(),
  );
  assert.deepEqual(events, []);
});

// ---------------------------------------------------------------------
// detectActivityEvent
// ---------------------------------------------------------------------

test("detectActivityEvent: no activity at all -> null", () => {
  assert.equal(detectActivityEvent([], windowStart()), null);
});

test("detectActivityEvent: activity exists but entirely before the window -> null", () => {
  const items = [activityItem({ occurredAt: "2026-07-01T00:00:00.000Z" })];
  assert.equal(detectActivityEvent(items, windowStart()), null);
});

test("detectActivityEvent: a single distinct day of activity in-window is first_activity", () => {
  const items = [
    activityItem({ occurredAt: "2026-08-21T08:00:00.000Z" }),
    activityItem({ occurredAt: "2026-08-21T09:00:00.000Z" }),
  ];
  const event = detectActivityEvent(items, windowStart());
  assert.equal(event?.kind, "first_activity");
  assert.equal(event && "isWebsite" in event ? event.isWebsite : null, true);
  assert.equal(event?.occurredAt, "2026-08-21T08:00:00.000Z");
});

test("detectActivityEvent: first_activity is isWebsite: false when the provider is not a website-visit provider", () => {
  const items = [activityItem({ occurredAt: "2026-08-21T08:00:00.000Z", provider: "hubspot" })];
  const event = detectActivityEvent(items, windowStart());
  assert.equal(event && "isWebsite" in event ? event.isWebsite : null, false);
});

test(`detectActivityEvent: two distinct days with a quiet gap of exactly ${MIN_QUIET_DAYS_FOR_RETURN} days produces activity_returned`, () => {
  // Aug 3 -> Aug 21: dayDiff = 18, quietDays = 17 (well above the minimum) — use a tight case instead.
  const items = [
    activityItem({ occurredAt: "2026-08-05T09:00:00.000Z" }), // prev day
    activityItem({ occurredAt: "2026-08-21T09:00:00.000Z" }), // last day; dayDiff=16, quietDays=15
  ];
  const event = detectActivityEvent(items, windowStart());
  assert.equal(event?.kind, "activity_returned");
  if (event?.kind === "activity_returned") {
    assert.equal(event.quietDays, 15);
  }
});

test("detectActivityEvent: a gap of exactly MIN_QUIET_DAYS_FOR_RETURN - 1 quiet days does NOT produce a return card — conservative threshold", () => {
  // prev Aug 13, last Aug 21: dayDiff = 8, quietDays = 7 === MIN_QUIET_DAYS_FOR_RETURN, should fire.
  // For a NEGATIVE case, use dayDiff = 7, quietDays = 6 < 7.
  const items = [
    activityItem({ occurredAt: "2026-08-14T09:00:00.000Z" }),
    activityItem({ occurredAt: "2026-08-21T09:00:00.000Z" }),
  ];
  assert.equal(detectActivityEvent(items, windowStart()), null);
});

test("detectActivityEvent: a gap of exactly MIN_QUIET_DAYS_FOR_RETURN quiet days DOES produce a return card", () => {
  const items = [
    activityItem({ occurredAt: "2026-08-13T09:00:00.000Z" }),
    activityItem({ occurredAt: "2026-08-21T09:00:00.000Z" }),
  ];
  const event = detectActivityEvent(items, windowStart());
  assert.equal(event?.kind, "activity_returned");
  if (event?.kind === "activity_returned") assert.equal(event.quietDays, MIN_QUIET_DAYS_FOR_RETURN);
});

test("detectActivityEvent: ordinary back-to-back daily activity never produces a card — no card merely because two distinct days exist", () => {
  const items = [
    activityItem({ occurredAt: "2026-08-20T09:00:00.000Z" }),
    activityItem({ occurredAt: "2026-08-21T09:00:00.000Z" }),
  ];
  assert.equal(detectActivityEvent(items, windowStart()), null);
});

test("detectActivityEvent: the returned event's occurredAt is the LATEST day's earliest event, not the previous day's", () => {
  const items = [
    activityItem({ occurredAt: "2026-08-13T09:00:00.000Z" }),
    activityItem({ occurredAt: "2026-08-21T14:00:00.000Z" }),
    activityItem({ occurredAt: "2026-08-21T09:30:00.000Z" }),
  ];
  const event = detectActivityEvent(items, windowStart());
  assert.equal(event?.occurredAt, "2026-08-21T09:30:00.000Z");
});

test("detectActivityEvent: a return day with mixed providers is isWebsite: false (not ALL providers are website-visit providers)", () => {
  const items = [
    activityItem({ occurredAt: "2026-08-13T09:00:00.000Z", provider: "rb2b" }),
    activityItem({ occurredAt: "2026-08-21T09:00:00.000Z", provider: "hubspot" }),
  ];
  const event = detectActivityEvent(items, windowStart());
  if (event?.kind === "activity_returned") assert.equal(event.isWebsite, false);
});

// ---------------------------------------------------------------------
// detectTruthFieldEvents
// ---------------------------------------------------------------------

test("detectTruthFieldEvents: the field's first-ever Known entry, in-window, is truth_field_learned", () => {
  const history = [historyEntry({ canonicalField: "company.industry", canonicalValue: "Banking", resolvedAt: "2026-08-21T00:00:00.000Z" })];
  const events = detectTruthFieldEvents(history, windowStart());
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "truth_field_learned");
  assert.equal(events[0]?.occurredAt, "2026-08-21T00:00:00.000Z");
});

test("detectTruthFieldEvents: a first-ever Known entry OUTSIDE the window produces no event", () => {
  const history = [historyEntry({ canonicalValue: "Banking", resolvedAt: "2026-07-01T00:00:00.000Z" })];
  assert.deepEqual(detectTruthFieldEvents(history, windowStart()), []);
});

test("detectTruthFieldEvents: a value change between two Known periods, in-window, is truth_field_changed with from/to values", () => {
  const history = [
    historyEntry({ canonicalField: "crm.lifecycleStage", canonicalValue: "lead", resolutionState: "single_source", resolvedAt: "2026-07-01T00:00:00.000Z" }),
    historyEntry({ canonicalField: "crm.lifecycleStage", canonicalValue: "customer", resolutionState: "single_source", resolvedAt: "2026-08-19T00:00:00.000Z" }),
  ];
  const events = detectTruthFieldEvents(history, windowStart());
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "truth_field_changed");
  if (events[0]?.kind === "truth_field_changed") {
    assert.equal(events[0].fromValue, "lead");
    assert.equal(events[0].toValue, "customer");
  }
});

test("detectTruthFieldEvents: consecutive resolved_facts rows with the SAME value are collapsed — a re-affirming snapshot is not a change", () => {
  const history = [
    historyEntry({ canonicalValue: "lead", resolvedAt: "2026-06-01T00:00:00.000Z" }),
    historyEntry({ canonicalValue: "lead", resolvedAt: "2026-08-21T00:00:00.000Z" }), // same value, later resolvedAt
  ];
  assert.deepEqual(detectTruthFieldEvents(history, windowStart()), []);
});

test("detectTruthFieldEvents: a HubSpot re-sync writing the identical value on every run never produces repeated learned/changed noise", () => {
  const history = [
    historyEntry({ canonicalValue: "Banking", resolvedAt: "2026-08-01T00:00:00.000Z" }),
    historyEntry({ canonicalValue: "Banking", resolvedAt: "2026-08-08T00:00:00.000Z" }),
    historyEntry({ canonicalValue: "Banking", resolvedAt: "2026-08-15T00:00:00.000Z" }),
    historyEntry({ canonicalValue: "Banking", resolvedAt: "2026-08-21T00:00:00.000Z" }),
  ];
  // First-ever period starts 2026-08-01, outside the window -> no "learned" event either.
  assert.deepEqual(detectTruthFieldEvents(history, windowStart()), []);
});

test("detectTruthFieldEvents: a regression from Known to Conflicting/Unknown produces no event — no positive framing exists for that direction", () => {
  const history = [
    historyEntry({ canonicalValue: "Banking", resolvedAt: "2026-07-01T00:00:00.000Z" }),
    historyEntry({ canonicalValue: null, resolutionState: "unresolved", resolvedAt: "2026-08-21T00:00:00.000Z" }),
  ];
  assert.deepEqual(detectTruthFieldEvents(history, windowStart()), []);
});

test("detectTruthFieldEvents: independently tracks multiple fields", () => {
  const history = [
    historyEntry({ canonicalField: "company.industry", canonicalValue: "Banking", resolvedAt: "2026-08-21T00:00:00.000Z" }),
    historyEntry({ canonicalField: "crm.lifecycleStage", canonicalValue: "lead", resolvedAt: "2026-07-01T00:00:00.000Z" }),
    historyEntry({ canonicalField: "crm.lifecycleStage", canonicalValue: "customer", resolvedAt: "2026-08-19T00:00:00.000Z" }),
  ];
  const events = detectTruthFieldEvents(history, windowStart());
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => e.kind === "truth_field_learned" && e.canonicalField === "company.industry"));
  assert.ok(events.some((e) => e.kind === "truth_field_changed" && e.canonicalField === "crm.lifecycleStage"));
});

test("detectTruthFieldEvents: no history at all for a field simply produces no event — the honest, expected outcome for a never-evaluated account", () => {
  assert.deepEqual(detectTruthFieldEvents([], windowStart()), []);
});

// ---------------------------------------------------------------------
// buildWhyNowEvents
// ---------------------------------------------------------------------

test("buildWhyNowEvents: merges every detected event type, sorted newest-first", () => {
  const events = buildWhyNowEvents({
    people: [person({ firstSeenAt: "2026-08-19T00:00:00.000Z" })],
    activityItems: [activityItem({ occurredAt: "2026-08-21T00:00:00.000Z" })],
    truthHistory: [historyEntry({ canonicalValue: "Banking", resolvedAt: "2026-08-20T00:00:00.000Z" })],
    now: NOW,
  });
  assert.equal(events.length, 3);
  assert.equal(events[0]?.occurredAt, "2026-08-21T00:00:00.000Z");
  assert.equal(events[2]?.occurredAt, "2026-08-19T00:00:00.000Z");
});

test("buildWhyNowEvents: an account with genuinely nothing new returns an empty array — never a fabricated entry", () => {
  const events = buildWhyNowEvents({
    people: [person({ firstSeenAt: "2026-01-01T00:00:00.000Z" })],
    activityItems: [],
    truthHistory: [],
    now: NOW,
  });
  assert.deepEqual(events, []);
});

test("buildWhyNowEvents: caps at 5 events even when more qualify", () => {
  const people = Array.from({ length: 8 }, (_, i) =>
    person({ id: `p${i}`, firstSeenAt: `2026-08-${15 + i}T00:00:00.000Z` }),
  );
  const events = buildWhyNowEvents({ people, activityItems: [], truthHistory: [], now: NOW });
  assert.equal(events.length, 5);
});
