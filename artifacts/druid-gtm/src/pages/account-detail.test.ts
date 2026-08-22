// LS7 — source-inspection tests for the Account Workspace's inline
// explainability additions. Mirrors this package's established
// convention (e.g. ./dashboard.test.ts) — no React rendering harness
// exists here.
//
// Run with: tsx --test src/pages/account-detail.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "account-detail.tsx"),
  "utf8",
);
const DECISION_CONTROLS_SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../components/decision-controls.tsx"),
  "utf8",
);

test("the latest evaluation panel carries a DefinitionHint for every scoring/identity field it explains, reading from the central registry", () => {
  assert.ok(SOURCE.includes('from "@/components/definition-hint"'));
  for (const hint of [
    "identity_resolution",
    "identity_confidence",
    "icp_fit",
    "intent",
    "actionability",
  ]) {
    assert.ok(SOURCE.includes(`hint="${hint}"`), `missing DefinitionHint for ${hint}`);
  }
});

test("'Created by' does not carry a DefinitionHint — not every label needs one", () => {
  const createdByLine = SOURCE.split("\n").find((line) => line.includes('label="Created by"'));
  assert.ok(createdByLine);
  assert.ok(!createdByLine!.includes("hint="));
});

test("no scoring/evaluation logic was touched — this page only reads and displays already-computed evaluation fields", () => {
  for (const marker of ["fitScore =", "intentScore =", "actionabilityScore =", "evaluateAccount"]) {
    assert.ok(!SOURCE.includes(marker), `unexpected scoring computation marker: ${marker}`);
  }
});

test("Decision Controls' 'Promote to MQL is unavailable' heading carries a decision_readiness DefinitionHint", () => {
  assert.ok(DECISION_CONTROLS_SOURCE.includes('from "@/components/definition-hint"'));
  assert.ok(DECISION_CONTROLS_SOURCE.includes('term="decision_readiness"'));
  // The block itself is a legitimate warning (amber-toned), but the hint
  // icon must still be the neutral Info icon, never a second warning
  // icon layered on top of it.
  assert.ok(!DECISION_CONTROLS_SOURCE.includes("AlertTriangle"));
});
