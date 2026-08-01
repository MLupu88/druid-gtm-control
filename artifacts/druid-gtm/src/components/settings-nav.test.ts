// Source-level regression guard for settings-nav.tsx, mirroring
// ../components/account-icp-preview-panel.test.ts's approach (no
// jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// Run with: tsx --test src/components/settings-nav.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "settings-nav.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("the nav links to both the General and ICP Profiles sections", () => {
  const source = readSource();
  assert.match(source, /path:\s*"\/settings"/);
  assert.match(source, /path:\s*"\/settings\/icp-profiles"/);
});

test("the nav uses normal product language for both sections", () => {
  const source = readSource();
  assert.ok(source.includes('label: "General"'));
  assert.ok(source.includes('label: "ICP Profiles"'));
});
