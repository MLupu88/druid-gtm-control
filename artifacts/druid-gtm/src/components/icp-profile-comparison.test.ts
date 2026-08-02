// Source-level regression guard for icp-profile-comparison.tsx,
// mirroring ../components/account-icp-preview-panel.test.ts's approach
// (no jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/icp-profile-comparison.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-profile-comparison.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("every required section is covered", () => {
  const source = readSource();
  for (const label of [
    "Fit rules",
    "Fit bands",
    "Intent rules",
    "Intent bands",
    "Actionability rules",
    "Hard disqualifiers",
    "Restrictions",
  ]) {
    assert.ok(source.includes(`title="${label}"`), `must render the "${label}" section`);
  }
  assert.ok(source.includes("diff.notes.changed"), "must cover draft notes where relevant");
});

test("shows added, removed, changed, and unchanged summary counts", () => {
  const source = readSource();
  assert.ok(source.includes('label="Added"'));
  assert.ok(source.includes('label="Removed"'));
  assert.ok(source.includes('label="Changed"'));
  assert.ok(source.includes("unchanged"));
});

test("truthfully explains when there is nothing to compare against (no active version)", () => {
  const source = readSource();
  assert.ok(source.includes("if (!activeVersion)"));
  assert.ok(source.includes("nothing to"));
  assert.ok(source.includes("compare this draft against"));
});

test("this is a pure configuration comparison — no impact estimate, affected-account count, or re-score claim rendered to the user", () => {
  const source = readSource();
  // Scoped to the actual component code (past the leading file-header
  // comment, which legitimately documents this exact constraint using
  // these same words) — the check is that nothing here RENDERS such a
  // claim, not that the words never appear anywhere in the file.
  const codeStart = source.indexOf("function formatDateTime");
  assert.ok(codeStart > -1);
  const code = source.slice(codeStart);
  for (const phrase of ["affected account", "re-score", "rescore", "recalculat", "estimated impact"]) {
    assert.ok(
      !code.toLowerCase().includes(phrase.toLowerCase()),
      `must not render "${phrase}" — this is a config-only comparison`,
    );
  }
});

test("changed conditions get a human summary, not only a raw JSON dump, as primary content", () => {
  const source = readSource();
  assert.ok(source.includes('"Condition changed"'));
  assert.ok(source.includes('"Description changed"'));
});

test("raw config JSON is only available inside the collapsed TechnicalDetails area", () => {
  const source = readSource();
  const technicalStart = source.indexOf("<TechnicalDetails");
  assert.ok(technicalStart > -1);
  const beforeTechnical = source.slice(0, technicalStart);
  assert.ok(!beforeTechnical.includes("JSON.stringify(draftVersion.config"));
  assert.ok(!beforeTechnical.includes("JSON.stringify(activeVersion.config"));
  const technicalBlock = source.slice(technicalStart);
  assert.ok(technicalBlock.includes("JSON.stringify(draftVersion.config"));
  assert.ok(technicalBlock.includes("JSON.stringify(activeVersion.config"));
});

test("uses the shared pure diff logic, never a hand-rolled comparison", () => {
  const source = readSource();
  assert.ok(source.includes("diffProfileConfigs"));
  assert.ok(source.includes("profileConfigDiffIsEmpty"));
});

test("validates both configs through the same shared schema-backed validator before comparing, rather than assuming shape", () => {
  const source = readSource();
  assert.ok(source.includes("validateProfileConfigDraft(draftVersion.config)"));
  assert.ok(source.includes("validateProfileConfigDraft(activeVersion.config)"));
});
