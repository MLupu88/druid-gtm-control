// Shared additive-scoring mechanism for fit and intent — structurally
// identical dimensions (weighted rules + tiers), factored out so
// rules/fit.ts and rules/intent.ts stay thin, dimension-labeled entry
// points rather than duplicating this logic.

import { evaluateCondition } from "../conditions.js";
import { buildMissingInputs } from "../missingInputs.js";
import type {
  Dimension,
  MatchedRule,
  MissingInputEntry,
  ScoreComponent,
} from "../types.js";
import type { Tier, WeightedRule } from "../profileConfig.js";

export interface ScoredRuleSetResult {
  score: number;
  tier: string;
  scoreComponents: ScoreComponent[];
  matchedRules: MatchedRule[];
  missingInputs: MissingInputEntry[];
}

/**
 * Sums `points` for every rule whose condition evaluates to "match"
 * (unknown/no_match contribute zero — never guessed as zero vs. skipped,
 * they are structurally excluded from the sum). Missing fields from
 * every rule's evaluation are collected regardless of that rule's own
 * result, then resolves the highest tier whose minScore <= score.
 */
export function evaluateScoredRuleSet(
  rules: WeightedRule[],
  tiers: Tier[],
  input: Record<string, unknown>,
  dimension: "fit" | "intent",
): ScoredRuleSetResult {
  const scoreComponents: ScoreComponent[] = [];
  const matchedRules: MatchedRule[] = [];
  const missingFieldToDimensions = new Map<string, Set<Dimension>>();

  let score = 0;
  for (const rule of rules) {
    const evaluation = evaluateCondition(rule.condition, input);
    trackMissing(missingFieldToDimensions, evaluation.missingFields, dimension);
    if (evaluation.result === "match") {
      score += rule.points;
      scoreComponents.push({
        ruleId: rule.id,
        dimension,
        label: rule.description,
        points: rule.points,
      });
      matchedRules.push({
        ruleId: rule.id,
        dimension,
        description: rule.description,
      });
    }
  }

  return {
    score,
    tier: resolveTier(tiers, score, dimension),
    scoreComponents,
    matchedRules,
    missingInputs: buildMissingInputs(missingFieldToDimensions),
  };
}

export function trackMissing(
  map: Map<string, Set<Dimension>>,
  fields: string[],
  dimension: Dimension,
): void {
  for (const field of fields) {
    const set = map.get(field) ?? new Set<Dimension>();
    set.add(dimension);
    map.set(field, set);
  }
}

function resolveTier(
  tiers: Tier[],
  score: number,
  dimensionLabel: string,
): string {
  let winner: Tier | undefined;
  for (const tier of tiers) {
    if (
      tier.minScore <= score &&
      (!winner || tier.minScore > winner.minScore)
    ) {
      winner = tier;
    }
  }
  if (!winner) {
    // Unreachable given IcpProfileConfigV1Schema's floor-tier-at-0
    // guarantee and non-negative scores — defensive only, so a caller
    // that bypassed config validation fails loudly instead of silently
    // producing an undefined tier.
    throw new Error(
      `no eligible tier found for dimension "${dimensionLabel}" at score ${score} — profile config validation should have guaranteed a floor tier at minScore 0`,
    );
  }
  return winner.code;
}
