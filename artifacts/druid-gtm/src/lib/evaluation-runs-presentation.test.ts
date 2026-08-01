// Tests for ./evaluation-runs-presentation.ts. No DOM needed.
//
// Run with: tsx --test src/lib/evaluation-runs-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountEvaluation } from "./accounts-api.js";
import type { IcpProfileListItem } from "./icp-profiles-api.js";
import {
  resolveEvaluationProfileInfo,
  groupEvaluationRuns,
} from "./evaluation-runs-presentation.js";

function evaluation(overrides: Partial<AccountEvaluation> = {}): AccountEvaluation {
  return {
    id: "eval-1",
    accountId: "account-1",
    snapshotId: "snapshot-1",
    profileVersionId: "version-1",
    evaluatorVersionId: "evaluator-1",
    evaluationMode: "preview",
    status: "completed",
    errorDetail: null,
    fitScore: "20",
    fitTier: "qualified",
    intentScore: "0",
    intentTier: "no_observed_intent",
    identityResolutionLevel: "company",
    identityConfidence: "medium",
    actionabilityScore: "0",
    eligibilityOutcome: "eligible",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: null,
    profileConfigSnapshot: {},
    eligibilityRestrictions: [],
    hardDisqualifiers: [],
    scoreComponents: [],
    matchedRules: [],
    missingInputs: [],
    ...overrides,
  };
}

function profile(overrides: Partial<IcpProfileListItem> = {}): IcpProfileListItem {
  return {
    id: "profile-1",
    name: "Enterprise SaaS",
    description: null,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    createdBy: null,
    activeVersion: null,
    draftVersion: null,
    latestVersion: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// resolveEvaluationProfileInfo
// ---------------------------------------------------------------------

test("resolves the profile name and a draft-version label when the evaluation's version matches the profile's current draft", () => {
  const profiles = [
    profile({ draftVersion: { id: "version-1", versionNumber: 3, status: "draft", createdAt: "x", createdBy: null, publishedAt: null, notes: null } }),
  ];
  const info = resolveEvaluationProfileInfo(evaluation({ profileVersionId: "version-1" }), profiles);
  assert.equal(info.profileName, "Enterprise SaaS");
  assert.equal(info.versionLabel, "Draft version · v3");
});

test("resolves an active-version label when the evaluation's version matches the profile's active version", () => {
  const profiles = [
    profile({ activeVersion: { id: "version-2", versionNumber: 2, status: "published", createdAt: "x", createdBy: null, publishedAt: "x", notes: null } }),
  ];
  const info = resolveEvaluationProfileInfo(evaluation({ profileVersionId: "version-2" }), profiles);
  assert.equal(info.versionLabel, "Active version · v2");
});

test("falls back to a truthful short-id label when the version matches no currently-loaded profile", () => {
  const info = resolveEvaluationProfileInfo(
    evaluation({ profileVersionId: "00000000-aaaa-bbbb-cccc-ddddeeeeffff" }),
    [profile()],
  );
  assert.equal(info.profileName, null);
  assert.ok(info.versionLabel.startsWith("Profile version 00000000"));
});

// ---------------------------------------------------------------------
// groupEvaluationRuns
// ---------------------------------------------------------------------

test("groups official (production) evaluations separately from preview evaluations", () => {
  const official = evaluation({ id: "o1", evaluationMode: "production" });
  const preview = evaluation({ id: "p1", evaluationMode: "preview" });
  const grouped = groupEvaluationRuns([official, preview]);
  assert.deepEqual(grouped.official.map((e) => e.id), ["o1"]);
  assert.equal(grouped.latestPreview?.id, "p1");
});

test("the newest preview (first in array order) becomes latestPreview; the rest become olderPreviews, in order", () => {
  const p1 = evaluation({ id: "p1", evaluationMode: "preview" });
  const p2 = evaluation({ id: "p2", evaluationMode: "preview" });
  const p3 = evaluation({ id: "p3", evaluationMode: "preview" });
  const grouped = groupEvaluationRuns([p1, p2, p3]);
  assert.equal(grouped.latestPreview?.id, "p1");
  assert.deepEqual(grouped.olderPreviews.map((e) => e.id), ["p2", "p3"]);
});

test("every input row appears in exactly one output group — total count is preserved, nothing dropped", () => {
  const evals = [
    evaluation({ id: "o1", evaluationMode: "production" }),
    evaluation({ id: "p1", evaluationMode: "preview" }),
    evaluation({ id: "o2", evaluationMode: "production" }),
    evaluation({ id: "p2", evaluationMode: "preview" }),
    evaluation({ id: "p3", evaluationMode: "preview" }),
  ];
  const grouped = groupEvaluationRuns(evals);
  const total =
    grouped.official.length + (grouped.latestPreview ? 1 : 0) + grouped.olderPreviews.length;
  assert.equal(total, evals.length);
});

test("latestPreview is null (not undefined, not a fabricated row) when there are no preview evaluations at all", () => {
  const grouped = groupEvaluationRuns([evaluation({ id: "o1", evaluationMode: "production" })]);
  assert.equal(grouped.latestPreview, null);
  assert.deepEqual(grouped.olderPreviews, []);
});

test("an empty evaluations array produces empty groups, never an error", () => {
  const grouped = groupEvaluationRuns([]);
  assert.deepEqual(grouped.official, []);
  assert.equal(grouped.latestPreview, null);
  assert.deepEqual(grouped.olderPreviews, []);
});
