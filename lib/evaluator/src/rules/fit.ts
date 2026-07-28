import { evaluateScoredRuleSet, type ScoredRuleSetResult } from "./scoring.js";
import type { FitConfig } from "../profileConfig.js";

export function evaluateFit(
  config: FitConfig,
  input: Record<string, unknown>,
): ScoredRuleSetResult {
  return evaluateScoredRuleSet(config.rules, config.tiers, input, "fit");
}
