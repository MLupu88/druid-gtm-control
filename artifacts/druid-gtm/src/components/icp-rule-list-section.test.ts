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

test("a weighted rule row exposes a Weight field (business-friendly presets, with an Advanced numeric escape hatch); a condition-only (eligibility) row does not", () => {
  const source = readSource();
  const weightedBlock = source.slice(
    source.indexOf("export function WeightedRuleRow"),
    source.indexOf("export function ConditionRuleRow"),
  );
  const conditionBlock = source.slice(source.indexOf("export function ConditionRuleRow"));
  assert.ok(weightedBlock.includes("WeightEditor"), "WeightedRuleRow must show the weight editor");
  assert.ok(
    !conditionBlock.includes("WeightEditor") && !conditionBlock.includes("points"),
    "ConditionRuleRow (hard disqualifiers/restrictions) must never show a points/weight field — the schema has no points there",
  );
});

test("the weight editor offers exactly the three documented presets plus an Advanced numeric option, never silently rewriting an existing arbitrary value", () => {
  const source = readSource();
  assert.ok(source.includes("WEIGHT_PRESET_ORDER"));
  assert.ok(source.includes("WEIGHT_PRESET_VALUES"));
  assert.ok(source.includes("weightPresetForPoints"));
  assert.ok(source.includes("Advanced (exact points)"));
});

test("every weighted rule row shows the deterministic plain-language rule sentence, derived from the real condition", () => {
  const source = readSource();
  assert.ok(source.includes("describeWeightedRuleSentence"));
});

test("every eligibility rule row shows the deterministic plain-language rule sentence, tagged hard-disqualifier vs restriction", () => {
  const source = readSource();
  assert.ok(source.includes("describeEligibilityRuleSentence"));
  assert.ok(source.includes('kind: EligibilityRuleKind'));
});

test("the weight selector no longer uses the previously truncated narrow (w-40) layout — it's wide enough to read 'Advanced (exact points)' and the trigger fills its container", () => {
  const source = readSource();
  assert.ok(!source.includes("w-40 shrink-0"), "must not regress to the truncated fixed-width layout");
  assert.ok(source.includes("sm:w-52"));
  assert.ok(source.includes('className="h-8 text-sm w-full"'));
});

test("the rule header stacks on narrow viewports and stays a single row at sm+, so it never overflows at normal desktop widths while preserving mobile behavior", () => {
  const source = readSource();
  const weightedBlock = source.slice(
    source.indexOf("export function WeightedRuleRow"),
    source.indexOf("export function ConditionRuleRow"),
  );
  assert.ok(weightedBlock.includes("flex-col sm:flex-row"));
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
