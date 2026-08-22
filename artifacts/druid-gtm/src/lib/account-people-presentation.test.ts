// LS8 — unit tests for ./account-people-presentation.ts's pure fallback
// logic. No DOM, no React — see ./account-truth-presentation.test.ts's
// own module comment for the same discipline.
//
// Run with: tsx --test src/lib/account-people-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountPerson } from "@/lib/account-people-api";
import { personDisplayName, personDisplayNameIsFallback } from "./account-people-presentation.js";

function person(overrides: Partial<AccountPerson> = {}): AccountPerson {
  return {
    id: "person-1",
    fullName: null,
    workEmail: null,
    linkedinUrl: null,
    title: null,
    source: "rb2b",
    firstSeenAt: "2026-08-21T00:00:00.000Z",
    lastSeenAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

test("personDisplayName prefers fullName when present", () => {
  assert.equal(
    personDisplayName(person({ fullName: "Laura Berkey", workEmail: "laura@example.test" })),
    "Laura Berkey",
  );
});

test("personDisplayName falls back to workEmail when fullName is absent", () => {
  assert.equal(personDisplayName(person({ workEmail: "ryan@example.test" })), "ryan@example.test");
});

test("personDisplayName falls back to linkedinUrl when neither fullName nor workEmail is present", () => {
  assert.equal(
    personDisplayName(person({ linkedinUrl: "https://linkedin.com/in/ryan-gilpin" })),
    "https://linkedin.com/in/ryan-gilpin",
  );
});

test("personDisplayName never returns a fabricated placeholder when some identity attribute exists — 'Unknown contact' is the last resort only", () => {
  assert.equal(personDisplayName(person()), "Unknown contact");
});

test("personDisplayNameIsFallback is true only when fullName itself is null", () => {
  assert.equal(personDisplayNameIsFallback(person({ fullName: "Laura Berkey" })), false);
  assert.equal(personDisplayNameIsFallback(person({ workEmail: "x@example.test" })), true);
});
