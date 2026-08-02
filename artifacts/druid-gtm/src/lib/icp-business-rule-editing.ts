// Pure, DOM-free editing helpers for the ICP draft editor's BUSINESS
// view (../components/icp-business-rule-list-section.tsx and its row
// components) — mirrors ../lib/icp-profile-config-editing.ts's existing
// discipline (plain data in, new values out, no React state, no DOM) but
// scoped to the specific concern the business view has that the
// technical editor doesn't: editing a SIMPLE subset of a rule array by
// rule id, while every function still operates on and returns the FULL
// array via an immutable update (never mutates the input array or any
// rule object in place). A "simple" rule is never distinguished by
// filtering the array the caller holds — every function below takes and
// returns the complete rules array, so an "advanced" rule sitting
// alongside the simple ones a business row edits/removes/duplicates is
// never touched, flattened, or discarded.
//
// Business-simple classification itself (isSimpleFitRule/
// isSimpleIntentRule) lives in @workspace/evaluator, not here — this
// module only edits arrays; it never decides what counts as "simple".

import {
  WEIGHT_PRESET_VALUES,
  type WeightedRule,
} from "@workspace/evaluator";
import { generateRuleId } from "./icp-profile-config-editing";

// ---------------------------------------------------------------------
// Partitioning — read-only split of a rules array into the subset a
// classifier considers "simple" vs everything else ("advanced"). Order
// within each partition matches the original array's order; nothing is
// reordered, mutated, or dropped — a rule appears in exactly one of the
// two returned arrays.
// ---------------------------------------------------------------------

export interface RulePartition<T> {
  simple: T[];
  advanced: T[];
}

export function partitionRules<T>(
  rules: T[],
  isSimple: (rule: T) => boolean,
): RulePartition<T> {
  const simple: T[] = [];
  const advanced: T[] = [];
  for (const rule of rules) {
    (isSimple(rule) ? simple : advanced).push(rule);
  }
  return { simple, advanced };
}

// ---------------------------------------------------------------------
// Immutable array edits by rule id — the business row components call
// these against the FULL rules array (e.g. config.fit.rules), never a
// filtered "simple" subset, so an advanced rule elsewhere in the same
// array is always preserved untouched. Every function returns a new
// array; none of them mutate their input.
// ---------------------------------------------------------------------

/**
 * Replaces the rule matching `id` with `next`. Throws if `next.id` does
 * not equal `id` — a business-row edit must never accidentally change a
 * rule's identity or introduce a duplicate id elsewhere in the array; a
 * caller that genuinely wants a new id should remove and add, not edit.
 */
export function updateRuleById<T extends { id: string }>(
  rules: T[],
  id: string,
  next: T,
): T[] {
  if (next.id !== id) {
    throw new Error(
      `updateRuleById: replacement rule id "${next.id}" does not match the target id "${id}".`,
    );
  }
  return rules.map((rule) => (rule.id === id ? next : rule));
}

export function removeRuleById<T extends { id: string }>(rules: T[], id: string): T[] {
  return rules.filter((rule) => rule.id !== id);
}

/**
 * Inserts `duplicate` immediately after the rule matching `id`. Returns
 * `rules` unchanged (never a silent append) when `id` isn't found — a
 * missing source id means the caller's own state is stale relative to
 * what it's operating on, which should surface as a no-op here rather
 * than fabricate a new position for the duplicate.
 */
export function duplicateRuleAfterId<T extends { id: string }>(
  rules: T[],
  id: string,
  duplicate: T,
): T[] {
  const index = rules.findIndex((rule) => rule.id === id);
  if (index === -1) return rules;
  return [...rules.slice(0, index + 1), duplicate, ...rules.slice(index + 1)];
}

export function appendRule<T>(rules: T[], rule: T): T[] {
  return [...rules, rule];
}

/**
 * Clones a WeightedRule for the "Duplicate" business-row action: a fresh
 * id (via generateRuleId — the same id-minting convention every other
 * rule constructor in this codebase uses) and an independently-owned
 * deep copy of `condition` (via structuredClone — the condition schema
 * is plain serializable data, so this is safe, and avoids the duplicate
 * silently sharing a condition object reference with the original that a
 * later edit to one could then leak into the other). `description` and
 * `points` are copied exactly as authored. Never used to construct a
 * rule's initial state — only to duplicate an existing one.
 */
export function duplicateSimpleRule(rule: WeightedRule): WeightedRule {
  return { ...rule, id: generateRuleId("rule"), condition: structuredClone(rule.condition) };
}

// ---------------------------------------------------------------------
// New simple-rule constructors — each starts in an already schema-valid
// shape (see lib/evaluator/src/conditions.ts's ruleConditionSchema) so
// "Add rule" never immediately produces a validation error, and each
// matches its dimension's isSimpleFitRule/isSimpleIntentRule bar exactly
// (Supporting-weighted, a directly supported leaf shape) so a freshly
// added rule renders as an editable business row, never as "Advanced",
// until the author changes it into an unsupported shape themselves.
// ---------------------------------------------------------------------

// WeightedRuleSchema requires a non-empty `description` (RuleIdSchema-
// style identifiers can't be blank either, but `id` is always minted by
// generateRuleId) — unlike ../lib/icp-profile-config-editing.ts's
// technical newWeightedRule(), which starts `description` blank and
// relies on the draft editor's live validation to block Save until the
// author fills it in, these business constructors must be schema-valid
// immediately (the business "Add rule" flow has no separate "advanced/
// technical" affordance to explain a validation error against). Each
// gets a generic, honest placeholder description the author is expected
// to replace; only the CRITERION VALUE (company.industry's `value: ""`)
// is left for the author to fill in.

/** An eq leaf on company.industry (a supported fit shape) with a blank value, at the Supporting weight — the author fills in the real value. Structurally simple immediately; not yet a MEANINGFUL criterion until a real value is typed in (see @workspace/evaluator's isMeaningfulFitLeaf vs isSupportedFitCriterionLeaf). */
export function newSimpleFitRule(): WeightedRule {
  return {
    id: generateRuleId("rule"),
    description: "New target criterion",
    points: WEIGHT_PRESET_VALUES.supporting,
    condition: { op: "eq", field: "company.industry", value: "" },
  };
}

/** The "is a repeat visitor" shape (eq on engagement.repeatVisit), at the Supporting weight — the only supported intent shape whose default value (true) is meaningful without the author typing anything first. */
export function newSimpleIntentRule(): WeightedRule {
  return {
    id: generateRuleId("rule"),
    description: "New buying signal",
    points: WEIGHT_PRESET_VALUES.supporting,
    condition: { op: "eq", field: "engagement.repeatVisit", value: true },
  };
}
