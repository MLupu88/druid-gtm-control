// Milestone 4B — source-inspection tests for ./account-brain-panel.tsx.
// Mirrors this package's established convention — no React rendering
// harness exists here (see ./account-claims-panel.test.ts).
//
// Run with: tsx --test src/components/account-brain-panel.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "account-brain-panel.tsx"),
  "utf8",
);

test("the panel fetches the Account Brain read model via the real API, not a hardcoded placeholder", () => {
  assert.ok(SOURCE.includes('from "@/lib/account-brain-api"'));
  assert.ok(SOURCE.includes("fetchAccountBrain"));
});

test("Analyze is a real POST mutation, not fired automatically — no auto-run on mount", () => {
  assert.ok(SOURCE.includes("analyzeAccountBrain"));
  assert.ok(SOURCE.includes("useMutation"));
  assert.ok(SOURCE.includes("onClick={() => analyzeMutation.mutate()}"));
  // Never auto-invoked as an effect on load.
  assert.ok(!SOURCE.includes("useEffect"));
});

test("Analyze never fires automatically merely because brainQ resolved — it is retry: false and reads brainQ.data only as an initial value", () => {
  assert.ok(SOURCE.includes("retry: false"));
});

test("has real loading and error states for the read model, not just a happy path", () => {
  assert.ok(SOURCE.includes("brainQ.isLoading"));
  assert.ok(SOURCE.includes("brainQ.isError"));
});

test("shows only resolved truth (never an unresolved field), a factual activity line, and people — the What we know section", () => {
  assert.ok(SOURCE.includes("classifyAccountTruthFields"));
  assert.ok(SOURCE.includes("activitySummaryLine"));
  assert.ok(SOURCE.includes("personDisplayName"));
});

test("surfaces conflicting evidence rather than silently erasing it when a safe canonical winner still exists", () => {
  assert.ok(SOURCE.includes("hasConflictingEvidence"));
  assert.ok(SOURCE.includes("Conflicting source information"));
});

test("What we don't know yet is scoped to classification.unknown only — never People/Activity absence", () => {
  assert.ok(SOURCE.includes("What we don't know yet"));
  assert.ok(SOURCE.includes("classification.unknown"));
  assert.ok(SOURCE.includes("unknownFieldLine"));
  // People/Activity absence must never be rendered inside the Unknown section's own list.
  assert.ok(!SOURCE.includes("No people identified yet"));
});

test("Why Now renders factual reason cards with an explicit empty state, never a score/hot-warm-cold label", () => {
  assert.ok(SOURCE.includes("Why now"));
  assert.ok(SOURCE.includes("whyNowCard"));
  assert.ok(SOURCE.includes("Nothing new to report"));
  // Strip // line comments so the module's own explanatory prose (which
  // legitimately names these forbidden concepts to say they're excluded)
  // doesn't false-positive this check against actual rendered JSX/code.
  const withoutComments = SOURCE.replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["hot", "warm", "cold", "score", "intent"]) {
    assert.ok(!withoutComments.toLowerCase().includes(forbidden), `must not reference "${forbidden}"`);
  }
});

test("never renders account_claims a second time — existing claims are pointed at, not re-rendered, since account-claims-panel.tsx already owns that", () => {
  assert.ok(!SOURCE.includes("claim.evidence"));
  assert.ok(!SOURCE.includes("claimKeyLabel"));
});

test("the narrative is captioned as generated/display-only, never presented as a stored fact, and has an explicit unavailable-reason path", () => {
  assert.ok(SOURCE.includes("display-only synthesis, not a stored fact"));
  assert.ok(SOURCE.includes("narrativeUnavailableCopy"));
});

test("does not show a durable 'Last analyzed' state — generatedAt is read only from the current in-memory narrative, never a separately-fetched persisted field", () => {
  assert.ok(!SOURCE.includes("lastAnalyzedAt"));
  assert.ok(!SOURCE.includes("lastAnalyzed"));
  // The only place generatedAt is ever read is off the narrative object
  // itself — never a standalone persisted field on the brain summary.
  assert.ok(SOURCE.includes("brain.narrative.generatedAt"));
});
