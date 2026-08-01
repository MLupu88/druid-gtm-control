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
