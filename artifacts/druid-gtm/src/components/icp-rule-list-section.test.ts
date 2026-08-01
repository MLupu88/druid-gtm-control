// Source-level regression guard for icp-rule-list-section.tsx, mirroring
// ../components/account-icp-preview-panel.test.ts's approach (no
// jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/icp-rule-list-section.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-rule-list-section.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("the list section supports add, duplicate, reorder, and remove via the shared pure array helpers", () => {
  const source = readSource();
  assert.ok(source.includes("onDuplicate"));
  assert.ok(source.includes("onMoveUp"));
  assert.ok(source.includes("onMoveDown"));
  assert.ok(source.includes("onRemove"));
  assert.ok(source.includes("replaceItemAt"));
  assert.ok(source.includes("removeItemAt"));
  assert.ok(source.includes("moveItem"));
});

test("a weighted rule row exposes a Points field; a condition-only (eligibility) row does not", () => {
  const source = readSource();
  const weightedBlock = source.slice(
    source.indexOf("export function WeightedRuleRow"),
    source.indexOf("export function ConditionRuleRow"),
  );
  const conditionBlock = source.slice(source.indexOf("export function ConditionRuleRow"));
  assert.ok(weightedBlock.includes("Points"), "WeightedRuleRow must show a Points field");
  assert.ok(
    !conditionBlock.includes("Points"),
    "ConditionRuleRow (hard disqualifiers/restrictions) must never show a Points field — the schema has no points there",
  );
});

test("rule ids are only ever shown inside collapsed TechnicalDetails, never as primary text", () => {
  const source = readSource();
  assert.ok(source.includes("<TechnicalDetails"));
  const beforeFirstTechnicalDetails = source.slice(0, source.indexOf("<TechnicalDetails"));
  assert.ok(
    !beforeFirstTechnicalDetails.includes("{rule.id}"),
    "rule.id must not be interpolated before the first TechnicalDetails block",
  );
});

test("each rule row surfaces its own validation issues, filtered from the shared validation result", () => {
  const source = readSource();
  assert.ok(source.includes("ConfigValidationIssue"));
  assert.ok(source.includes("actions.issues"));
});

test("both rule row variants embed the shared ConditionEditor, never a bespoke condition UI", () => {
  const source = readSource();
  const matches = source.match(/<ConditionEditor/g) ?? [];
  assert.equal(matches.length, 2, "expected exactly one <ConditionEditor> usage per row variant");
});
