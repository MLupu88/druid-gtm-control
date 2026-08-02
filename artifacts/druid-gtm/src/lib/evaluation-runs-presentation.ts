// Pure grouping/labeling logic for the account detail "Evaluation runs"
// section (../components/evaluation-runs-list.tsx). Operates only on the
// already-fetched AccountEvaluation[] and IcpProfileListItem[] — never
// deletes, deduplicates, merges, or mutates a row; this is a read-only
// presentation-layer reorganization of exactly the same records the old
// "Evaluation history" list showed.

import type { AccountEvaluation } from "./accounts-api";
import type { IcpProfileListItem } from "./icp-profiles-api";

function shortId(id: string): string {
  return id.slice(0, 8);
}

export interface EvaluationProfileInfo {
  /** Null when the referenced version doesn't match any currently-loaded profile's active/draft/latest version (e.g. an older superseded version) — never guessed. */
  profileName: string | null;
  versionLabel: string;
}

/**
 * Resolves a human profile name + version label for an evaluation's
 * profileVersionId, reusing the SAME profiles list already loaded
 * elsewhere on this page (see ../lib/icp-profiles-api.ts's
 * fetchIcpProfiles/icpProfilesListQueryKey) — no new fetch is added for
 * this. Matches against each profile's active/draft/latest version
 * summaries only (the list endpoint carries no full version history), so
 * an evaluation run against a version that's since been superseded and
 * isn't any of those three falls back to a truthful short-id label
 * rather than a guessed name.
 */
export function resolveEvaluationProfileInfo(
  evaluation: Pick<AccountEvaluation, "profileVersionId">,
  profiles: IcpProfileListItem[],
): EvaluationProfileInfo {
  for (const profile of profiles) {
    if (profile.draftVersion && profile.draftVersion.id === evaluation.profileVersionId) {
      return {
        profileName: profile.name,
        versionLabel: `Draft version · v${profile.draftVersion.versionNumber}`,
      };
    }
    if (profile.activeVersion && profile.activeVersion.id === evaluation.profileVersionId) {
      return {
        profileName: profile.name,
        versionLabel: `Active version · v${profile.activeVersion.versionNumber}`,
      };
    }
    if (profile.latestVersion && profile.latestVersion.id === evaluation.profileVersionId) {
      return {
        profileName: profile.name,
        versionLabel: `Latest published version · v${profile.latestVersion.versionNumber}`,
      };
    }
  }
  return { profileName: null, versionLabel: `Profile version ${shortId(evaluation.profileVersionId)}` };
}

export interface GroupedEvaluationRuns {
  /** Every production (official) evaluation, in the caller's existing order — never hidden or collapsed. */
  official: AccountEvaluation[];
  /** The single newest preview evaluation, or null if none exists. */
  latestPreview: AccountEvaluation | null;
  /** Every preview evaluation OTHER than latestPreview, in the caller's existing order — the full historical record, meant for a collapsed "Previous preview runs" group, never dropped. */
  olderPreviews: AccountEvaluation[];
}

/**
 * Groups (never filters out) an account's evaluations by mode, assuming
 * the caller's array is already ordered createdAt desc (see
 * services/accounts.ts's getAccountById / ../lib/accounts-api.ts's
 * AccountDetail.evaluations) so the first preview encountered is the
 * newest. Every row from the input appears in exactly one output group —
 * total count is always preserved.
 */
export function groupEvaluationRuns(evaluations: AccountEvaluation[]): GroupedEvaluationRuns {
  const official = evaluations.filter((e) => e.evaluationMode === "production");
  const previews = evaluations.filter((e) => e.evaluationMode === "preview");
  const [latestPreview, ...olderPreviews] = previews;
  return { official, latestPreview: latestPreview ?? null, olderPreviews };
}
