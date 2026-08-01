// Source-level regression guard for icp-profile-detail.tsx, mirroring
// ../components/account-icp-preview-panel.test.ts's approach (no
// jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/pages/icp-profile-detail.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-profile-detail.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("the page renders the shared Settings section nav", () => {
  assert.ok(readSource().includes("<SettingsNav"));
});

test("the required re-evaluation disclosure copy is present verbatim", () => {
  const source = readSource();
  assert.ok(
    source.includes(
      "Activating a new profile version does not automatically change evaluations",
    ),
  );
  assert.ok(source.includes("already saved on existing accounts"));
});

test("uses normal product language for profile/version state", () => {
  const source = readSource();
  assert.ok(source.includes("Active version"));
  assert.ok(source.includes("Draft"));
  assert.ok(source.includes("Version history"));
});

test("the configuration summary shows counts, not the raw rules/conditions, as primary content", () => {
  const source = readSource();
  assert.ok(source.includes("Configuration summary"));
  assert.ok(source.includes("Fit rules"));
  assert.ok(source.includes("Fit tiers"));
  assert.ok(source.includes("Intent rules"));
  assert.ok(source.includes("Actionability rules"));
  assert.ok(source.includes("Hard disqualifiers"));
  assert.ok(source.includes("Restrictions"));
});

test("raw config JSON is only ever rendered inside the collapsed TechnicalDetails component", () => {
  const source = readSource();
  assert.ok(source.includes("<TechnicalDetails>"));
  const technicalBlockStart = source.indexOf("<TechnicalDetails>");
  const technicalBlockEnd = source.indexOf("</TechnicalDetails>");
  assert.ok(technicalBlockStart > -1 && technicalBlockEnd > technicalBlockStart);
  const beforeTechnicalDetails = source.slice(0, technicalBlockStart);
  // JSON.stringify(version.config...) must not appear anywhere before the
  // TechnicalDetails block opens — i.e. it is never dumped as primary content.
  assert.ok(!beforeTechnicalDetails.includes("JSON.stringify(version.config"));
  const technicalBlock = source.slice(technicalBlockStart, technicalBlockEnd);
  assert.ok(technicalBlock.includes("JSON.stringify(version.config"));
});

test("the page never leaks internal implementation terms into its own literal copy", () => {
  const source = readSource();
  for (const term of ["configSchemaVersion", "ruleId", "activationEvent"]) {
    assert.ok(!source.includes(term), `must not reference "${term}" in source`);
  }
});

test("the page derives its config summary and default version from the shared pure helpers", () => {
  const source = readSource();
  assert.ok(source.includes("summarizeVersionConfig"));
  assert.ok(source.includes("selectDefaultVersionId"));
  assert.ok(source.includes("humanizeVersionStatus"));
});

test("the draft editor is shown when a draft exists, and a truthful no-draft message otherwise — never a fake Edit action", () => {
  const source = readSource();
  assert.ok(source.includes("<IcpProfileDraftEditor"));
  assert.ok(source.includes("draftVersion ?"));
  // The JSX text wraps across multiple lines/indentation in source, so
  // this checks the phrase in two pieces rather than one continuous
  // string — same approach as the re-evaluation disclosure test above.
  assert.ok(source.includes("This profile has no editable draft."));
  assert.ok(source.includes("clone it into a new draft"));
});

test("unsaved draft changes are guarded before navigating back via the shared Link + preventDefault pattern", () => {
  const source = readSource();
  assert.ok(source.includes("draftDirty"));
  assert.ok(source.includes("onDirtyChange={onDraftDirtyChange}") || source.includes("onDraftDirtyChange"));
  assert.ok(source.includes("window.confirm"));
  assert.ok(source.includes("e.preventDefault()"));
});

// ---------------------------------------------------------------------
// Slice 3 — publish / activate / clone / comparison
// ---------------------------------------------------------------------

test("activate and clone actions are wired onto each published version's summary card, using the shared lifecycle-action components", () => {
  const source = readSource();
  assert.ok(source.includes("<ActivateVersionAction"));
  assert.ok(source.includes("<CloneVersionAction"));
  assert.ok(source.includes('version.status === "published"'));
});

test("activation is disabled for the already-active version by passing isActive through, not by hiding the action", () => {
  const source = readSource();
  assert.ok(source.includes("isActive={isActive}"));
});

test("clone is only offered when the profile has no current draft — never a misleading action the backend would reject", () => {
  const source = readSource();
  assert.ok(source.includes("hasDraft ?"));
  assert.ok(source.includes("Only one draft can exist at a time"));
});

test("the draft-vs-active comparison is shown only when a draft exists, and never fabricated when there is none", () => {
  const source = readSource();
  assert.ok(source.includes("<DraftVsActiveComparison"));
  assert.ok(source.includes("{draftVersion && ("));
});

test("no archive, deactivate, or activation-history capability is implemented on this page", () => {
  const source = readSource();
  for (const term of ["archiveProfile", "deactivateVersion", "activation-events", "activationEvents", "activation history"]) {
    assert.ok(!source.toLowerCase().includes(term.toLowerCase()), `must not reference "${term}"`);
  }
});
