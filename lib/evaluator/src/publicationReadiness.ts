// Publication readiness — a pure, shared classification of whether an
// IcpProfileConfigV1 has enough meaningful Target company (fit) criteria
// to be published. Shared by the API server (the server-authoritative
// publishDraft() gate — see
// artifacts/api-server/src/services/icpProfiles.ts) and the frontend
// (the draft editor's own pre-publish readiness display) so neither can
// drift from the other's definition of "meaningful." This module never
// touches scoring, tiering, or eligibility — it is a publication gate,
// not an evaluator-semantic change.
//
// A leaf condition is meaningful only when it is an explicit `eq` or
// `in` comparison against one of the seven fit-dimension company fields
// (see MEANINGFUL_FIT_FIELDS below — the full FIT_FIELD_ALLOWLIST from
// profileConfig.ts). `exists` never counts as meaningful, regardless of
// field: confirming that company.domain or company.industry is merely
// PRESENT proves a company record exists, not that it's a good fit — the
// same reasoning applies to every fit field, not just domain/name. A
// compound (and/or/not) rule counts as meaningful as soon as ANY one of
// its leaves is meaningful. A rule worth zero (or fewer) points can never
// move an account's fit score, so it is never meaningful either,
// regardless of its condition.
//
// Fit-only profiles may still publish — intent, actionability, and
// eligibility are always optional for publication; this module checks
// fit only.

import type { RuleCondition } from "./conditions.js";
import type { IcpProfileConfigV1, WeightedRule } from "./profileConfig.js";

export type NotReadyForPublishReasonCode = "meaningful_target_required";

export interface NotReadyForPublishReason {
  code: NotReadyForPublishReasonCode;
  message: string;
}

// Centralized, immutable definition of which fit fields count as
// "meaningful" — shared by isMeaningfulFitLeaf below and
// profileClassification.ts's TargetCriterionField (that module reuses
// this exact union rather than defining its own field list). A readonly
// tuple, not a mutable Set, so it's safe to export directly: callers can
// read or iterate it, but never mutate it. The Set below is a private
// derived index, only ever used internally for the O(1) membership check.
export const MEANINGFUL_FIT_FIELDS = [
  "company.industry",
  "company.employeeRange",
  "company.revenueRange",
  "company.region",
  "company.country",
  "company.name",
  "company.domain",
] as const;

export type MeaningfulFitField = (typeof MEANINGFUL_FIT_FIELDS)[number];

const MEANINGFUL_FIT_FIELD_SET: ReadonlySet<string> = new Set(MEANINGFUL_FIT_FIELDS);

/**
 * True for an explicit `eq`/`in` comparison against one of the seven
 * meaningful fit fields — SHAPE only, deliberately independent of
 * whether a real value has been typed in yet. This is what
 * @workspace/evaluator's businessRuleClassification.ts's isSimpleFitRule
 * uses: a business row with a still-blank value (e.g. right after "Add
 * rule") must keep rendering as an editable simple row, not jump to
 * "Advanced" just because the value field is momentarily empty. Use
 * isMeaningfulFitLeaf below (not this) wherever a REAL configured
 * criterion is required — publish-readiness and the target-summary. A
 * type guard so callers narrowing on it get a properly typed eq/in
 * condition back, with its `value`/`values` available and its `field`
 * narrowed to MeaningfulFitField.
 */
export function isSupportedFitCriterionLeaf(
  condition: RuleCondition,
): condition is Extract<RuleCondition, { op: "eq" | "in" }> & { field: MeaningfulFitField } {
  return (
    (condition.op === "eq" || condition.op === "in") &&
    MEANINGFUL_FIT_FIELD_SET.has(condition.field)
  );
}

// A blank (empty or whitespace-only) string never counts as a real
// configured value — an eq/in condition an author is still mid-typing
// must not satisfy publication readiness or appear in the
// target-summary. Only strings can be blank this way; a number or
// boolean literal is always meaningful. This never rewrites the stored
// rule — the blank value stays exactly as authored; it is only excluded
// from what counts as "meaningful" here. Exported so
// profileClassification.ts's targetCriteria can also omit blank entries
// from a mixed `in` array's displayed values, without a second
// definition of "blank".
export function isBlankScalar(value: string | number | boolean): boolean {
  return typeof value === "string" && value.trim() === "";
}

function hasMeaningfulValue(condition: Extract<RuleCondition, { op: "eq" | "in" }>): boolean {
  if (condition.op === "eq") return !isBlankScalar(condition.value);
  return condition.values.some((value) => !isBlankScalar(value));
}

/**
 * True for a supported fit criterion leaf (see isSupportedFitCriterionLeaf)
 * that ALSO carries at least one non-blank value — the single definition
 * of "meaningful leaf" shared by isMeaningfulFitRule below and
 * profileClassification.ts's targetCriteria (structured target-summary
 * extraction), so neither can drift from the other's idea of what
 * counts as an actually-configured criterion.
 */
export function isMeaningfulFitLeaf(
  condition: RuleCondition,
): condition is Extract<RuleCondition, { op: "eq" | "in" }> & { field: MeaningfulFitField } {
  if (!isSupportedFitCriterionLeaf(condition)) return false;
  return hasMeaningfulValue(condition);
}

function collectLeafConditions(condition: RuleCondition): RuleCondition[] {
  switch (condition.op) {
    case "and":
    case "or":
      return condition.conditions.flatMap(collectLeafConditions);
    case "not":
      return collectLeafConditions(condition.condition);
    default:
      return [condition];
  }
}

/** True when this rule can actually move an account's fit score toward a real, specific criterion — never for a bare `exists` check, however many points it's worth. */
export function isMeaningfulFitRule(rule: WeightedRule): boolean {
  if (rule.points <= 0) return false;
  return collectLeafConditions(rule.condition).some(isMeaningfulFitLeaf);
}

/** Pure, no I/O. Returns [] when the config is ready to publish. */
export function evaluatePublicationReadiness(
  config: IcpProfileConfigV1,
): NotReadyForPublishReason[] {
  const reasons: NotReadyForPublishReason[] = [];

  if (!config.fit.rules.some(isMeaningfulFitRule)) {
    reasons.push({
      code: "meaningful_target_required",
      message:
        "Add at least one target company criterion worth more than zero points — an explicit match on industry, employee range, revenue range, region, country, name, or domain. Merely checking that a field exists is not enough.",
    });
  }

  return reasons;
}
