// Deterministic, non-LLM business-language derivations for the ICP draft
// editor (../components/icp-profile-draft-editor.tsx,
// ../components/icp-profile-summary-card.tsx,
// ../components/icp-rule-list-section.tsx,
// ../components/icp-tier-editor.tsx). Every function here reads only the
// real IcpProfileConfigV1 the author has configured — nothing is guessed,
// inferred from an LLM, or invented on the author's behalf. No React
// state, no DOM — this package has no jsdom/testing-library, so this
// stays fully unit-testable (see ./icp-profile-business-summary.test.ts).
//
// Kept separate from ./icp-profile-config-editing.ts (which owns
// add/remove/reorder/id-generation) and
// ./icp-profile-config-validation.ts (which owns schema validity) — this
// module owns explanation only: it never mutates a config and never
// decides whether one is valid to save.

import type {
  IcpProfileConfigV1,
  WeightedRule,
  ConditionRule,
  Tier,
  RuleCondition,
  FieldAllowlist,
} from "@workspace/evaluator";
import { humanizeToken } from "@workspace/gtm-shared";
import { humanizeFieldLabel } from "./icp-profile-config-validation";

// ---------------------------------------------------------------------
// Points/weight arithmetic. Scores have no fixed maximum anywhere in the
// evaluator (lib/evaluator/src/profileConfig.ts) — "total configured
// positive points" means exactly one thing: the sum of every currently
// configured rule's points in that dimension, nothing more, never
// labeled "out of 100" or any other invented ceiling.
// ---------------------------------------------------------------------

export function sumRulePoints(rules: WeightedRule[]): number {
  return rules.reduce((total, rule) => total + rule.points, 0);
}

/** A rule's share of the dimension's currently configured positive-point total, as a whole-number percentage. Null when the total is 0 (no share can be computed — never falsely reported as 0%). */
export function ruleSharePercent(points: number, totalPoints: number): number | null {
  if (totalPoints <= 0) return null;
  return Math.round((points / totalPoints) * 100);
}

// ---------------------------------------------------------------------
// Band (tier) unreachability. sumRulePoints() is the sum of every
// currently configured rule's points — a safe theoretical UPPER BOUND on
// what an account could score, reached only if every single configured
// rule matched simultaneously. It is deliberately NOT called "achievable"
// or "reachable": some rules' conditions may be mutually exclusive (e.g.
// two rules on the same field with different "eq" values), so a real
// account may never be able to actually hit this sum. That asymmetry
// only ever cuts one way: if a band's threshold is above this upper
// bound, it is DEFINITELY unreachable (no combination of matches, however
// favorable, can exceed the sum of every rule's points). The converse is
// NOT asserted — a band at or below this bound is merely not proven
// unreachable by this arithmetic; whether it's actually reachable would
// require condition-satisfiability analysis, which this module
// deliberately does not attempt.
// ---------------------------------------------------------------------

/** Non-fallback (minScore > 0) bands whose threshold exceeds the dimension's total configured positive rule weights — definitely unreachable, since no combination of matches can exceed that sum. */
export function unreachableBands(tiers: Tier[], configuredMaximumPoints: number): Tier[] {
  return tiers.filter((tier) => tier.minScore > 0 && tier.minScore > configuredMaximumPoints);
}

/** True when every non-fallback band's threshold exceeds the dimension's total configured positive rule weights, so every account would definitely resolve to the minScore-0 band regardless of which rules match. Only meaningful when more than one band is configured — a single-band config has nothing to "collapse" into. */
export function allBandsCollapseToFallback(tiers: Tier[], configuredMaximumPoints: number): boolean {
  if (tiers.length <= 1) return false;
  const nonFallback = tiers.filter((tier) => tier.minScore > 0);
  if (nonFallback.length === 0) return false;
  return nonFallback.every((tier) => tier.minScore > configuredMaximumPoints);
}

// ---------------------------------------------------------------------
// Band (tier) display — the tier `code` IS the label an author sees
// (icp-tier-editor.tsx's "Band name" field), so humanizing it for prose
// contexts (the summary card, warning text) is safe the same way
// ../lib/icp-preview-presentation.ts's humanizeTierLabel already treats
// tier codes as free-text author-chosen names, never a fixed vocabulary.
// ---------------------------------------------------------------------

export function humanizeBandLabel(code: string): string {
  const humanized = humanizeToken(code);
  return humanized || code;
}

export interface BandSummary {
  code: string;
  label: string;
  minScore: number;
  isFallback: boolean;
}

/** Bands sorted ascending by threshold, so the fallback (minScore 0) band always leads. */
export function summarizeBands(tiers: Tier[]): BandSummary[] {
  return [...tiers]
    .sort((a, b) => a.minScore - b.minScore)
    .map((tier) => ({
      code: tier.code,
      label: humanizeBandLabel(tier.code),
      minScore: tier.minScore,
      isFallback: tier.minScore === 0,
    }));
}

// ---------------------------------------------------------------------
// Condition -> plain-language sentence. The closed condition DSL
// (@workspace/evaluator's conditions.ts) has a small fixed operator set,
// so every shape below is exhaustive and deterministic — never a guess,
// never a fabricated conclusion about what the rule "means" beyond what
// its own condition literally says.
// ---------------------------------------------------------------------

// A small set of eligibility/actionability/intent boolean fields read
// naturally as a predicate about the account ("the account is an
// existing customer") rather than as a field-equals-value statement
// ("Existing customer is true"). Only fields that are actually boolean
// in one of the dimension allowlists appear here (see profileConfig.ts's
// FIT/INTENT/ACTIONABILITY/ELIGIBILITY_FIELD_ALLOWLIST) — every other
// field falls back to the generic "<Field label> is <value>" phrasing,
// never a guessed predicate.
const BOOLEAN_PREDICATE_TRUE: Record<string, string> = {
  doNotContact: "the account is marked do-not-contact",
  "crm.competitorFlag": "the account is marked as a competitor",
  "crm.partnerFlag": "the account is marked as a partner",
  "crm.existingCustomer": "the account is an existing customer",
  "crm.openOpportunity": "the account has an open opportunity",
  "engagement.repeatVisit": "the account has repeat visits",
};

const BOOLEAN_PREDICATE_FALSE: Record<string, string> = {
  doNotContact: "the account is not marked do-not-contact",
  "crm.competitorFlag": "the account is not marked as a competitor",
  "crm.partnerFlag": "the account is not marked as a partner",
  "crm.existingCustomer": "the account is not an existing customer",
  "crm.openOpportunity": "the account has no open opportunity",
  "engagement.repeatVisit": "the account has no repeat visits",
};

function formatLiteral(value: string | number | boolean): string {
  return typeof value === "boolean" ? (value ? "true" : "false") : String(value);
}

// Oxford-style join ("Banking", "Banking or Insurance", "Banking,
// Insurance, or Healthcare") — never a bare comma-joined list, which
// reads ambiguously as prose.
function joinValuesAsProse(values: (string | number | boolean)[]): string {
  const formatted = values.map(formatLiteral);
  if (formatted.length === 0) return "";
  if (formatted.length === 1) return formatted[0]!;
  if (formatted.length === 2) return `${formatted[0]} or ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, or ${formatted[formatted.length - 1]}`;
}

function describeEqCondition(field: string, value: string | number | boolean): string {
  if (typeof value === "boolean") {
    const map = value ? BOOLEAN_PREDICATE_TRUE : BOOLEAN_PREDICATE_FALSE;
    const predicate = map[field];
    if (predicate) return predicate;
  }
  return `${humanizeFieldLabel(field)} is ${formatLiteral(value)}`;
}

export function describeCondition(condition: RuleCondition): string {
  switch (condition.op) {
    case "exists":
      return `${humanizeFieldLabel(condition.field)} is present`;
    case "eq":
      return describeEqCondition(condition.field, condition.value);
    case "in":
      return `${humanizeFieldLabel(condition.field)} is one of ${joinValuesAsProse(condition.values)}`;
    case "gte":
      return `${humanizeFieldLabel(condition.field)} is at least ${condition.value}`;
    case "includesAny":
      return `${humanizeFieldLabel(condition.field)} includes any of ${joinValuesAsProse(condition.values)}`;
    case "and":
      return condition.conditions.map(describeCondition).join(" and ");
    case "or":
      return condition.conditions.map(describeCondition).join(" or ");
    case "not":
      return `not (${describeCondition(condition.condition)})`;
  }
}

export type ScoredDimension = "fit" | "intent" | "actionability";

/** e.g. "Award 20 fit points when Industry is one of Banking or Insurance." */
export function describeWeightedRuleSentence(
  dimension: ScoredDimension,
  rule: WeightedRule,
): string {
  const pointsWord = rule.points === 1 ? "point" : "points";
  return `Award ${rule.points} ${dimension} ${pointsWord} when ${describeCondition(rule.condition)}.`;
}

export type EligibilityRuleKind = "hardDisqualifier" | "restriction";

/** e.g. "Restrict outreach when the account is an existing customer." */
export function describeEligibilityRuleSentence(
  kind: EligibilityRuleKind,
  rule: ConditionRule,
): string {
  const verb = kind === "hardDisqualifier" ? "Disqualify outright" : "Restrict outreach";
  return `${verb} when ${describeCondition(rule.condition)}.`;
}

// ---------------------------------------------------------------------
// Field collection — used both for the "How this ICP works" summary
// (which attributes/signals a dimension's rules actually reference) and
// for the generic-identity-only warning below.
// ---------------------------------------------------------------------

export function collectConditionFields(condition: RuleCondition): string[] {
  switch (condition.op) {
    case "exists":
    case "eq":
    case "in":
    case "gte":
    case "includesAny":
      return [condition.field];
    case "not":
      return collectConditionFields(condition.condition);
    case "and":
    case "or":
      return condition.conditions.flatMap(collectConditionFields);
  }
}

function dedupeSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

export function fieldsReferencedByRules(
  rules: (WeightedRule | ConditionRule)[],
): string[] {
  return dedupeSorted(rules.flatMap((rule) => collectConditionFields(rule.condition)));
}

// ---------------------------------------------------------------------
// Configuration-quality warnings — guidance only. These never participate
// in ../lib/icp-profile-config-validation.ts's schema validation and must
// never block a save: a profile with no fit rules yet, for instance, is
// technically valid (an author may be mid-authoring), just not yet a
// meaningful ICP.
// ---------------------------------------------------------------------

const GENERIC_FIT_IDENTITY_FIELDS = new Set(["company.domain", "company.name"]);

/** True when a fit rule's condition references ONLY the generic company-identity fields (domain/name existence) — evidence that a company record exists at all, not evidence that it's a good fit. */
export function isGenericIdentityOnlyRule(rule: WeightedRule): boolean {
  const fields = collectConditionFields(rule.condition);
  return fields.length > 0 && fields.every((field) => GENERIC_FIT_IDENTITY_FIELDS.has(field));
}

export interface ConfigWarning {
  id: string;
  message: string;
}

export function deriveConfigWarnings(config: IcpProfileConfigV1): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  if (config.fit.rules.length === 0) {
    warnings.push({
      id: "no-fit-rules",
      message:
        "No fit rules are configured yet — every account will resolve to the fallback fit band.",
    });
  } else if (config.fit.rules.every(isGenericIdentityOnlyRule)) {
    warnings.push({
      id: "generic-fit-only",
      message:
        "Every fit rule only checks that a company domain or name exists — this confirms a company record exists, not that it's a good fit. Consider adding criteria like industry, employee range, or region.",
    });
  }

  if (config.intent.rules.length === 0) {
    warnings.push({
      id: "no-intent-rules",
      message:
        "No buying-intent rules are configured yet — every account will resolve to the fallback intent band.",
    });
  }

  if (config.actionability.rules.length === 0) {
    warnings.push({
      id: "no-actionability-rules",
      message:
        "No actionability rules are configured yet — the evaluator has no way to score whether there's enough contact or CRM information to follow up.",
    });
  }

  if (
    config.eligibility.hardDisqualifiers.length === 0 &&
    config.eligibility.restrictions.length === 0
  ) {
    warnings.push({
      id: "no-eligibility-guardrails",
      message:
        "No hard disqualifiers or restrictions are configured — nothing will ever be blocked or limited on eligibility grounds.",
    });
  }

  const fitConfiguredMaximumPoints = sumRulePoints(config.fit.rules);
  for (const band of unreachableBands(config.fit.tiers, fitConfiguredMaximumPoints)) {
    warnings.push({
      id: `fit-band-unreachable-${band.code}`,
      message: `The fit band "${humanizeBandLabel(band.code)}" requires ${band.minScore} points, but the total configured fit rule weights only add up to ${fitConfiguredMaximumPoints}. This band cannot be reached with the currently configured rule weights.`,
    });
  }
  if (allBandsCollapseToFallback(config.fit.tiers, fitConfiguredMaximumPoints)) {
    warnings.push({
      id: "fit-bands-collapse-to-fallback",
      message:
        "Every configured fit band above the fallback exceeds the total configured fit rule weights — every account will resolve to the same fallback fit band regardless of which rules match.",
    });
  }

  const intentConfiguredMaximumPoints = sumRulePoints(config.intent.rules);
  for (const band of unreachableBands(config.intent.tiers, intentConfiguredMaximumPoints)) {
    warnings.push({
      id: `intent-band-unreachable-${band.code}`,
      message: `The intent band "${humanizeBandLabel(band.code)}" requires ${band.minScore} points, but the total configured intent rule weights only add up to ${intentConfiguredMaximumPoints}. This band cannot be reached with the currently configured rule weights.`,
    });
  }
  if (allBandsCollapseToFallback(config.intent.tiers, intentConfiguredMaximumPoints)) {
    warnings.push({
      id: "intent-bands-collapse-to-fallback",
      message:
        "Every configured intent band above the fallback exceeds the total configured intent rule weights — every account will resolve to the same fallback intent band regardless of which rules match.",
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------
// "How this ICP works" — the plain-language profile summary. Every field
// below is derived directly from the config; nothing is inferred beyond
// what the config literally contains, and an empty dimension is reported
// truthfully as empty, never papered over.
// ---------------------------------------------------------------------

export interface DimensionSummary {
  ruleCount: number;
  /** Plain-language attribute/signal labels the dimension's rules actually reference, deduplicated. */
  attributes: string[];
}

export interface EligibilitySummary {
  hardDisqualifierCount: number;
  restrictionCount: number;
  /** One sentence per configured hard disqualifier, in author order. */
  hardDisqualifierSentences: string[];
  /** One sentence per configured restriction, in author order. */
  restrictionSentences: string[];
}

export interface IcpProfileSummary {
  fit: DimensionSummary;
  intent: DimensionSummary;
  actionability: DimensionSummary;
  eligibility: EligibilitySummary;
  fitBands: BandSummary[];
  intentBands: BandSummary[];
  fitTotalPoints: number;
  intentTotalPoints: number;
  actionabilityTotalPoints: number;
}

function summarizeScoredDimension(rules: WeightedRule[]): DimensionSummary {
  return {
    ruleCount: rules.length,
    attributes: fieldsReferencedByRules(rules).map(humanizeFieldLabel),
  };
}

export function buildIcpProfileSummary(config: IcpProfileConfigV1): IcpProfileSummary {
  return {
    fit: summarizeScoredDimension(config.fit.rules),
    intent: summarizeScoredDimension(config.intent.rules),
    actionability: summarizeScoredDimension(config.actionability.rules),
    eligibility: {
      hardDisqualifierCount: config.eligibility.hardDisqualifiers.length,
      restrictionCount: config.eligibility.restrictions.length,
      hardDisqualifierSentences: config.eligibility.hardDisqualifiers.map((rule) =>
        describeEligibilityRuleSentence("hardDisqualifier", rule),
      ),
      restrictionSentences: config.eligibility.restrictions.map((rule) =>
        describeEligibilityRuleSentence("restriction", rule),
      ),
    },
    fitBands: summarizeBands(config.fit.tiers),
    intentBands: summarizeBands(config.intent.tiers),
    fitTotalPoints: sumRulePoints(config.fit.rules),
    intentTotalPoints: sumRulePoints(config.intent.rules),
    actionabilityTotalPoints: sumRulePoints(config.actionability.rules),
  };
}

// Re-exported so callers of this module don't also need to import
// FieldAllowlist from @workspace/evaluator just to satisfy TypeScript on
// call sites that pass one through unrelated props.
export type { FieldAllowlist };
