// Actionability: operational evidence that some human follow-up MAY be
// possible. Deliberately excludes consent, lawful basis, DPO clearance,
// geographic legal policy, routing output, and current
// connector/integration availability — those belong to eligibility
// restrictions, the (not-yet-built) decision policy, or later action
// availability, never here. Enforced structurally: profileConfig.ts's
// ACTIONABILITY_FIELD_ALLOWLIST contains none of the consent/legal
// fields, so a rule referencing one is rejected at config parse time
// (see profileConfig.test.ts), not merely by convention here.

import { evaluateCondition } from "../conditions.js";
import { buildMissingInputs } from "../missingInputs.js";
import type {
  Dimension,
  MatchedRule,
  MissingInputEntry,
  ScoreComponent,
} from "../types.js";
import type { ActionabilityConfig } from "../profileConfig.js";

export interface ActionabilityResult {
  score: number;
  scoreComponents: ScoreComponent[];
  matchedRules: MatchedRule[];
  missingInputs: MissingInputEntry[];
}

export function evaluateActionability(
  config: ActionabilityConfig,
  input: Record<string, unknown>,
): ActionabilityResult {
  const scoreComponents: ScoreComponent[] = [];
  const matchedRules: MatchedRule[] = [];
  const missingFieldToDimensions = new Map<string, Set<Dimension>>();

  let score = 0;
  for (const rule of config.rules) {
    const evaluation = evaluateCondition(rule.condition, input);
    for (const field of evaluation.missingFields) {
      const set = missingFieldToDimensions.get(field) ?? new Set<Dimension>();
      set.add("actionability");
      missingFieldToDimensions.set(field, set);
    }
    if (evaluation.result === "match") {
      score += rule.points;
      scoreComponents.push({
        ruleId: rule.id,
        dimension: "actionability",
        label: rule.description,
        points: rule.points,
      });
      matchedRules.push({
        ruleId: rule.id,
        dimension: "actionability",
        description: rule.description,
      });
    }
  }

  return {
    score,
    scoreComponents,
    matchedRules,
    missingInputs: buildMissingInputs(missingFieldToDimensions),
  };
}
