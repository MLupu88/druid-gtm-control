// Milestone 4C — unit tests for ./account-why-now-presentation.ts's
// pure copy-building. No DOM, no React.
//
// Run with: tsx --test src/lib/account-why-now-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { WhyNowEvent } from "@/lib/account-brain-api";
import { whyNowCardText, whyNowCard } from "./account-why-now-presentation.js";

test("whyNowCardText: person_first_identified is purely factual, no significance language", () => {
  const event: WhyNowEvent = { kind: "person_first_identified", occurredAt: "2026-08-21T00:00:00.000Z" };
  assert.equal(whyNowCardText(event), "A new person was identified.");
});

test("whyNowCardText: first_activity uses 'Website' wording only when isWebsite is true", () => {
  const website: WhyNowEvent = { kind: "first_activity", occurredAt: "2026-08-21T00:00:00.000Z", isWebsite: true };
  const generic: WhyNowEvent = { kind: "first_activity", occurredAt: "2026-08-21T00:00:00.000Z", isWebsite: false };
  assert.equal(whyNowCardText(website), "Website activity was recorded for the first time.");
  assert.equal(whyNowCardText(generic), "Activity was recorded for the first time.");
});

test("whyNowCardText: activity_returned states the exact quietDays count, no frequency/velocity language", () => {
  const event: WhyNowEvent = { kind: "activity_returned", occurredAt: "2026-08-21T00:00:00.000Z", isWebsite: true, quietDays: 18 };
  assert.equal(whyNowCardText(event), "Website activity was recorded again after 18 days with none recorded.");
});

test("whyNowCardText: activity_returned uses generic 'Activity' wording when not a website-visit provider", () => {
  const event: WhyNowEvent = { kind: "activity_returned", occurredAt: "2026-08-21T00:00:00.000Z", isWebsite: false, quietDays: 9 };
  assert.equal(whyNowCardText(event), "Activity was recorded again after 9 days with none recorded.");
});

test("whyNowCardText: truth_field_learned uses human product language via fieldLabel, never the raw canonical key", () => {
  const event: WhyNowEvent = { kind: "truth_field_learned", occurredAt: "2026-08-21T00:00:00.000Z", canonicalField: "company.industry" };
  const text = whyNowCardText(event);
  assert.equal(text, "We learned the account's industry.");
  assert.ok(!text.includes("company.industry"));
});

test("whyNowCardText: truth_field_changed states from/to values when both are displayable", () => {
  const event: WhyNowEvent = {
    kind: "truth_field_changed",
    occurredAt: "2026-08-19T00:00:00.000Z",
    canonicalField: "crm.lifecycleStage",
    fromValue: "lead",
    toValue: "customer",
  };
  assert.equal(whyNowCardText(event), "Lifecycle stage changed from lead to customer.");
});

test("whyNowCardText: truth_field_changed degrades to a plain 'changed' statement when a value isn't safely displayable, never fabricating one", () => {
  const event: WhyNowEvent = {
    kind: "truth_field_changed",
    occurredAt: "2026-08-19T00:00:00.000Z",
    canonicalField: "crm.owner",
    fromValue: null,
    toValue: null,
  };
  assert.equal(whyNowCardText(event), "Owner changed.");
});

test("whyNowCard pairs the text with a human calendar-date string", () => {
  const event: WhyNowEvent = { kind: "person_first_identified", occurredAt: "2026-08-21T00:00:00.000Z" };
  const card = whyNowCard(event);
  assert.equal(card.text, "A new person was identified.");
  assert.ok(card.date.length > 0);
  assert.ok(!card.date.includes("T00:00:00"));
});
