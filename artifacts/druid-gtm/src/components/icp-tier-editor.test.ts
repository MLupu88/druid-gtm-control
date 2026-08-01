// Source-level regression guard for icp-tier-editor.tsx, mirroring
// ../components/account-icp-preview-panel.test.ts's approach (no
// jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/icp-tier-editor.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-tier-editor.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("the required lowest band is identified as the fallback band, without using 'floor' as the primary user-facing label", () => {
  const source = readSource();
  assert.ok(source.includes("Fallback band"));
  assert.ok(!source.includes(">Floor<"));
  assert.ok(!source.includes('"Floor tier"'));
  assert.ok(!source.includes('"Floor Tier"'));
});

test("explains that every possible score must resolve to a configured band", () => {
  const source = readSource();
  assert.ok(source.includes("Every possible score must resolve to a configured band"));
});

test("flags a band whose threshold exceeds the dimension's total configured positive rule weights (a safe upper bound, never claimed as a guarantee of reachability for lower bands)", () => {
  const source = readSource();
  assert.ok(source.includes("configuredMaximumPoints"));
  assert.ok(source.includes("Cannot be reached with configured weights"));
  // Must not claim this is merely a transient/"currently" state, nor use
  // "achievable"/"reachable" framing that overclaims what the arithmetic
  // upper bound actually proves.
  assert.ok(!source.toLowerCase().includes("achievable"));
});

test("explicitly warns against assuming a score is out of 100, rather than silently implying a fixed scale", () => {
  const source = readSource();
  // The warning necessarily names the assumption it's rejecting — this
  // checks the disclaimer is present, not that the phrase never appears.
  // JSX text uses the &apos; entity, not a literal apostrophe.
  assert.ok(source.includes("assume a score is"));
  assert.ok(!source.includes("/100"), "must never render a literal '/100' scale");
});

test("tier validity (duplicate codes/thresholds, missing starting tier) is read from the shared schema-backed issues prop, never a second validator", () => {
  const source = readSource();
  assert.ok(source.includes("issues:"));
  assert.ok(source.includes("ConfigValidationIssue"));
  // No locally hand-rolled duplicate-detection helper.
  assert.ok(!source.includes("function uniqueBy"));
  assert.ok(!source.includes("function validateTiers"));
});

test("supports add, remove, and reorder of tiers via the shared pure array helpers", () => {
  const source = readSource();
  assert.ok(source.includes("newTier()"));
  assert.ok(source.includes("replaceItemAt"));
  assert.ok(source.includes("removeItemAt"));
  assert.ok(source.includes("moveItem"));
});
