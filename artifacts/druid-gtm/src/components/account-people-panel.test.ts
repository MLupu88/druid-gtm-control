// LS8 — source-inspection tests for ./account-people-panel.tsx. Mirrors
// this package's established convention — no React rendering harness
// exists here.
//
// Run with: tsx --test src/components/account-people-panel.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "account-people-panel.tsx"),
  "utf8",
);

test("the panel fetches canonical people via the real API, not a hardcoded placeholder", () => {
  assert.ok(SOURCE.includes('from "@/lib/account-people-api"'));
  assert.ok(SOURCE.includes("fetchAccountPeople"));
  assert.ok(!SOURCE.includes("People data is not available"));
});

test("has real loading, error, and empty states, not just a happy path", () => {
  assert.ok(SOURCE.includes("peopleQ.isLoading"));
  assert.ok(SOURCE.includes("peopleQ.isError"));
  assert.ok(SOURCE.includes("items.length === 0"));
});

test("renders name/title/email/LinkedIn/source/last-observed fields from the API response, never a fabricated placeholder value", () => {
  assert.ok(SOURCE.includes("personDisplayName"));
  assert.ok(SOURCE.includes("person.title"));
  assert.ok(SOURCE.includes("person.workEmail"));
  assert.ok(SOURCE.includes("person.linkedinUrl"));
  assert.ok(SOURCE.includes("providerDisplayName(person.source)"));
  assert.ok(SOURCE.includes("Last observed"));
});
