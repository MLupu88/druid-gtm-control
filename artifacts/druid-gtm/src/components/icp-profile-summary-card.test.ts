// Source-level regression guard for icp-profile-summary-card.tsx,
// mirroring ../components/account-icp-preview-panel.test.ts's approach
// (no jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/icp-profile-summary-card.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-profile-summary-card.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("every field is derived from the shared deterministic helpers, never recomputed inline", () => {
  const source = readSource();
  assert.ok(source.includes("buildIcpProfileSummary(config)"));
  assert.ok(source.includes("deriveConfigWarnings(config)"));
});

test("covers what defines fit, intent, actionability, and restriction/disqualification in plain language", () => {
  const source = readSource();
  assert.ok(source.includes("What company attributes define a good fit"));
  assert.ok(source.includes("Which signals define buying intent"));
  assert.ok(source.includes("What information makes the account actionable"));
  assert.ok(source.includes("What causes restriction or disqualification"));
});

test("shows the configured fit and intent bands with their thresholds", () => {
  const source = readSource();
  assert.ok(source.includes("Fit bands"));
  assert.ok(source.includes("Intent bands"));
  assert.ok(source.includes("summary.fitBands"));
  assert.ok(source.includes("summary.intentBands"));
});

test("explains points as rule weights, never a score out of 100", () => {
  const source = readSource();
  assert.ok(source.includes("Points are rule weights, not a score out of 100"));
});

test("configuration guidance warnings render only when they exist, never as a permanent fixture", () => {
  const source = readSource();
  assert.ok(source.includes("warnings.length > 0"));
});

test("configuration guidance uses the shared semantic Alert primitive with accessible dual-tone amber text, not a hardcoded one-off faint color", () => {
  const source = readSource();
  const warningsBlock = source.slice(source.indexOf("{warnings.length > 0 && ("));
  assert.ok(warningsBlock.includes("<Alert"));
  assert.ok(warningsBlock.includes("<AlertTitle"));
  assert.ok(warningsBlock.includes("<AlertDescription"));
  assert.ok(warningsBlock.includes("dark:text-amber-300") || warningsBlock.includes("dark:text-amber-400"));
  // The old bare, containerless, low-contrast-on-light text must be gone.
  assert.ok(!warningsBlock.includes("text-amber-300/90\""));
});

test("explains the three weight presets and their documented numeric values, derived from the shared constants — never hand-duplicated", () => {
  const source = readSource();
  assert.ok(source.includes("WEIGHT_PRESET_ORDER"));
  assert.ok(source.includes("WEIGHT_PRESET_VALUES"));
  assert.ok(source.includes("WEIGHT_PRESET_LABELS"));
  // No literal preset numbers (5/15/30) hand-duplicated anywhere in this
  // file — every value is read off the imported constants.
  assert.ok(!/\b5\s*points\b/.test(source));
  assert.ok(!/\b15\s*points\b/.test(source));
  assert.ok(!/\b30\s*points\b/.test(source));
});

test("explains weight presets are relative weights, not percentages or a score out of 100", () => {
  const source = readSource();
  assert.ok(source.includes("relative weights, not"));
  assert.ok(source.includes("not a score out of 100"));
});

test("explains score bands are thresholds against total configured weights", () => {
  const source = readSource();
  assert.ok(source.includes("score bands are thresholds defined against the"));
  assert.ok(source.includes("total configured weights"));
});
