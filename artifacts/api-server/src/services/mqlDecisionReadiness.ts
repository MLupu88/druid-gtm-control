// API-server wrapper around @workspace/evaluator's pure
// evaluateMqlDecisionReadiness — this is the ONLY place that knows what a
// snapshot `source` string means in terms of evidence. The evaluator
// package itself never sees or interprets a snapshot source; it only
// receives an already-resolved set of evidence-backed field paths (see
// mqlDecisionReadiness.ts's module comment there).
//
// "official_evaluation_required" and "snapshot_evidence_unknown" are
// decided here, not inside the pure classifier, because both require
// DB-row context (evaluation status/mode, snapshot source) the evaluator
// package deliberately has no concept of.

import {
  evaluateMqlDecisionReadiness,
  IcpProfileConfigV1Schema,
  type MqlDecisionReadiness,
} from "@workspace/evaluator";
import type { AccountEvaluation, AccountSnapshot } from "@workspace/db/schema";
import { CURRENT_STATE_SNAPSHOT_SOURCE } from "./icpEvaluationResolvers.js";

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * gtm-account-current-state-v1's own builder (buildNormalizedAccountInputFromAccount,
 * icpEvaluationResolvers.ts) only ever writes a REAL value into
 * company.domain/company.name — every other field it sets is a truthful
 * "unknown" placeholder (false, true, "unknown", null, or an empty
 * array), never evidence, regardless of what value ended up stored.
 * Evidence-backedness for THIS source is therefore never a static field
 * list: it must be derived per-snapshot from the normalizedInput actually
 * persisted — company.domain/company.name each count as evidence-backed
 * only when they hold a non-blank string on this specific snapshot; a
 * null, undefined, empty, or whitespace-only value is not evidence, same
 * as any other unpopulated field on this snapshot.
 */
function evidenceBackedFieldsForCurrentStateSnapshot(
  normalizedInput: Record<string, unknown>,
): ReadonlySet<string> {
  const fields = new Set<string>();
  const company = normalizedInput.company;
  if (company && typeof company === "object") {
    const companyRecord = company as Record<string, unknown>;
    if (isNonBlankString(companyRecord.domain)) fields.add("company.domain");
    if (isNonBlankString(companyRecord.name)) fields.add("company.name");
  }
  return fields;
}

type EvidenceBackedFieldsResolver = (
  normalizedInput: Record<string, unknown>,
) => ReadonlySet<string>;

// The single source of truth for "which fields are evidence-backed for a
// given snapshot source, given this specific snapshot's actual data."
// Today there is exactly one recognized source. Any snapshot source not
// listed here is unrecognized and fails closed (see
// deriveMqlDecisionReadiness below) — this map is never used to silently
// widen what counts as evidence for a source it doesn't already know.
const EVIDENCE_BACKED_FIELDS_RESOLVER_BY_SNAPSHOT_SOURCE: Readonly<
  Record<string, EvidenceBackedFieldsResolver>
> = {
  [CURRENT_STATE_SNAPSHOT_SOURCE]: evidenceBackedFieldsForCurrentStateSnapshot,
};

type EvaluationForReadiness = Pick<
  AccountEvaluation,
  "status" | "evaluationMode" | "profileConfigSnapshot"
>;
type SnapshotForReadiness = Pick<AccountSnapshot, "source" | "normalizedInput">;

/**
 * Derives MQL decision-readiness for one evaluation candidate.
 *
 *   - `evaluation === null` (or not completed+production): the account has
 *     no official evaluation to record an MQL decision against at all ->
 *     official_evaluation_required. This subsumes (does not replace) the
 *     existing completed+production check in accountDecisions.ts's
 *     createAccountDecision — this function is also called from read-only
 *     display paths where that check has not already run.
 *   - the evaluation is eligible but its snapshot's `source` is not a
 *     recognized evidence-backed source: snapshot_evidence_unknown,
 *     fail-closed, no per-field detail is possible.
 *   - otherwise: derives this specific snapshot's evidence-backed field
 *     set (never a static list — see evidenceBackedFieldsForCurrentStateSnapshot
 *     above) and delegates entirely to @workspace/evaluator's pure
 *     evaluateMqlDecisionReadiness, passing the frozen profileConfigSnapshot
 *     and the frozen normalizedInput — never re-deriving scoring/tiering/
 *     eligibility itself.
 */
export function deriveMqlDecisionReadiness(
  evaluation: EvaluationForReadiness | null,
  snapshot: SnapshotForReadiness | null,
): MqlDecisionReadiness {
  if (
    !evaluation ||
    evaluation.status !== "completed" ||
    evaluation.evaluationMode !== "production"
  ) {
    return {
      ready: false,
      reasons: [
        {
          code: "official_evaluation_required",
          message:
            "This account has no completed, production official evaluation yet, so a Promote to MQL decision cannot be recorded.",
        },
      ],
    };
  }

  if (!snapshot) {
    // A completed, production account_evaluations row always references a
    // real account_snapshots row (account_evaluations_account_matches_snapshot
    // + the NOT NULL snapshot_id FK) — a caller reaching this branch failed
    // to fetch it, which is a caller bug, not a legitimate readiness state.
    throw new Error(
      "deriveMqlDecisionReadiness: evaluation is completed/production but no snapshot was supplied.",
    );
  }

  const resolveEvidenceBackedFields =
    EVIDENCE_BACKED_FIELDS_RESOLVER_BY_SNAPSHOT_SOURCE[snapshot.source];
  if (!resolveEvidenceBackedFields) {
    return {
      ready: false,
      reasons: [
        {
          code: "snapshot_evidence_unknown",
          message: `The snapshot source "${snapshot.source}" is not a recognized evidence-backed source, so this evaluation cannot be trusted for an MQL decision.`,
        },
      ],
    };
  }

  const parsedConfig = IcpProfileConfigV1Schema.safeParse(
    evaluation.profileConfigSnapshot,
  );
  if (!parsedConfig.success) {
    throw new Error(
      "deriveMqlDecisionReadiness: evaluation.profileConfigSnapshot failed IcpProfileConfigV1Schema validation.",
    );
  }

  const normalizedInput = snapshot.normalizedInput as Record<string, unknown>;
  const evidenceBackedFields = resolveEvidenceBackedFields(normalizedInput);

  return evaluateMqlDecisionReadiness(
    parsedConfig.data,
    normalizedInput,
    evidenceBackedFields,
  );
}
