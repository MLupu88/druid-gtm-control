// canonical-v1's pure evaluation entrypoint — orchestrates the five
// dimension modules. No database access, no network, no LLM, no
// timestamps, no randomness, no environment reads, no routing decisions,
// and no account_decisions output. Given already-validated typed input
// (NormalizedAccountInputV1 + IcpProfileConfigV1), this function is a
// total, deterministic computation: the same inputs always produce a
// deeply-equal result (see evaluate.test.ts's repeat-run test).
//
// Output array ordering is deterministic by construction: each
// dimension's rules are walked in the order they appear in the profile
// config (insertion order, never re-sorted), and the cross-dimension
// concatenation order below (identity, fit, intent, actionability) is
// fixed. missingInputs is the one array that IS explicitly sorted (by
// field path), since it is built by merging Sets across dimensions.

import { evaluateActionability } from "./rules/actionability.js";
import { evaluateEligibility } from "./rules/eligibility.js";
import { evaluateFit } from "./rules/fit.js";
import { evaluateIdentity } from "./rules/identity.js";
import { evaluateIntent } from "./rules/intent.js";
import { mergeMissingInputs } from "./missingInputs.js";
import type { EvaluationResult, NormalizedAccountInputV1 } from "./types.js";
import type { IcpProfileConfigV1 } from "./profileConfig.js";

export function evaluateCanonicalV1(
  normalizedInput: NormalizedAccountInputV1,
  profileConfig: IcpProfileConfigV1,
): EvaluationResult {
  const inputRecord = normalizedInput as unknown as Record<string, unknown>;

  const identity = evaluateIdentity(normalizedInput);
  const fit = evaluateFit(profileConfig.fit, inputRecord);
  const intent = evaluateIntent(profileConfig.intent, inputRecord);
  const actionability = evaluateActionability(
    profileConfig.actionability,
    inputRecord,
  );
  const eligibility = evaluateEligibility(
    profileConfig.eligibility,
    inputRecord,
    identity.resolutionLevel,
  );

  return {
    fitScore: fit.score,
    fitTier: fit.tier,
    intentScore: intent.score,
    intentTier: intent.tier,
    identityResolutionLevel: identity.resolutionLevel,
    identityConfidence: identity.confidence,
    actionabilityScore: actionability.score,
    eligibilityOutcome: eligibility.outcome,
    scoreComponents: [
      ...fit.scoreComponents,
      ...intent.scoreComponents,
      ...actionability.scoreComponents,
    ],
    matchedRules: [
      ...identity.matchedRules,
      ...fit.matchedRules,
      ...intent.matchedRules,
      ...actionability.matchedRules,
    ],
    missingInputs: mergeMissingInputs([
      fit.missingInputs,
      intent.missingInputs,
      actionability.missingInputs,
      eligibility.missingInputs,
    ]),
    hardDisqualifiers: eligibility.hardDisqualifiers,
    eligibilityRestrictions: eligibility.eligibilityRestrictions,
  };
}
