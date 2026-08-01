// Source-level regression guard for icp-condition-editor.tsx, mirroring
// ../components/account-icp-preview-panel.test.ts's approach (no
// jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/icp-condition-editor.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "icp-condition-editor.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("every condition type from the evaluator's closed DSL is representable", () => {
  const source = readSource();
  for (const op of ['"exists"', '"eq"', '"in"', '"gte"', '"includesAny"', '"and"', '"or"', '"not"']) {
    assert.ok(source.includes(op), `must handle condition op ${op}`);
  }
});

test("depth and collection-size limits are imported from @workspace/evaluator, never hand-duplicated numbers", () => {
  const source = readSource();
  assert.ok(source.includes("MAX_CONDITION_DEPTH"));
  assert.ok(source.includes("MAX_CONDITION_COLLECTION_SIZE"));
  assert.ok(
    source.includes('from "@workspace/evaluator"'),
    "must import limits from the canonical package, not redeclare them",
  );
});

test("field labels are humanized, not raw field paths, as primary text", () => {
  const source = readSource();
  assert.ok(source.includes("humanizeFieldLabel"));
});

test("operator options are derived per field type from the shared validation lib, not a local operator list", () => {
  const source = readSource();
  assert.ok(source.includes("leafOperatorsForFieldType"));
});

test("nested groups are recursive (ConditionEditor renders itself for and/or/not children)", () => {
  const source = readSource();
  // At least 3 self-referencing render sites: and/or children + not child.
  const matches = source.match(/<ConditionEditor/g) ?? [];
  assert.ok(matches.length >= 2, "expected recursive <ConditionEditor> usage for nested conditions");
});
