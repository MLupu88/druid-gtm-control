// Source-level regression guard for legacy-starter-warning.tsx, mirroring
// ../lib/accounts-api.limit.test.ts's approach (no jsdom/testing-library
// in this package, so this checks the literal source rather than a
// render).
//
// Run with: tsx --test src/components/legacy-starter-warning.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "legacy-starter-warning.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("shows the required title and explanation copy", () => {
  const source = readSource();
  assert.ok(source.includes("Legacy starter configuration"));
  assert.ok(source.includes("only confirms that a company record exists"));
  // JSX text wraps across lines in source — check in two pieces, same
  // convention as other multi-line copy checks in this codebase.
  assert.ok(source.includes("does not define a"));
  assert.ok(source.includes("meaningful production ICP"));
});

test("provides a CTA that opens ICP profiles rather than mutating the legacy profile", () => {
  const source = readSource();
  assert.ok(source.includes("Open ICP profiles"));
  assert.ok(source.includes('href="/settings/icp-profiles"'));
});

test("never offers to edit, publish, activate, or delete the legacy profile itself", () => {
  const source = readSource();
  for (const forbidden of [
    "publishIcpProfileDraft",
    "activateIcpProfileVersion",
    "updateIcpProfileDraft",
    "useMutation",
  ]) {
    assert.ok(!source.includes(forbidden), `must not reference "${forbidden}"`);
  }
});

test("uses the shared semantic Alert primitive, not a bespoke warning box", () => {
  const source = readSource();
  assert.ok(source.includes("<Alert"));
  assert.ok(source.includes("<AlertTitle"));
  assert.ok(source.includes("<AlertDescription"));
});
