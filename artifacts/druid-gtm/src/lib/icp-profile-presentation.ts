// Pure presentation helpers for the Settings → ICP Profiles surface
// (../pages/settings-icp-profiles.tsx, ../pages/icp-profile-detail.tsx).
// Kept separate from those components so badge derivation, "last
// updated" resolution, config summarization, and default-version
// selection are unit-testable without a DOM (this package has no
// jsdom/testing-library — see ../lib/accounts-api.limit.test.ts), and so
// the pages themselves stay thin rendering layers over these — same
// convention as ./icp-preview-presentation.ts.
//
// Nothing here imports @workspace/evaluator: this is the read-only
// foundation slice, and every function below reads `config` (typed
// `unknown` on the wire — see ./icp-profiles-api.ts's IcpProfileVersion)
// defensively, by structural duck-typing only. A future draft-editor
// slice that needs the exact IcpProfileConfigV1 schema (for real
// validation, not just counting) is expected to add that dependency
// then, not here.

import type {
  IcpProfileListItem,
  IcpProfileVersion,
  IcpProfileVersionStatus,
  ProfileClassification,
  TargetCriterion,
} from "./icp-profiles-api";
import { humanizeFieldLabel } from "./icp-profile-config-validation";

// ---------------------------------------------------------------------
// List-page badges. Deliberately independent literal union (not imported
// from ../components/ui/badge.tsx) — same pattern already established by
// ../components/account-icp-preview-panel.tsx's eligibilityBadgeVariant.
// ---------------------------------------------------------------------
export type ProfileBadgeVariant = "default" | "secondary" | "outline";

export interface ProfileBadge {
  key: string;
  label: string;
  variant: ProfileBadgeVariant;
}

// Every badge here is derived only from fields IcpProfileListItem already
// carries — no additional fetch, no guessing. "Latest published" is
// deliberately omitted when it would just restate "Active" (same version
// id) — showing both would be redundant, not clarifying, mirroring
// ../pages/accounts.tsx's AccountRow's identical "productionDiffers" guard
// for latestEvaluation vs latestProductionEvaluation.
export function deriveProfileBadges(
  profile: Pick<
    IcpProfileListItem,
    "activeVersion" | "draftVersion" | "latestVersion" | "archivedAt"
  >,
): ProfileBadge[] {
  const badges: ProfileBadge[] = [];

  if (profile.activeVersion) {
    badges.push({
      key: "active",
      label: `Active · v${profile.activeVersion.versionNumber}`,
      variant: "default",
    });
  }

  if (profile.draftVersion) {
    badges.push({
      key: "draft",
      label: "Draft in progress",
      variant: "secondary",
    });
  }

  const latestIsAlreadyActive =
    !!profile.activeVersion &&
    !!profile.latestVersion &&
    profile.latestVersion.id === profile.activeVersion.id;
  if (
    profile.latestVersion &&
    profile.latestVersion.status === "published" &&
    !latestIsAlreadyActive
  ) {
    badges.push({
      key: "latest-published",
      label: `Latest published · v${profile.latestVersion.versionNumber}`,
      variant: "outline",
    });
  }

  if (profile.archivedAt) {
    badges.push({ key: "archived", label: "Archived", variant: "outline" });
  }

  return badges;
}

// ---------------------------------------------------------------------
// "Last updated" — icpProfiles has no updatedAt column of its own (see
// lib/db/src/schema/icpProfiles.ts); the truest available proxy is
// whichever is more recent of the profile's own createdAt and its
// highest-versionNumber version's createdAt (a new draft or publish is
// the only way a profile's state actually changes). ISO-8601 timestamps
// compare correctly as plain strings, so no Date parsing is needed here
// — the caller formats the returned ISO string for display.
// ---------------------------------------------------------------------
export function latestProfileActivityAt(
  profile: Pick<IcpProfileListItem, "createdAt" | "latestVersion">,
): string {
  const candidates = [profile.latestVersion?.createdAt, profile.createdAt].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return candidates.reduce((latest, candidate) =>
    candidate > latest ? candidate : latest,
  );
}

// ---------------------------------------------------------------------
// Version status humanization — "draft"/"published" are already plain
// English, but routed through one function anyway so a future status
// value (or copy change) has exactly one place to update, matching
// ./icp-preview-presentation.ts's humanizeTierLabel/humanizeDimension
// pattern.
// ---------------------------------------------------------------------
export function humanizeVersionStatus(status: IcpProfileVersionStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "published":
      return "Published version";
  }
}

// ---------------------------------------------------------------------
// Default version selection for the detail page — prefers the active
// version (what's actually driving evaluations today), falls back to the
// draft (what's being worked on), falls back to the highest version
// number (the most recent historical state), and only returns null when
// there is truly nothing to show.
// ---------------------------------------------------------------------
export function selectDefaultVersionId(
  versions: Pick<IcpProfileVersion, "id" | "status" | "versionNumber">[],
  activeVersionId: string | null,
): string | null {
  if (activeVersionId && versions.some((v) => v.id === activeVersionId)) {
    return activeVersionId;
  }
  const draft = versions.find((v) => v.status === "draft");
  if (draft) return draft.id;
  if (versions.length === 0) return null;
  return versions.reduce((latest, v) =>
    v.versionNumber > latest.versionNumber ? v : latest,
  ).id;
}

// ---------------------------------------------------------------------
// Config summarization — counts only, never the rules/conditions
// themselves (those stay inside collapsed TechnicalDetails as raw JSON
// in the page component). Defensive over genuinely unknown jsonb input,
// same discipline as ./icp-preview-presentation.ts's
// categorizeMissingInputs: a count is `null` (not 0) whenever the
// underlying array can't be verified to exist, so the UI can truthfully
// say "not available" instead of falsely implying "zero rules".
// ---------------------------------------------------------------------
export interface VersionConfigSummary {
  fitRuleCount: number | null;
  fitTierCount: number | null;
  intentRuleCount: number | null;
  intentTierCount: number | null;
  actionabilityRuleCount: number | null;
  hardDisqualifierCount: number | null;
  restrictionCount: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayLengthOrNull(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

// ---------------------------------------------------------------------
// Classification labels + compact plain-language target summary. Both
// are pure presentation over fields the list endpoint already computes
// server-side (see artifacts/api-server/src/services/icpProfiles.ts's
// buildProfileListItem and @workspace/evaluator's
// classifyProfileConfig/targetCriteria) — nothing here re-derives a
// classification or re-inspects rules, and no points, thresholds, or
// technical rule counts are ever shown.
// ---------------------------------------------------------------------

export const PROFILE_CLASSIFICATION_LABELS: Record<ProfileClassification, string> = {
  no_active_definition: "No active definition",
  legacy_starter: "Legacy starter",
  incomplete: "Incomplete",
  fit_only: "Fit-only",
  fit_plus_intent: "Fit + intent",
};

export function classificationLabel(classification: ProfileClassification): string {
  return PROFILE_CLASSIFICATION_LABELS[classification];
}

// Reuses the existing 3-variant ProfileBadgeVariant union (see
// deriveProfileBadges above) rather than inventing a fourth "warning"
// color — "legacy_starter" and "incomplete" both signal "this profile
// needs attention before it does anything useful", so both get the same
// non-default treatment as an ordinary secondary badge; "fit_plus_intent"
// is the only classification that earns the primary/default treatment.
export function classificationBadgeVariant(
  classification: ProfileClassification,
): ProfileBadgeVariant {
  switch (classification) {
    case "fit_plus_intent":
      return "default";
    case "fit_only":
      return "outline";
    case "legacy_starter":
    case "incomplete":
      return "secondary";
    case "no_active_definition":
      return "outline";
  }
}

// Oxford-style join ("Banking", "Banking or Insurance", "Banking,
// Insurance, or Healthcare") — mirrors ../lib/icp-profile-business-
// summary.ts's identical private helper; kept separate here rather than
// imported so this module's own stated independence from rule-editing
// concerns stays intact.
function joinValuesAsProse(values: (string | number | boolean)[]): string {
  const formatted = values.map((value) =>
    typeof value === "boolean" ? (value ? "true" : "false") : String(value),
  );
  if (formatted.length === 0) return "";
  if (formatted.length === 1) return formatted[0]!;
  if (formatted.length === 2) return `${formatted[0]} or ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, or ${formatted[formatted.length - 1]}`;
}

/** One short readable clause per criterion, e.g. "Industry: Banking or Insurance" — field label plus its actually configured values, nothing invented. */
export function describeTargetCriterion(criterion: TargetCriterion): string {
  return `${humanizeFieldLabel(criterion.field)}: ${joinValuesAsProse(criterion.values)}`;
}

/**
 * Compact plain-language target summary for the profile-library list —
 * one clause per configured target criterion, joined for a single-line
 * display. Null when there are no simple, directly supported target
 * criteria yet — never a fabricated "no criteria" sentence; callers
 * should render their own truthful empty state for that case.
 */
export function buildTargetSummary(criteria: TargetCriterion[]): string | null {
  if (criteria.length === 0) return null;
  return criteria.map(describeTargetCriterion).join(" · ");
}

// Truthful fallback text for the target-summary line when
// buildTargetSummary() has nothing to show — one per classification, so
// the reason is always specific ("no active version" reads differently
// from "this profile is the legacy starter" or "criteria are too
// advanced to summarize compactly"), never a single generic "—".
const TARGET_SUMMARY_FALLBACKS: Record<ProfileClassification, string> = {
  no_active_definition: "No active target definition",
  legacy_starter: "Legacy starter only checks that a company domain exists",
  incomplete: "No meaningful target company criteria configured",
  fit_only: "Target criteria use advanced rules — open the profile to review",
  fit_plus_intent: "Target criteria use advanced rules — open the profile to review",
};

export function targetSummaryFallback(classification: ProfileClassification): string {
  return TARGET_SUMMARY_FALLBACKS[classification];
}

/**
 * The complete display line the profile-library list should render in
 * the target-summary position — callers render this string directly,
 * with no further prefixing or null-check/fallback branching of their
 * own:
 *   - criteria exist: "Targets: " + buildTargetSummary()'s compact summary.
 *   - no criteria: the classification-specific fallback, unprefixed
 *     (it's already a complete sentence, e.g. "No active target
 *     definition" — prepending "Targets:" to it would read oddly).
 */
export function describeProfileTargetSummary(
  profile: Pick<IcpProfileListItem, "classification" | "targetCriteria">,
): string {
  const summary = buildTargetSummary(profile.targetCriteria);
  return summary !== null ? `Targets: ${summary}` : targetSummaryFallback(profile.classification);
}

// Returns null (not a summary of all-nulls) when `config` itself isn't
// even a recognizable object — the one case where nothing at all can be
// said about it truthfully.
export function summarizeVersionConfig(config: unknown): VersionConfigSummary | null {
  if (!isRecord(config)) return null;

  const fit = isRecord(config.fit) ? config.fit : null;
  const intent = isRecord(config.intent) ? config.intent : null;
  const actionability = isRecord(config.actionability) ? config.actionability : null;
  const eligibility = isRecord(config.eligibility) ? config.eligibility : null;

  return {
    fitRuleCount: fit ? arrayLengthOrNull(fit.rules) : null,
    fitTierCount: fit ? arrayLengthOrNull(fit.tiers) : null,
    intentRuleCount: intent ? arrayLengthOrNull(intent.rules) : null,
    intentTierCount: intent ? arrayLengthOrNull(intent.tiers) : null,
    actionabilityRuleCount: actionability
      ? arrayLengthOrNull(actionability.rules)
      : null,
    hardDisqualifierCount: eligibility
      ? arrayLengthOrNull(eligibility.hardDisqualifiers)
      : null,
    restrictionCount: eligibility ? arrayLengthOrNull(eligibility.restrictions) : null,
  };
}
