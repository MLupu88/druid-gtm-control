// Source-level regression guard for evaluation-runs-list.tsx, mirroring
// ../lib/accounts-api.limit.test.ts's approach (no jsdom/testing-library
// in this package, so this checks the literal source rather than a
// render). Behavioral grouping/labeling logic is tested directly in
// ../lib/evaluation-runs-presentation.test.ts; this file only guards the
// component's wiring and business-facing copy.
//
// Run with: tsx --test src/components/evaluation-runs-list.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "evaluation-runs-list.tsx",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

test("the section is titled 'Evaluation runs', not the old 'Evaluation history'", () => {
  const source = readSource();
  assert.ok(source.includes("Evaluation runs"));
  assert.ok(!source.includes("Evaluation history"));
});

test("official and preview runs are visually distinguished via a badge", () => {
  const source = readSource();
  assert.ok(source.includes('"Official"'));
  assert.ok(source.includes('"Preview"'));
  assert.ok(source.includes("isOfficial"));
});

test("official evaluations are always rendered directly, never inside the collapsible group", () => {
  const source = readSource();
  const officialBlockStart = source.indexOf("Official evaluations");
  const accordionStart = source.indexOf("<Accordion");
  assert.ok(officialBlockStart > -1);
  assert.ok(accordionStart > -1);
  assert.ok(officialBlockStart < accordionStart, "official evaluations must render before the collapsible group, outside it");
});

test("the latest preview is shown prominently, outside the collapsible group", () => {
  const source = readSource();
  const latestBlockStart = source.indexOf("Latest preview");
  const accordionStart = source.indexOf("<Accordion");
  assert.ok(latestBlockStart > -1 && latestBlockStart < accordionStart);
});

test("older previews are grouped under a labeled, collapsible 'Previous preview runs (N)' section — count is real, not hardcoded", () => {
  const source = readSource();
  assert.ok(source.includes("Previous preview runs ({olderPreviews.length})"));
  assert.ok(source.includes("<Accordion"));
});

test("nothing is deleted/mutated — the component only groups the caller's existing evaluations array via the pure groupEvaluationRuns helper", () => {
  const source = readSource();
  assert.ok(source.includes("groupEvaluationRuns(evaluations)"));
  assert.ok(!source.includes("DELETE"));
  assert.ok(!source.includes("useMutation"));
});

test("each run shows mode, profile name/version, timestamp, fit band, intent band, and eligibility", () => {
  const source = readSource();
  assert.ok(source.includes("resolveEvaluationProfileInfo"));
  assert.ok(source.includes("formatDateTime(evaluation.createdAt)"));
  assert.ok(source.includes("Fit band:"));
  assert.ok(source.includes("Intent band:"));
  assert.ok(source.includes("eligibilityLabel(evaluation.eligibilityOutcome)"));
});

test("raw evaluation/profile-version ids and band codes are confined to TechnicalDetails", () => {
  const source = readSource();
  const technicalStart = source.indexOf("<TechnicalDetails>");
  assert.ok(technicalStart > -1);
  const beforeTechnical = source.slice(0, technicalStart);
  assert.ok(!beforeTechnical.includes("{evaluation.id}"));
  assert.ok(!beforeTechnical.includes("{evaluation.profileVersionId}"));
});

test("shows the legacy starter warning when the evaluation's snapshot matches the legacy signature", () => {
  const source = readSource();
  assert.ok(source.includes("isLegacyStarterIcpConfig(evaluation.profileConfigSnapshot)"));
  assert.ok(source.includes("<LegacyStarterWarning"));
});

test("an empty evaluations array still shows a truthful empty state, not a broken/blank section", () => {
  const source = readSource();
  assert.ok(source.includes("No evaluations recorded yet."));
});

test("band terminology is used, not 'tier', in this component's own business-facing copy", () => {
  const source = readSource();
  assert.ok(!/\btier\b/i.test(source.replace(/humanizeTierLabel|fitTier|intentTier|evaluationRunsList|profileVersionId/gi, "")));
});
