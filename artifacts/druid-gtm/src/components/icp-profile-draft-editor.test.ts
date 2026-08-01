// Source-level regression guard for icp-profile-draft-editor.tsx,
// mirroring ../components/account-icp-preview-panel.test.ts's approach
// (no jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/icp-profile-draft-editor.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-profile-draft-editor.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("covers every required dimension with normal product language", () => {
  const source = readSource();
  for (const label of ["Company fit", "Buying intent", "Ability to act", "Outreach eligibility"]) {
    assert.ok(source.includes(label), `must render the "${label}" section`);
  }
});

test("hard disqualifiers and restrictions are both editable within eligibility", () => {
  const source = readSource();
  assert.ok(source.includes("Hard disqualifiers"));
  assert.ok(source.includes("Restrictions"));
});

test("name and description are read-only, with the limitation explained rather than silently unsupported", () => {
  const source = readSource();
  // JSX text wraps across lines in source — check in two pieces.
  assert.ok(source.includes("editing it isn&apos;t"));
  assert.ok(source.includes("supported yet."));
  // Load-bearing: there is no input/textarea bound to profile.name or
  // profile.description — only a plain read display of each.
  assert.ok(!/<Input[^>]*value=\{profile\.name/.test(source));
  assert.ok(!/<Textarea[^>]*value=\{profile\.description/.test(source));
});

test("draft notes ARE editable", () => {
  const source = readSource();
  assert.ok(source.includes('id="draft-notes"'));
  assert.ok(source.includes("setNotes"));
});

test("the full config is always sent on save — updateDraft is a full-replacement operation", () => {
  const source = readSource();
  const mutationBlock = source.slice(
    source.indexOf("const saveMutation"),
    source.indexOf("onSuccess:", source.indexOf("const saveMutation")),
  );
  assert.ok(mutationBlock.includes("updateIcpProfileDraft"));
  assert.ok(mutationBlock.includes("config,"));
});

test("validation is read from the single shared schema-backed source, never a second validator", () => {
  const source = readSource();
  assert.ok(source.includes("validateProfileConfigDraft"));
  assert.ok(source.includes("issuesForPath"));
});

test("every required save state is represented: unchanged, unsaved, saving, saved, error", () => {
  const source = readSource();
  for (const state of ['"unchanged"', '"unsaved"', '"saving"', '"saved"', '"error"']) {
    assert.ok(source.includes(state), `must represent save state ${state}`);
  }
});

test("duplicate submissions are prevented while a save is in flight", () => {
  const source = readSource();
  assert.ok(source.includes("saveMutation.isPending"));
  assert.ok(source.includes("canSave"));
});

test("navigating away with unsaved changes is guarded via beforeunload", () => {
  const source = readSource();
  assert.ok(source.includes("beforeunload"));
  assert.ok(source.includes("e.returnValue"));
});

test("the saved confirmation shows a real timestamp of when the save actually completed", () => {
  const source = readSource();
  assert.ok(source.includes("setSavedAt(new Date())"));
  assert.ok(source.includes("savedAt.toLocaleTimeString()"));
});

test("shows restrained guidance that some account data fields may be absent, without blocking authoring", () => {
  const source = readSource();
  assert.ok(
    source.includes("may not be") || source.includes("missing inputs"),
    "expected a missing-data guidance notice",
  );
  assert.ok(source.includes("can still be authored") || source.includes("You can still author"));
});

test("never introduces roles or job titles as a scoring criterion — the evaluator does not support them yet", () => {
  const source = readSource();
  // "title" itself legitimately appears as a section-title prop
  // (title="Fit rules", CardTitle, AlertTitle) — this checks the actual
  // concept (a job-title/seniority field made available to author
  // conditions against) is never introduced, not the bare word.
  for (const phrase of ["job title", "contact.title", "seniority", "buyer role", "buying role"]) {
    assert.ok(!source.toLowerCase().includes(phrase), `must not reference "${phrase}"`);
  }
  // Field options offered to the author always come from the real,
  // canonical allowlists — this file never hand-lists its own fields.
  assert.ok(!source.includes('"company.'));
  assert.ok(!source.includes('"contact.'));
});

test("a failed save preserves the user's edits — the mutation error path never resets config or notes state", () => {
  const source = readSource();
  assert.ok(!source.includes("onError"));
});

// ---------------------------------------------------------------------
// Slice 3 — publish
// ---------------------------------------------------------------------

test("the Publish action is wired in, disabled whenever the draft is invalid, unsaved, or currently saving — never auto-saving first", () => {
  const source = readSource();
  assert.ok(source.includes("<PublishDraftAction"));
  assert.ok(source.includes("!validation.valid"));
  assert.ok(source.includes("publishDisabledReason"));
  const disabledBlock = source.slice(
    source.indexOf("const publishDisabledReason"),
    source.indexOf("const fitAllowlist"),
  );
  assert.ok(disabledBlock.includes("dirty"));
  assert.ok(disabledBlock.includes("saveMutation.isPending"));
  // Load-bearing: publish is never preceded by an automatic save call —
  // saveMutation.mutate() is only ever invoked from the Save button's
  // own onClick, never from anywhere in the publish-gating logic.
  assert.ok(!disabledBlock.includes("saveMutation.mutate()"));
});

test("publish disabled reasons are explained, not just a silently disabled button", () => {
  const source = readSource();
  assert.ok(source.includes("Fix the issues listed below before publishing."));
  assert.ok(source.includes("Save your changes before publishing."));
});
