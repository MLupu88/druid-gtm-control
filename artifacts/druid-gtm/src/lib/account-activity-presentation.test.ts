// LS8 — unit tests for ./account-activity-presentation.ts's pure RB2B
// field extraction. No DOM, no React. Field names mirror what's actually
// been observed in production observations.raw_value (see the module's
// own comment) — not guessed.
//
// Run with: tsx --test src/lib/account-activity-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractRb2bActivityFields,
  formatRb2bLocation,
  hasAnyRb2bActivityFields,
} from "./account-activity-presentation.js";

test("extractRb2bActivityFields reads the known real RB2B field names", () => {
  const fields = extractRb2bActivityFields({
    contact_name: "Laura Berkey",
    contact_title: "Associate Software Engineer",
    page_visited: "https://rsmus.com/pricing",
    city: "Chicago",
    state: "IL",
    contact_email: "laura@example.test",
    linkedin: "https://linkedin.com/in/laura-berkey",
  });
  assert.deepEqual(fields, {
    personName: "Laura Berkey",
    title: "Associate Software Engineer",
    pageVisited: "https://rsmus.com/pricing",
    city: "Chicago",
    state: "IL",
    hasEmail: true,
    hasLinkedin: true,
  });
});

test("extractRb2bActivityFields falls back from contact_title to position when contact_title is absent", () => {
  const fields = extractRb2bActivityFields({ position: "Consultant" });
  assert.equal(fields?.title, "Consultant");
});

test("extractRb2bActivityFields falls back from page_visited to page_url when page_visited is absent", () => {
  const fields = extractRb2bActivityFields({ page_url: "https://rsmus.com/about" });
  assert.equal(fields?.pageVisited, "https://rsmus.com/about");
});

test("extractRb2bActivityFields never fabricates a field that is genuinely absent — every field reads null", () => {
  const fields = extractRb2bActivityFields({});
  assert.deepEqual(fields, {
    personName: null,
    title: null,
    pageVisited: null,
    city: null,
    state: null,
    hasEmail: false,
    hasLinkedin: false,
  });
});

test("extractRb2bActivityFields returns null (never throws or guesses) for a non-object rawValue", () => {
  assert.equal(extractRb2bActivityFields(null), null);
  assert.equal(extractRb2bActivityFields("a string"), null);
  assert.equal(extractRb2bActivityFields(["array"]), null);
  assert.equal(extractRb2bActivityFields(42), null);
});

test("extractRb2bActivityFields treats a blank string field as absent, never as a real value", () => {
  const fields = extractRb2bActivityFields({ contact_name: "   " });
  assert.equal(fields?.personName, null);
});

test("formatRb2bLocation combines city and state with a comma only when both are present", () => {
  assert.equal(formatRb2bLocation({ city: "Chicago", state: "IL", personName: null, title: null, pageVisited: null, hasEmail: false, hasLinkedin: false }), "Chicago, IL");
  assert.equal(formatRb2bLocation({ city: "Chicago", state: null, personName: null, title: null, pageVisited: null, hasEmail: false, hasLinkedin: false }), "Chicago");
  assert.equal(formatRb2bLocation({ city: null, state: "IL", personName: null, title: null, pageVisited: null, hasEmail: false, hasLinkedin: false }), "IL");
  assert.equal(formatRb2bLocation({ city: null, state: null, personName: null, title: null, pageVisited: null, hasEmail: false, hasLinkedin: false }), null);
});

test("hasAnyRb2bActivityFields is false only when every extracted field is empty", () => {
  assert.equal(
    hasAnyRb2bActivityFields({ personName: null, title: null, pageVisited: null, city: null, state: null, hasEmail: false, hasLinkedin: false }),
    false,
  );
  assert.equal(
    hasAnyRb2bActivityFields({ personName: null, title: null, pageVisited: null, city: null, state: null, hasEmail: true, hasLinkedin: false }),
    true,
  );
});
