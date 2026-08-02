// Business-first editing classification — a pure, shared definition of
// which fit/intent rules (WeightedRule) are simple enough to edit in
// plain language in a profile's Business view, versus which must remain
// Technical-only. Shared by the frontend's business rule editor, which
// uses this to decide what to render as an editable business row vs a
// read-only "Advanced criterion" summary — this module (together with
// its own WEIGHT_PRESET_VALUES) is the single source of truth for both
// the Business view's importance selector and its "is this simple"
// classification, so the two can never drift apart.
//
// Deliberately NOT one generic "is this rule simple" check: what counts
// as a supported plain-language shape is different per dimension (fit
// targets company attributes via eq/in; intent has a small, specific set
// of supported engagement shapes) — see isSimpleFitRule/isSimpleIntentRule
// below. Actionability and eligibility have no supported business-simple
// shape yet in this release; isSimpleActionabilityRule/
// isSimpleEligibilityRule deliberately always return false, so every
// actionability/eligibility rule stays Technical-only until a future
// release defines one.
//
// Every function here only classifies. None of them ever normalizes,
// rewrites, or discards a rule.

import type { RuleCondition } from "./conditions.js";
import type { ConditionRule, WeightedRule } from "./profileConfig.js";
import { isSupportedFitCriterionLeaf } from "./publicationReadiness.js";

// ---------------------------------------------------------------------
// Business-friendly weight presets. A WeightedRule's `points` field is a
// plain number with no fixed scale (see profileConfig.ts) — most authors
// don't need to pick an arbitrary integer, they need to say how much a
// criterion matters. These three documented values are the only thing a
// "preset" ever means; an existing rule whose points value doesn't match
// any of these three is Technical-only ("Advanced" in the weight editor,
// and never classified as a simple rule below, regardless of its
// condition shape).
// ---------------------------------------------------------------------

export const WEIGHT_PRESET_VALUES = {
  supporting: 5,
  important: 15,
  critical: 30,
} as const;

export type WeightPresetKey = keyof typeof WEIGHT_PRESET_VALUES;

export const WEIGHT_PRESET_ORDER = ["supporting", "important", "critical"] as const;

/** Returns the preset key whose documented value exactly matches `points`, or null when it doesn't match any preset (i.e. an "Advanced"/custom value). */
export function weightPresetForPoints(points: number): WeightPresetKey | null {
  for (const key of WEIGHT_PRESET_ORDER) {
    if (WEIGHT_PRESET_VALUES[key] === points) return key;
  }
  return null;
}

// ---------------------------------------------------------------------
// Simple-rule classification.
// ---------------------------------------------------------------------

function isLeafCondition(condition: RuleCondition): boolean {
  return condition.op !== "and" && condition.op !== "or" && condition.op !== "not";
}

/**
 * True when a fit WeightedRule is simple enough to edit in plain
 * language: a single leaf condition (never a compound AND/OR/NOT tree —
 * those stay Technical-only), an explicit `eq`/`in` comparison against
 * one of the seven meaningful company-targeting fields (see
 * publicationReadiness.ts's isSupportedFitCriterionLeaf — the exact same
 * field/operator definition used for publish-readiness and the target-
 * summary, so this can't drift from either), and worth exactly one of
 * the three business weight presets. Deliberately uses the SHAPE-only
 * check (not publicationReadiness.ts's stricter isMeaningfulFitLeaf,
 * which also requires a non-blank value): a business row whose value the
 * author hasn't typed in yet must still render as an editable simple
 * row, not jump to "Advanced" just because it's momentarily blank.
 */
export function isSimpleFitRule(rule: WeightedRule): boolean {
  if (weightPresetForPoints(rule.points) === null) return false;
  if (!isLeafCondition(rule.condition)) return false;
  return isSupportedFitCriterionLeaf(rule.condition);
}

// The specific, explicitly supported intent leaf shapes for this
// release — every other intent condition shape (including `exists` on
// any intent field, and everything on engagement.lastSeenAt) is
// Technical-only. Kept as an exhaustive small check, not a generic
// field-type-based rule, because each shape reads as a distinct business
// sentence ("visited any of these sources", "visited at least N
// sources", "is a repeat visitor") rather than a generic comparison.
function isSimpleIntentLeaf(condition: RuleCondition): boolean {
  switch (condition.op) {
    case "includesAny":
      return (
        condition.field === "engagement.sources" ||
        condition.field === "engagement.pagesVisited"
      );
    case "gte":
      return condition.field === "engagement.distinctSourceCount";
    case "eq":
      return condition.field === "engagement.repeatVisit" && typeof condition.value === "boolean";
    default:
      return false;
  }
}

/**
 * True when an intent WeightedRule is simple enough to edit in plain
 * language: a single leaf condition on exactly one of the supported
 * intent shapes —
 *   - engagement.sources + includesAny
 *   - engagement.pagesVisited + includesAny
 *   - engagement.distinctSourceCount + gte
 *   - engagement.repeatVisit + eq with a boolean value
 * — never engagement.lastSeenAt, never a compound condition, and worth
 * exactly one of the three business weight presets.
 */
export function isSimpleIntentRule(rule: WeightedRule): boolean {
  if (weightPresetForPoints(rule.points) === null) return false;
  if (!isLeafCondition(rule.condition)) return false;
  return isSimpleIntentLeaf(rule.condition);
}

/**
 * Actionability has no supported business-simple shape in this release —
 * every actionability rule is Technical-only, regardless of its
 * condition or points. Kept as an explicit function (not an inline
 * `false`) so the Business view's call sites read the same way as
 * isSimpleFitRule/isSimpleIntentRule, and so a future release can define
 * real support here without changing any caller's shape.
 */
export function isSimpleActionabilityRule(_rule: WeightedRule): boolean {
  return false;
}

/**
 * Eligibility (hard disqualifiers / restrictions) has no supported
 * business-simple shape in this release — every eligibility rule is
 * Technical-only, regardless of its condition. See
 * isSimpleActionabilityRule's comment for why this is an explicit
 * function rather than an inline `false`.
 */
export function isSimpleEligibilityRule(_rule: ConditionRule): boolean {
  return false;
}
