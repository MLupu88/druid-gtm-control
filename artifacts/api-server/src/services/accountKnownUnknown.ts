// Milestone 4C — pure classification of Account Truth fields into
// exactly three buckets. No DB, no network.
//
// KNOWN: canonicalValue !== null — a real value is on record, whether
// resolved cleanly (single_source/agreement) or resolved DESPITE
// disagreement (conflict with a safe winner). hasConflictingEvidence
// distinguishes the latter so the UI can truthfully say "here's the
// answer, but sources disagree" rather than silently erasing the
// disagreement — see accountBrainSummary.ts's own module comment on why
// this must never be dropped merely because a policy found a winner.
//
// CONFLICTING (no safe answer): resolutionState === 'conflict' AND
// canonicalValue === null — real evidence exists and disagrees, with no
// safe pick. Distinct from Unknown: this is not "nothing recorded," it's
// "recorded and contradictory."
//
// UNKNOWN: resolutionState === 'unresolved'. Per the M4/4C product
// correction, Unknown is scoped to ONLY this existing, closed,
// already-canonical Account Truth vocabulary (RESOLVED_FACT_CANONICAL_FIELDS)
// — People/Activity absence is a factual state of Mission Control's own
// evidence, not an "Unknown," and is presented under What We Know
// instead (see ../../artifacts/druid-gtm/src/components/account-brain-panel.tsx).
// No DRUID-specific knowledge slots are added here.

import type { AccountTruthFieldDTO } from "./accountTruth.js";
import type { ResolvedFactCanonicalField } from "@workspace/db/schema";

export interface AccountTruthClassification {
  known: (AccountTruthFieldDTO & { hasConflictingEvidence: boolean })[];
  conflicting: AccountTruthFieldDTO[];
  unknown: ResolvedFactCanonicalField[];
}

export function classifyAccountTruth(
  fields: readonly AccountTruthFieldDTO[],
): AccountTruthClassification {
  const known: AccountTruthClassification["known"] = [];
  const conflicting: AccountTruthFieldDTO[] = [];
  const unknown: ResolvedFactCanonicalField[] = [];

  for (const field of fields) {
    if (field.canonicalValue !== null) {
      known.push({ ...field, hasConflictingEvidence: field.resolutionState === "conflict" });
    } else if (field.resolutionState === "conflict") {
      conflicting.push(field);
    } else {
      unknown.push(field.canonicalField);
    }
  }

  return { known, conflicting, unknown };
}
