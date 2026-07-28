// Eligibility: hard disqualifiers are evaluated first, outside weighted
// scoring — any match makes the account ineligible regardless of
// fit/intent/actionability. Only if no disqualifier fires are
// restrictions evaluated; any match sets "restricted", otherwise
// "eligible". Unknown rule results never silently become a disqualifier
// or restriction — only "match" counts, exactly like fit/intent/
// actionability.
//
// A canonical (non-profile-authored) restriction is added whenever
// identity resolved to only "anonymous" or "company" — this is
// evaluator-version mechanics, not something a profile config can
// disable, so downstream decision logic can never be permitted to treat
// such an account as person-addressable.

import { evaluateCondition } from "../conditions.js";
import { buildMissingInputs } from "../missingInputs.js";
import type {
  Dimension,
  EligibilityOutcome,
  HardDisqualifierEntry,
  IdentityResolutionLevel,
  MissingInputEntry,
  RestrictionEntry,
} from "../types.js";
import type { EligibilityConfig } from "../profileConfig.js";

export interface EligibilityResult {
  outcome: EligibilityOutcome;
  hardDisqualifiers: HardDisqualifierEntry[];
  eligibilityRestrictions: RestrictionEntry[];
  missingInputs: MissingInputEntry[];
}

const CANONICAL_IDENTITY_RESTRICTION: RestrictionEntry = {
  ruleId: "canonical.identity_not_person_addressable",
  description:
    "Identity resolved to anonymous or company only — no valid contact evidence exists, so this account must never become eligible for person-addressed outreach.",
};

export function evaluateEligibility(
  config: EligibilityConfig,
  input: Record<string, unknown>,
  identityResolutionLevel: IdentityResolutionLevel,
): EligibilityResult {
  const missingFieldToDimensions = new Map<string, Set<Dimension>>();

  function trackMissing(fields: string[]): void {
    for (const field of fields) {
      const set = missingFieldToDimensions.get(field) ?? new Set<Dimension>();
      set.add("eligibility");
      missingFieldToDimensions.set(field, set);
    }
  }

  const firedDisqualifiers: HardDisqualifierEntry[] = [];
  for (const rule of config.hardDisqualifiers) {
    const evaluation = evaluateCondition(rule.condition, input);
    trackMissing(evaluation.missingFields);
    if (evaluation.result === "match") {
      firedDisqualifiers.push({
        ruleId: rule.id,
        description: rule.description,
      });
    }
  }

  if (firedDisqualifiers.length > 0) {
    return {
      outcome: "ineligible",
      hardDisqualifiers: firedDisqualifiers,
      eligibilityRestrictions: [],
      missingInputs: buildMissingInputs(missingFieldToDimensions),
    };
  }

  const firedRestrictions: RestrictionEntry[] = [];
  for (const rule of config.restrictions) {
    const evaluation = evaluateCondition(rule.condition, input);
    trackMissing(evaluation.missingFields);
    if (evaluation.result === "match") {
      firedRestrictions.push({
        ruleId: rule.id,
        description: rule.description,
      });
    }
  }

  if (
    identityResolutionLevel === "anonymous" ||
    identityResolutionLevel === "company"
  ) {
    firedRestrictions.push(CANONICAL_IDENTITY_RESTRICTION);
  }

  return {
    outcome: firedRestrictions.length > 0 ? "restricted" : "eligible",
    hardDisqualifiers: [],
    eligibilityRestrictions: firedRestrictions,
    missingInputs: buildMissingInputs(missingFieldToDimensions),
  };
}
