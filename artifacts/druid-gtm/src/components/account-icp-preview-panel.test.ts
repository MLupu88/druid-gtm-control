// Source-level regression guard for account-icp-preview-panel.tsx,
// mirroring ../lib/accounts-api.limit.test.ts's approach (no
// jsdom/testing-library in this package, so this checks the literal
// source rather than a render).
//
// The production bug this guards against: an unconditional, hardcoded
// notice claiming "CRM, engagement, contact, and consent details are not
// yet available" sat right next to a "Missing inputs" section that could
// independently say "No missing inputs recorded" for the very same
// evaluation — two contradictory claims about the same data. The
// behavioral fix (categorizeMissingInputs's null/[]/populated states) is
// tested in ../lib/icp-preview-presentation.test.ts; this test only
// confirms the specific old contradictory phrase pairing was actually
// removed from this component, not just fixed in the helper it could
// still ignore.
//
// Run with: tsx --test src/components/account-icp-preview-panel.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "account-icp-preview-panel.tsx",
);

test("the old unconditional CRM/engagement/contact/consent claim no longer appears verbatim", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");
  assert.ok(
    !source.includes(
      "CRM, engagement, contact, and consent details are not yet available",
    ),
    "the static disclaimer must not unconditionally claim these categories are missing",
  );
});

test("the old bare 'No missing inputs recorded.' empty label no longer appears — it must reflect the specific evaluation, not be a generic label", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");
  assert.ok(!source.includes("No missing inputs recorded."));
});

test("the panel derives its missing-inputs display from categorizeMissingInputs, not a hardcoded claim", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");
  assert.ok(source.includes("categorizeMissingInputs"));
});

test("humanized terminology from the UX pass is present in the component's own copy", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");
  assert.ok(source.includes("ICP profile"));
  assert.ok(source.includes("Test against this ICP"));
  assert.ok(source.includes("Tested against"));
  assert.ok(!source.includes("Analysis lens"));
  assert.ok(!source.includes("Run ICP preview"));
});
