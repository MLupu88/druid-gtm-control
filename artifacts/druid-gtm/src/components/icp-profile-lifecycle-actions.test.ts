// Source-level regression guard for icp-profile-lifecycle-actions.tsx,
// mirroring ../components/account-icp-preview-panel.test.ts's approach
// (no jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/icp-profile-lifecycle-actions.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-profile-lifecycle-actions.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

function componentBlock(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  assert.ok(start > -1, `component ${name} must exist`);
  const nextExport = source.indexOf("\nexport function", start + 1);
  return nextExport > -1 ? source.slice(start, nextExport) : source.slice(start);
}

// ---------------------------------------------------------------------
// Every action requires explicit confirmation via a real Dialog — none
// mutate directly from the trigger button's onClick.
// ---------------------------------------------------------------------

test("every lifecycle action opens a confirmation dialog rather than mutating directly on click", () => {
  const source = readSource();
  for (const name of ["PublishDraftAction", "ActivateVersionAction", "CloneVersionAction"]) {
    const block = componentBlock(source, name);
    assert.ok(block.includes("handleOpenChange(true)"), `${name} must open a dialog first`);
    assert.ok(block.includes("<LifecycleConfirmDialog"), `${name} must use the shared confirm dialog`);
  }
});

// ---------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------

test("PublishDraftAction's eligibility (disabled/disabledReason) is a prop, never re-derived locally — dirty/valid state stays owned by the draft editor", () => {
  const source = readSource();
  const block = componentBlock(source, "PublishDraftAction");
  assert.ok(block.includes("disabled,"));
  assert.ok(block.includes("disabledReason,"));
  // No local validation/dirty computation.
  assert.ok(!block.includes("validateProfileConfigDraft"));
});

test("publish never auto-saves before publishing — no save mutation is ever triggered from this file", () => {
  const source = readSource();
  assert.ok(!source.includes("updateIcpProfileDraft"));
});

test("publish explains that it creates an immutable version and does not activate it", () => {
  const block = componentBlock(readSource(), "PublishDraftAction");
  assert.ok(block.includes("immutable"));
  assert.ok(block.includes("does not make this version active"));
});

// ---------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------

test("ActivateVersionAction disables reactivating the already-active version", () => {
  const block = componentBlock(readSource(), "ActivateVersionAction");
  assert.ok(block.includes("disabled={isActive}"));
});

test("activate explains future evaluations use the new version, and never claims existing accounts were re-scored", () => {
  const block = componentBlock(readSource(), "ActivateVersionAction");
  assert.ok(block.toLowerCase().includes("official evaluations"));
  // JSX text wraps across lines in source — check in two pieces.
  assert.ok(block.includes("not automatically"));
  assert.ok(block.includes("recalculated"));
  // Load-bearing negative check — must never claim existing accounts
  // were actually re-evaluated/re-scored as a side effect of activation.
  for (const phrase of [
    "accounts have been re-scored",
    "accounts were re-scored",
    "accounts have been recalculated",
    "re-scored automatically",
  ]) {
    assert.ok(!block.toLowerCase().includes(phrase.toLowerCase()));
  }
});

// ---------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------

test("CloneVersionAction makes the source version explicit in its own confirmation copy", () => {
  const block = componentBlock(readSource(), "CloneVersionAction");
  assert.ok(block.includes("version.versionNumber"));
  assert.ok(block.includes("version.versionNumber} into a new draft"));
});

test("CloneVersionAction does not itself re-check draft existence — the caller (icp-profile-detail.tsx) only ever renders it when there is none", () => {
  const block = componentBlock(readSource(), "CloneVersionAction");
  assert.ok(!block.includes("hasDraft"));
  assert.ok(!block.includes("draftVersion"));
});

// ---------------------------------------------------------------------
// Query invalidation — every action refreshes both surfaces.
// ---------------------------------------------------------------------

test("every lifecycle action invalidates both the profile detail and the profiles list on success", () => {
  const source = readSource();
  const matches = source.match(/invalidateProfileQueries\(queryClient, profileId\)/g) ?? [];
  assert.equal(matches.length, 3, "expected one invalidation call per action (publish/activate/clone)");
  const helperBlock = source.slice(
    source.indexOf("function invalidateProfileQueries"),
    source.indexOf("function invalidateProfileQueries") + 400,
  );
  assert.ok(helperBlock.includes("icpProfileDetailQueryKey"));
  assert.ok(helperBlock.includes("icpProfilesListQueryKey"));
});

// ---------------------------------------------------------------------
// Failure handling — every action surfaces a real, human-readable error.
// ---------------------------------------------------------------------

test("every lifecycle action surfaces mutation failures via the shared error alert, never silently", () => {
  const source = readSource();
  const matches = source.match(/error=\{mutation\.isError \? mutation\.error : null\}/g) ?? [];
  assert.equal(matches.length, 3);
  assert.ok(source.includes("LifecycleErrorAlert"));
});

// ---------------------------------------------------------------------
// Out of scope for this slice.
// ---------------------------------------------------------------------

test("no archive, deactivate, or activation-history capability is implemented in this file", () => {
  const source = readSource();
  for (const term of ["archive", "deactivate", "activation history", "activationHistory"]) {
    assert.ok(!source.toLowerCase().includes(term.toLowerCase()), `must not implement "${term}"`);
  }
});
