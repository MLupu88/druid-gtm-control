// Source-level regression guard for icp-new-profile-dialog.tsx, mirroring
// ../components/account-icp-preview-panel.test.ts's approach (no
// jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/icp-new-profile-dialog.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-new-profile-dialog.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("creation always uses the shared starter config, never a hand-rolled/invented one", () => {
  const source = readSource();
  assert.ok(source.includes("buildStarterProfileConfig()"));
  // No inline scoring rule literal (a rule always has an "id" field) is
  // constructed in this file — every rule/tier comes from the starter
  // config helper, never guessed here.
  assert.ok(!/points:\s*\d/.test(source));
});

test("the dialog collects name and description, with name required", () => {
  const source = readSource();
  assert.ok(source.includes('id="new-profile-name"'));
  assert.ok(source.includes('id="new-profile-description"'));
  assert.ok(source.includes("name.trim().length > 0"));
});

test("the create action is disabled while the request is pending, preventing duplicate submissions", () => {
  const source = readSource();
  assert.ok(source.includes("createMutation.isPending"));
  assert.ok(source.includes("!canCreate"));
});

test("on success, the dialog closes and navigates straight to the new profile's detail page", () => {
  const source = readSource();
  const onSuccessIndex = source.indexOf("onSuccess:");
  const closeIndex = source.indexOf("onOpenChange(false)");
  const navigateIndex = source.indexOf("navigate(`/settings/icp-profiles/");
  assert.ok(onSuccessIndex > -1);
  assert.ok(closeIndex > onSuccessIndex, "dialog must close inside the onSuccess handler");
  assert.ok(navigateIndex > onSuccessIndex, "navigation must happen inside the onSuccess handler");
});

test("creation failure surfaces a real error message, not a silently swallowed failure", () => {
  const source = readSource();
  assert.ok(source.includes("createMutation.isError"));
  assert.ok(source.includes("Could not create this profile"));
});
