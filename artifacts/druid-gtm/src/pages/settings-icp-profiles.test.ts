// Source-level regression guard for settings-icp-profiles.tsx, mirroring
// ../components/account-icp-preview-panel.test.ts's approach (no
// jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/pages/settings-icp-profiles.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "settings-icp-profiles.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("the page renders the shared Settings section nav", () => {
  assert.ok(readSource().includes("<SettingsNav"));
});

test("the page uses normal product language for the section heading", () => {
  const source = readSource();
  assert.ok(source.includes("ICP Profiles"));
});

test("a New ICP profile action is visible but does not simulate creating a profile", () => {
  const source = readSource();
  assert.ok(source.includes("New ICP profile"));
  assert.ok(source.includes("Available in the next step"));
  // Load-bearing: no mutation anywhere in this file, and the button
  // rendering "New ICP profile" itself is a plain `disabled` Button with
  // no onClick — see NewProfileButton. (The page does have one legitimate
  // onClick elsewhere, the "Retry" button in ListErrorState, which this
  // test must not flag.)
  assert.ok(!source.includes("useMutation"));
  const newProfileButtonBlock = source.slice(
    source.indexOf("function NewProfileButton"),
    source.indexOf("function ProfileRow"),
  );
  assert.ok(newProfileButtonBlock.includes("New ICP profile"));
  assert.ok(!newProfileButtonBlock.includes("onClick"));
});

test("the page has real loading, error, and empty states, not just a happy path", () => {
  const source = readSource();
  assert.ok(source.includes("isLoading"));
  assert.ok(source.includes("isError"));
  assert.ok(source.includes("No ICP profiles yet"));
});

test("badges are derived via the shared pure helper, not hand-rolled inline logic", () => {
  const source = readSource();
  assert.ok(source.includes("deriveProfileBadges"));
});

test("the page never references internal implementation terms in its own copy/logic", () => {
  const source = readSource();
  for (const term of ["configSchemaVersion", "ruleId", "activationEvent"]) {
    assert.ok(!source.includes(term), `must not reference "${term}"`);
  }
});
