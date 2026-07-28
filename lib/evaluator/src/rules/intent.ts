import { evaluateScoredRuleSet, type ScoredRuleSetResult } from "./scoring.js";
import type { IntentConfig } from "../profileConfig.js";

export function evaluateIntent(
  config: IntentConfig,
  input: Record<string, unknown>,
): ScoredRuleSetResult {
  return evaluateScoredRuleSet(config.rules, config.tiers, input, "intent");
}
