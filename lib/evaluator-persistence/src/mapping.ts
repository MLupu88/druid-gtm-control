// Explicit translation between @workspace/evaluator's output types and
// @workspace/db's account_evaluations column shape. This is the ONLY
// place either package's types are converted into the other's — neither
// package imports the other directly (@workspace/evaluator has zero
// dependency on @workspace/db; this package depends on both and owns the
// boundary).
//
// The enum-mapping functions below are written as exhaustive switch
// statements rather than a structural `as` cast. Both sides currently use
// identical literal string sets by design, but an exhaustive switch means
// a future divergence (either side adding/renaming a value) fails to
// COMPILE here rather than silently type-checking through structural
// compatibility. See enumParity.test.ts for the complementary runtime
// check against the live pgEnum values.

import type { AccountEvaluation } from "@workspace/db/schema";
import type {
  EligibilityOutcome,
  EvaluationResult,
  IdentityConfidence,
  IdentityResolutionLevel,
} from "@workspace/evaluator";

type DbIdentityResolutionLevel = NonNullable<
  AccountEvaluation["identityResolutionLevel"]
>;
type DbIdentityConfidence = NonNullable<
  AccountEvaluation["identityConfidence"]
>;
type DbEligibilityOutcome = NonNullable<
  AccountEvaluation["eligibilityOutcome"]
>;

export function mapIdentityResolutionLevel(
  value: IdentityResolutionLevel,
): DbIdentityResolutionLevel {
  switch (value) {
    case "anonymous":
      return "anonymous";
    case "company":
      return "company";
    case "contact":
      return "contact";
    case "known_crm_contact":
      return "known_crm_contact";
  }
}

export function mapIdentityConfidence(
  value: IdentityConfidence,
): DbIdentityConfidence {
  switch (value) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
  }
}

export function mapEligibilityOutcome(
  value: EligibilityOutcome,
): DbEligibilityOutcome {
  switch (value) {
    case "eligible":
      return "eligible";
    case "restricted":
      return "restricted";
    case "ineligible":
      return "ineligible";
  }
}

export interface CompletedRowContext {
  accountId: string;
  snapshotId: string;
  profileVersionId: string;
  /** The exact, already-validated profile config object used for this evaluation. */
  profileConfigSnapshot: unknown;
  evaluatorVersionId: string;
  evaluationMode: AccountEvaluation["evaluationMode"];
  createdBy: AccountEvaluation["createdBy"];
}

/**
 * Maps a pure EvaluationResult (from @workspace/evaluator) plus the
 * adapter's own context (IDs, mode, the config snapshot it ran against)
 * into an insertable account_evaluations row shape. Numeric scores are
 * converted to strings — this table's score columns are `numeric`, and
 * drizzle-orm's numeric columns take string input to avoid floating-point
 * precision loss on the JS side, matching the convention already
 * established in lib/db's own integration tests.
 */
export function mapEvaluationResultToInsertRow(
  result: EvaluationResult,
  context: CompletedRowContext,
) {
  return {
    accountId: context.accountId,
    snapshotId: context.snapshotId,
    profileVersionId: context.profileVersionId,
    profileConfigSnapshot: context.profileConfigSnapshot,
    evaluatorVersionId: context.evaluatorVersionId,
    evaluationMode: context.evaluationMode,
    status: "completed" as const,
    errorDetail: null,
    fitScore: String(result.fitScore),
    fitTier: result.fitTier,
    intentScore: String(result.intentScore),
    intentTier: result.intentTier,
    identityResolutionLevel: mapIdentityResolutionLevel(
      result.identityResolutionLevel,
    ),
    identityConfidence: mapIdentityConfidence(result.identityConfidence),
    actionabilityScore: String(result.actionabilityScore),
    eligibilityOutcome: mapEligibilityOutcome(result.eligibilityOutcome),
    eligibilityRestrictions: result.eligibilityRestrictions,
    hardDisqualifiers: result.hardDisqualifiers,
    scoreComponents: result.scoreComponents,
    matchedRules: result.matchedRules,
    missingInputs: result.missingInputs,
    createdBy: context.createdBy,
  };
}
