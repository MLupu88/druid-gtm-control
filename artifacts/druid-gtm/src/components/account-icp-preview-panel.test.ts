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

// ---------------------------------------------------------------------
// Official Account Evaluation UX
// ---------------------------------------------------------------------

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

function functionBlock(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > -1, `function ${name} must exist`);
  const nextFn = source.indexOf("\nfunction ", start + 1);
  const nextExport = source.indexOf("\nexport function ", start + 1);
  const candidates = [nextFn, nextExport].filter((i) => i > -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("uses a clearly named action — never a vague label like Save preview / Accept preview / Make official / Recalculate score", () => {
  const source = readSource();
  assert.ok(source.includes("Run and save official evaluation"));
  for (const vague of ["Save preview", "Accept preview", "Make official", "Recalculate score"]) {
    assert.ok(!source.includes(vague), `must not use the vague label "${vague}"`);
  }
});

test("the official action always runs a fresh evaluation — it is never fed previewMutation.data", () => {
  const source = readSource();
  // handleConfirmOfficial is a short, nested function (inside
  // AccountIcpPreviewPanel) — sliced to its own 3-line body precisely,
  // rather than to "the next top-level function" (which would run past
  // the end of the component and wrongly capture unrelated JSX that
  // legitimately does reference previewMutation.data elsewhere).
  const start = source.indexOf("function handleConfirmOfficial(");
  assert.ok(start > -1);
  const end = source.indexOf("const hasComparablePreview", start);
  assert.ok(end > start);
  const block = source.slice(start, end);
  assert.ok(block.includes("officialMutation.mutate(selectedProfileId)"));
  assert.ok(!block.includes("previewMutation.data"));
  // The mutation itself only ever takes a profileId — never the
  // preview's own evaluation object.
  const mutationBlock = source.slice(
    source.indexOf("const officialMutation = useMutation"),
    source.indexOf("const profiles = profilesQ.data"),
  );
  assert.ok(mutationBlock.includes("runAccountIcpOfficialEvaluation(accountId, profileId)"));
  assert.ok(!mutationBlock.includes("previewMutation.data"));
});

test("explicit confirmation is required — the action opens a dialog rather than mutating directly on click", () => {
  const source = readSource();
  assert.ok(source.includes("setOfficialConfirmOpen(true)"));
  assert.ok(source.includes("<ConfirmOfficialEvaluationDialog"));
});

test("confirmation copy states that a fresh server-side evaluation runs, using the active published version and current account data", () => {
  const block = functionBlock(readSource(), "ConfirmOfficialEvaluationDialog");
  assert.ok(block.includes("brand new evaluation on the server"));
  assert.ok(block.includes("currently active,"));
  assert.ok(block.includes("published version"));
  assert.ok(block.includes("account&apos;s current canonical data"));
  assert.ok(block.includes("saved permanently"));
});

test("confirmation copy states the official result may differ from the preview", () => {
  const block = functionBlock(readSource(), "ConfirmOfficialEvaluationDialog");
  assert.ok(block.includes("may differ from it"));
});

test("double submission is prevented — the action and the dialog's confirm button are both disabled while a request is in flight", () => {
  const source = readSource();
  assert.ok(source.includes("officialMutation.isPending"));
  assert.ok(source.includes("disabled={!canRunOfficial}"));
  const dialogBlock = functionBlock(source, "ConfirmOfficialEvaluationDialog");
  assert.ok(dialogBlock.includes("disabled={isPending}"));
});

test("eligibility is derived from the profile's real active-version data, not guessed — disabled when no active published version exists", () => {
  const source = readSource();
  assert.ok(source.includes("selectedProfile?.activeVersion"));
  assert.ok(source.includes("Publish and activate a version of this profile to run an official evaluation."));
  // Never blocked merely because the preview is stale/absent — the
  // disabled-reason derivation must not reference previewMutation at all.
  const reasonBlock = source.slice(
    source.indexOf("const officialDisabledReason"),
    source.indexOf("const canRunOfficial"),
  );
  assert.ok(!reasonBlock.includes("previewMutation"));
});

test("the blocked-official-evaluation state includes a direct CTA to that profile's settings page, only when the block is specifically the missing-active-version case", () => {
  const source = readSource();
  assert.ok(source.includes("officialBlockedByMissingActiveVersion"));
  assert.ok(source.includes("Open ICP profile"));
  assert.ok(source.includes("`/settings/icp-profiles/${selectedProfile.id}`"));
});

test("on success, account detail and decision queries are both invalidated — evaluation history and decision availability both flow from account detail", () => {
  const source = readSource();
  const onSuccessBlock = source.slice(
    source.indexOf("const officialMutation = useMutation"),
    source.indexOf("const profiles = profilesQ.data"),
  );
  assert.ok(onSuccessBlock.includes("accountDetailQueryKey(accountId)"));
  assert.ok(onSuccessBlock.includes("accountDecisionsQueryKey(accountId)"));
});

test("on failure, nothing about the preview mutation or its state is touched — no onError handler resets it", () => {
  const source = readSource();
  const mutationBlock = source.slice(
    source.indexOf("const officialMutation = useMutation"),
    source.indexOf("const profiles = profilesQ.data"),
  );
  assert.ok(!mutationBlock.includes("onError"));
  assert.ok(!mutationBlock.includes("previewMutation.reset"));
});

test("failures show a human-readable error, not a raw backend message, for the known no_active_profile_version case", () => {
  const block = functionBlock(readSource(), "OfficialEvaluationErrorState");
  assert.ok(block.includes("no_active_profile_version"));
  assert.ok(block.includes("Publish and activate a version"));
});

test("no fake/optimistic history entry is ever created — no local evaluation-history array is declared or appended to (technicalLines.push is pre-existing, unrelated collection of tier/rule labels, not a history list)", () => {
  const source = readSource();
  assert.ok(!/evaluations\s*=\s*\[/.test(source));
  assert.ok(!/useState<AccountEvaluation\[\]>/.test(source));
  // The only way the evaluation history list changes is via the real
  // account-detail query being invalidated (see the success test above)
  // — this file never maintains its own parallel list of evaluations.
  assert.ok(!source.includes("setEvaluations"));
});

test("no automatic decision is ever recorded from this file — it never calls createAccountDecision", () => {
  const source = readSource();
  assert.ok(!source.includes("createAccountDecision"));
  assert.ok(!source.includes("routingOutput"));
});

test("never claims that activating a profile automatically re-scores/re-evaluates existing accounts", () => {
  const source = readSource();
  for (const phrase of ["automatically re-scor", "automatically re-evaluat", "accounts have been re-scored"]) {
    assert.ok(!source.toLowerCase().includes(phrase.toLowerCase()), `must not claim "${phrase}"`);
  }
});

test("the official result displays the actual persisted profile version, timestamp, and evaluation ID — all real fields, nothing invented", () => {
  const block = functionBlock(readSource(), "OfficialEvaluationResult");
  assert.ok(block.includes("describeProfileVersion(evaluation, profile)"));
  assert.ok(block.includes("formatDateTime(evaluation.createdAt)"));
  assert.ok(block.includes("Evaluation ID: {evaluation.id}"));
  // Never fabricated fields.
  for (const invented of ["confidence", "impact", "changedAccounts", "affectedAccounts"]) {
    assert.ok(!block.toLowerCase().includes(invented.toLowerCase()));
  }
});

test("the official evaluation reuses the exact same result-rendering components as preview (CompletedEvaluationDetails/FailedEvaluationState), no duplicated rendering logic", () => {
  const block = functionBlock(readSource(), "OfficialEvaluationResult");
  assert.ok(block.includes("<CompletedEvaluationDetails"));
  assert.ok(block.includes("<FailedEvaluationState"));
});

// ---------------------------------------------------------------------
// Hotfix: truthful preview copy — a preview IS persisted (evaluationMode
// "preview" in account_evaluations) and appears in evaluation runs; it
// only can't back a decision. The old "not saved"/"NOT SAVED" claims
// were false and must be fully gone.
// ---------------------------------------------------------------------

test("no false 'not saved' claim remains anywhere in this file, before or after running a preview", () => {
  const source = readSource();
  for (const falseClaim of ["not saved", "NOT SAVED", "This result is not saved"]) {
    assert.ok(
      !source.toLowerCase().includes(falseClaim.toLowerCase()),
      `must not claim "${falseClaim}" — a preview IS persisted`,
    );
  }
});

test("the post-run preview copy is truthful: recorded for reference, cannot back a decision, only an official evaluation can", () => {
  const block = functionBlock(readSource(), "PreviewResult");
  assert.ok(block.includes("recorded in the account&apos;s evaluation runs"));
  assert.ok(block.includes("cannot be used to record a decision"));
  assert.ok(block.includes("Only an official evaluation"));
});

test("the pre-run intro copy states the same truth as the post-run copy — recorded but never a decision", () => {
  const source = readSource();
  const introEnd = source.indexOf("{profilesQ.isLoading");
  const intro = source.slice(0, introEnd);
  assert.ok(intro.includes("recorded in the account&apos;s evaluation runs"));
  assert.ok(intro.includes("can never be used"));
});

// ---------------------------------------------------------------------
// Hotfix: presentation hierarchy — band is the primary business outcome,
// the weighted score is secondary metadata.
// ---------------------------------------------------------------------

test("fit and intent bands are the primary rendered outcome; the numeric score is shown as secondary, explicitly labeled a weighted score", () => {
  const block = functionBlock(readSource(), "CompletedEvaluationDetails");
  assert.ok(block.includes("fitBand.label"));
  assert.ok(block.includes("intentBand.label"));
  assert.ok(block.includes("formatScorePoints(evaluation.fitScore)"));
  assert.ok(block.includes("formatScorePoints(evaluation.intentScore)"));
});

test("ability to act shows a derived user-facing state, never a bare '0 points' as the conclusion", () => {
  const block = functionBlock(readSource(), "CompletedEvaluationDetails");
  assert.ok(block.includes("deriveActionabilityState"));
  assert.ok(block.includes("ACTIONABILITY_STATE_LABELS[actionabilityState]"));
});

// ---------------------------------------------------------------------
// Hotfix: identity-not-person-addressable restriction clarification
// ---------------------------------------------------------------------

test("shows the clarified 'Restricted for automated outreach' explanation specifically when the identity-not-person-addressable rule fired", () => {
  const block = functionBlock(readSource(), "CompletedEvaluationDetails");
  assert.ok(block.includes("hasIdentityNotPersonAddressableRestriction"));
  assert.ok(block.includes("Restricted for automated outreach"));
  assert.ok(block.includes("No person-addressable contact is available yet"));
});

test("the eligibility badge always reflects the real eligibilityOutcome — never hardcoded to Eligible", () => {
  const block = functionBlock(readSource(), "CompletedEvaluationDetails");
  assert.ok(block.includes("eligibilityLabel(evaluation.eligibilityOutcome)"));
  assert.ok(block.includes("eligibilityBadgeVariant(evaluation.eligibilityOutcome)"));
});

// ---------------------------------------------------------------------
// Hotfix: legacy Starter ICP warning surfaces on preview/official results
// ---------------------------------------------------------------------

test("shows the legacy starter warning when the evaluation's own profileConfigSnapshot matches the legacy signature", () => {
  const block = functionBlock(readSource(), "CompletedEvaluationDetails");
  assert.ok(block.includes("isLegacyStarterIcpConfig(evaluation.profileConfigSnapshot)"));
  assert.ok(block.includes("<LegacyStarterWarning"));
});
