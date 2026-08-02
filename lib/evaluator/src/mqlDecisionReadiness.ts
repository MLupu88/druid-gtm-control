// MQL decision-readiness — a pure, shared classification of whether an
// already-completed evaluation has enough EVIDENCE-BACKED, action-relevant
// condition resolution to support a "Promote to MQL" decision. This is
// deliberately narrower than "did the account qualify as an MQL": it never
// reads fitTier/intentTier/eligibilityOutcome and never asserts a positive
// fit-or-intent outcome. It only asserts whether the fit/intent conditions
// that actually carry points were resolvable (match or no_match) from
// values this module is told are evidence-backed — never from an
// unevidenced fallback. See the module comment on the caller
// (artifacts/api-server/src/services/mqlDecisionReadiness.ts) for how
// "evidence-backed" is decided for a given snapshot source; this module
// takes that decision as an input, never a snapshot `source` string, so it
// stays free of any API-server-specific vocabulary.
//
// Never touches scoring, tiering, matched rules, or eligibility — those
// remain exactly what rules/scoring.ts and rules/eligibility.ts already
// compute. This module only re-resolves the SAME condition trees
// (config.fit.rules / config.intent.rules) a second time, under a
// stricter evidence mask, using the exact same tri-state combinators
// conditions.ts's evaluateCondition itself uses (combineAnd/combineOr/
// combineNot) — reused, not re-derived.

import {
  combineAnd,
  combineNot,
  combineOr,
  dedupeSorted,
  evaluateCondition,
  type ConditionOutcome,
  type RuleCondition,
} from "./conditions.js";
import type { IcpProfileConfigV1, WeightedRule } from "./profileConfig.js";

export type MqlNotReadyReasonCode =
  | "official_evaluation_required"
  | "intent_not_configured"
  | "snapshot_evidence_unknown"
  | "required_condition_unresolved";

export interface MqlNotReadyReason {
  code: MqlNotReadyReasonCode;
  message: string;
  /** Present for required_condition_unresolved. */
  dimension?: "fit" | "intent";
  /** Present for required_condition_unresolved — the WeightedRule.id this reason refers to. */
  ruleId?: string;
  /** Present for required_condition_unresolved — the unresolved leaf field paths actually responsible for that rule's condition resolving to "unknown". Never includes fields from a branch that did not affect the result (e.g. a no_match short-circuit elsewhere in an "and"). */
  fields?: string[];
}

export interface MqlDecisionReadiness {
  ready: boolean;
  /** Empty iff ready. */
  reasons: MqlNotReadyReason[];
}

/** A rule worth zero (or fewer) points can never move fitScore/intentScore, so its condition's resolution status is irrelevant to decision-readiness — see profileClassification.ts's isMeaningfulFitRule for the same bar already applied to fit; here it is applied uniformly to both fit and intent. */
function actionRelevantRules(rules: WeightedRule[]): WeightedRule[] {
  return rules.filter((rule) => rule.points > 0);
}

interface ResolvedWithFields {
  result: ConditionOutcome;
  /** Non-empty only when result is "unknown" — the leaf field paths responsible for that unresolved outcome. A branch that did not affect a resolved (match/no_match) outcome never contributes here, even if that branch itself referenced an unevidenced field. */
  fields: string[];
}

/**
 * Re-resolves `condition` against `input`, exactly like
 * conditions.ts's evaluateCondition, EXCEPT: any leaf referencing a field
 * NOT in evidenceBackedFields is forced to "unknown" regardless of
 * operator (including `exists`, which evaluateCondition itself treats as
 * total/never-unknown — that is correct for scoring, but wrong here: a
 * fallback value's mere presence in the sparse snapshot is not evidence).
 * and/or/not composition reuses the exact same combinators evaluateCondition
 * itself calls, so the truth table (a compound condition may resolve even
 * when one branch is unknown) is identical, not approximated.
 */
function resolveConditionAgainstEvidence(
  condition: RuleCondition,
  input: Record<string, unknown>,
  evidenceBackedFields: ReadonlySet<string>,
): ResolvedWithFields {
  switch (condition.op) {
    case "exists":
    case "eq":
    case "in":
    case "gte":
    case "includesAny": {
      if (!evidenceBackedFields.has(condition.field)) {
        return { result: "unknown", fields: [condition.field] };
      }
      const leaf = evaluateCondition(condition, input);
      return { result: leaf.result, fields: leaf.missingFields };
    }
    case "not": {
      const child = resolveConditionAgainstEvidence(
        condition.condition,
        input,
        evidenceBackedFields,
      );
      const result = combineNot(child.result);
      return { result, fields: result === "unknown" ? child.fields : [] };
    }
    case "and": {
      const children = condition.conditions.map((c) =>
        resolveConditionAgainstEvidence(c, input, evidenceBackedFields),
      );
      const result = combineAnd(children.map((c) => c.result));
      return {
        result,
        fields:
          result === "unknown"
            ? dedupeSorted(children.flatMap((c) => c.fields))
            : [],
      };
    }
    case "or": {
      const children = condition.conditions.map((c) =>
        resolveConditionAgainstEvidence(c, input, evidenceBackedFields),
      );
      const result = combineOr(children.map((c) => c.result));
      return {
        result,
        fields:
          result === "unknown"
            ? dedupeSorted(children.flatMap((c) => c.fields))
            : [],
      };
    }
  }
}

function ruleUnresolvedReason(
  rule: WeightedRule,
  dimension: "fit" | "intent",
  fields: string[],
): MqlNotReadyReason {
  return {
    code: "required_condition_unresolved",
    dimension,
    ruleId: rule.id,
    fields,
    message: `The "${dimension}" rule "${rule.id}" (${rule.description}) could not be resolved to match or no_match using evidence-backed data alone.`,
  };
}

/**
 * Pure, no I/O. Assumes `config`/`normalizedInput` are exactly the frozen
 * profileConfigSnapshot/normalizedInput an already-completed, production
 * evaluation ran against — this function never re-derives fitTier,
 * intentTier, matchedRules, or eligibilityOutcome, and never decides
 * whether an evaluation even qualifies to be checked (see
 * artifacts/api-server/src/services/mqlDecisionReadiness.ts for the
 * official_evaluation_required / snapshot_evidence_unknown gates, which
 * require DB-row context this module deliberately does not take).
 *
 * Returns ready:true only when every fit and intent rule worth more than
 * zero points resolved to match or no_match using only fields present in
 * evidenceBackedFields — never when a rule's resolution depended on an
 * unevidenced fallback value being treated as if it were real evidence.
 */
export function evaluateMqlDecisionReadiness(
  config: IcpProfileConfigV1,
  normalizedInput: Record<string, unknown>,
  evidenceBackedFields: ReadonlySet<string> | readonly string[],
): MqlDecisionReadiness {
  const evidenceSet =
    evidenceBackedFields instanceof Set
      ? evidenceBackedFields
      : new Set(evidenceBackedFields);

  const reasons: MqlNotReadyReason[] = [];

  const relevantIntentRules = actionRelevantRules(config.intent.rules);
  if (relevantIntentRules.length === 0) {
    reasons.push({
      code: "intent_not_configured",
      message:
        "This profile has no configured intent rule worth more than zero points, so buying intent can never be demonstrated for this evaluation.",
    });
  }

  for (const rule of actionRelevantRules(config.fit.rules)) {
    const { result, fields } = resolveConditionAgainstEvidence(
      rule.condition,
      normalizedInput,
      evidenceSet,
    );
    if (result === "unknown") {
      reasons.push(ruleUnresolvedReason(rule, "fit", fields));
    }
  }

  for (const rule of relevantIntentRules) {
    const { result, fields } = resolveConditionAgainstEvidence(
      rule.condition,
      normalizedInput,
      evidenceSet,
    );
    if (result === "unknown") {
      reasons.push(ruleUnresolvedReason(rule, "intent", fields));
    }
  }

  return { ready: reasons.length === 0, reasons };
}
