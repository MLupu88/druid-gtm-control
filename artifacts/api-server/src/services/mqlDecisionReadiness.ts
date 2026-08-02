// API-server wrapper around @workspace/evaluator's pure
// evaluateMqlDecisionReadiness — this is the ONLY place that knows what a
// snapshot `source` string means in terms of evidence. The evaluator
// package itself never sees or interprets a snapshot source; it only
// receives an already-resolved set of evidence-backed field paths (see
// mqlDecisionReadiness.ts's module comment there).
//
// "official_evaluation_required" and "snapshot_evidence_unknown" are
// decided here, not inside the pure classifier, because both require
// DB-row context (evaluation status/mode, snapshot source/accountId/
// rawInput) the evaluator package deliberately has no concept of.
//
// Each per-source resolver returns EITHER a validated set of
// evidence-backed field paths, OR `null` to mean "this snapshot's
// evidence cannot be trusted" — never derived from whether a
// normalizedInput value happens to be non-null/present. A resolver
// returning `null` is treated identically to an unrecognized snapshot
// source: both produce snapshot_evidence_unknown, never an ordinary
// per-rule "missing evidence" reason. This is deliberate: an internally
// inconsistent snapshot (e.g. a v2 envelope whose recorded value
// disagrees with normalizedInput, or whose account id doesn't match) is
// a trust failure, not an absence-of-evidence — conflating the two would
// let a corrupted/tampered snapshot masquerade as an ordinary "not yet
// confirmed" field.

import {
  evaluateMqlDecisionReadiness,
  IcpProfileConfigV1Schema,
  type MqlDecisionReadiness,
} from "@workspace/evaluator";
import type { AccountEvaluation, AccountSnapshot } from "@workspace/db/schema";
import {
  CURRENT_STATE_SNAPSHOT_SOURCE,
  CURRENT_STATE_V2_SNAPSHOT_SOURCE,
} from "./icpEvaluationResolvers.js";
import { AccountFactsSnapshotEvidenceV1Schema } from "./accountFactsSnapshotEvidence.js";

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readNormalizedField(
  normalizedInput: Record<string, unknown>,
  fieldPath: string,
): unknown {
  const [sectionKey, leafKey] = fieldPath.split(".");
  if (!sectionKey || !leafKey) return undefined;
  const section = normalizedInput[sectionKey];
  if (!section || typeof section !== "object") return undefined;
  return (section as Record<string, unknown>)[leafKey];
}

type EvaluationForReadiness = Pick<
  AccountEvaluation,
  "status" | "evaluationMode" | "profileConfigSnapshot"
>;
type SnapshotForReadiness = Pick<
  AccountSnapshot,
  "accountId" | "source" | "rawInput" | "normalizedInput"
>;

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
 *
 * UNCHANGED from before v2 existed: the classification logic and its
 * result for any v1 snapshot are byte-for-byte identical to before — only
 * the call surface adapts (receives the whole snapshot instead of a bare
 * normalizedInput parameter) so both resolvers can share one map type
 * with the v2 resolver below, which genuinely needs the whole snapshot.
 */
function evidenceBackedFieldsForCurrentStateSnapshot(
  snapshot: SnapshotForReadiness,
): ReadonlySet<string> {
  const normalizedInput = snapshot.normalizedInput as Record<string, unknown>;
  const fields = new Set<string>();
  const company = normalizedInput.company;
  if (company && typeof company === "object") {
    const companyRecord = company as Record<string, unknown>;
    if (isNonBlankString(companyRecord.domain)) fields.add("company.domain");
    if (isNonBlankString(companyRecord.name)) fields.add("company.name");
  }
  return fields;
}

/**
 * gtm-account-current-state-v2's evidence is never derived from
 * normalizedInput value presence (unlike v1 above, which has no other
 * choice — v1 predates any explicit provenance record). v2 snapshots
 * always carry a validated, versioned evidence envelope in rawInput (see
 * ../services/accountFactsSnapshotEvidence.ts) — that envelope, not
 * normalizedInput, is the sole source of truth for what is evidence.
 *
 * A field only becomes evidence-backed when ALL of the following hold:
 *   - rawInput parses as a schema-valid AccountFactsSnapshotEvidenceV1
 *     envelope (structurally rejects duplicates/overflow/blank/"unknown"
 *     region values already — see that schema);
 *   - envelope.account.id matches this snapshot's own accountId (a
 *     mismatch means the envelope was built for a different account —
 *     never trusted, regardless of how it ended up on this row);
 *   - the envelope's recorded value for that field EXACTLY matches the
 *     value actually present at the same field path in normalizedInput
 *     (a mismatch means the frozen evidence and the frozen evaluator
 *     input disagree — an internally inconsistent snapshot, never
 *     trusted);
 *   - identity/evidence field paths are unique (re-checked here as
 *     defense-in-depth; the envelope schema's own refine already
 *     enforces this at parse time).
 *
 * Returns null — never an empty set — for any of the above failures, so
 * the caller (deriveMqlDecisionReadiness) reports snapshot_evidence_unknown
 * instead of silently treating a corrupted/inconsistent snapshot as
 * ordinary missing evidence. A genuinely valid envelope with zero
 * entries (e.g. a brand-new account with no confirmed facts and no
 * company identity yet) is NOT a failure and correctly returns an empty
 * (but non-null) set.
 */
function evidenceBackedFieldsForCurrentStateV2Snapshot(
  snapshot: SnapshotForReadiness,
): ReadonlySet<string> | null {
  const parsed = AccountFactsSnapshotEvidenceV1Schema.safeParse(
    snapshot.rawInput,
  );
  if (!parsed.success) {
    return null;
  }
  const envelope = parsed.data;

  if (envelope.account.id !== snapshot.accountId) {
    return null;
  }

  const normalizedInput = snapshot.normalizedInput as Record<string, unknown>;
  const fields = new Set<string>();

  for (const entry of [...envelope.identity, ...envelope.evidence]) {
    if (fields.has(entry.field)) {
      return null;
    }
    const actualValue = readNormalizedField(normalizedInput, entry.field);
    if (actualValue !== entry.value) {
      return null;
    }
    fields.add(entry.field);
  }

  return fields;
}

type EvidenceBackedFieldsResolver = (
  snapshot: SnapshotForReadiness,
) => ReadonlySet<string> | null;

// The single source of truth for "which fields are evidence-backed for a
// given snapshot source, given this specific snapshot's actual data."
// Any snapshot source not listed here is unrecognized and fails closed
// (see deriveMqlDecisionReadiness below) — this map is never used to
// silently widen what counts as evidence for a source it doesn't already
// know.
const EVIDENCE_BACKED_FIELDS_RESOLVER_BY_SNAPSHOT_SOURCE: Readonly<
  Record<string, EvidenceBackedFieldsResolver>
> = {
  [CURRENT_STATE_SNAPSHOT_SOURCE]: evidenceBackedFieldsForCurrentStateSnapshot,
  [CURRENT_STATE_V2_SNAPSHOT_SOURCE]: evidenceBackedFieldsForCurrentStateV2Snapshot,
};

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
 *     recognized evidence-backed source, OR the recognized source's own
 *     resolver returns null (an internally inconsistent/untrustworthy
 *     snapshot — see evidenceBackedFieldsForCurrentStateV2Snapshot above):
 *     snapshot_evidence_unknown, fail-closed, no per-field detail is
 *     possible in either case.
 *   - otherwise: derives this specific snapshot's evidence-backed field
 *     set (never a static list, never derived from value presence — see
 *     the two resolvers above) and delegates entirely to
 *     @workspace/evaluator's pure evaluateMqlDecisionReadiness, passing
 *     the frozen profileConfigSnapshot and the frozen normalizedInput —
 *     never re-deriving scoring/tiering/eligibility itself.
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

  const evidenceBackedFields = resolveEvidenceBackedFields(snapshot);
  if (evidenceBackedFields === null) {
    return {
      ready: false,
      reasons: [
        {
          code: "snapshot_evidence_unknown",
          message: `The snapshot source "${snapshot.source}" is recognized, but its recorded evidence is internally inconsistent (malformed, mismatched account, or mismatched values), so this evaluation cannot be trusted for an MQL decision.`,
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

  return evaluateMqlDecisionReadiness(
    parsedConfig.data,
    normalizedInput,
    evidenceBackedFields,
  );
}
