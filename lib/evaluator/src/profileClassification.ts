// Profile-library classification — a pure, shared summary of "what kind
// of profile config is this" for the profile-library list and detail
// surfaces (see artifacts/api-server/src/services/icpProfiles.ts's
// buildProfileListItem and artifacts/druid-gtm/src/pages/
// settings-icp-profiles.tsx). Deliberately business-first: no points, no
// thresholds, no rule counts, no rule ids, no condition-tree shape —
// just which of a small set of plain-language categories a config
// currently falls into, plus which target-company criteria it directly
// configures.
//
// classifyProfileConfig/targetCriteria operate on any IcpProfileConfigV1
// — an active version's config, a draft's config, or any other config a
// caller has in hand. Neither function assumes "the" config passed in is
// specifically the active version; callers decide which config (active,
// draft, or both) they want classified.

import type { RuleCondition } from "./conditions.js";
import type { IcpProfileConfigV1, WeightedRule } from "./profileConfig.js";
import {
  isMeaningfulFitRule,
  isMeaningfulFitLeaf,
  isBlankScalar,
  type MeaningfulFitField,
} from "./publicationReadiness.js";
import { isIntentConfigured } from "./configClassification.js";
import { isLegacyStarterIcpConfig } from "./legacyStarterDetection.js";

export type ProfileClassification =
  | "no_active_definition"
  | "legacy_starter"
  | "incomplete"
  | "fit_only"
  | "fit_plus_intent";

/**
 * Classifies a config:
 *   - "no_active_definition" — `config` is null (the caller had no config to classify — e.g. no active version exists).
 *   - "legacy_starter" — the config is the exact legacy bootstrap signature (see isLegacyStarterIcpConfig).
 *   - "incomplete" — no meaningful Target company (fit) criteria yet (see isMeaningfulFitRule — the same bar publishDraft() enforces).
 *   - "fit_only" — meaningful fit criteria, but zero configured intent rules.
 *   - "fit_plus_intent" — meaningful fit criteria AND at least one configured intent rule.
 */
export function classifyProfileConfig(
  config: IcpProfileConfigV1 | null,
): ProfileClassification {
  if (config === null) return "no_active_definition";
  if (isLegacyStarterIcpConfig(config)) return "legacy_starter";
  if (!config.fit.rules.some(isMeaningfulFitRule)) return "incomplete";
  return isIntentConfigured(config) ? "fit_plus_intent" : "fit_only";
}

// ---------------------------------------------------------------------
// Structured target-summary extraction. Deliberately much stricter than
// isMeaningfulFitRule's publish-readiness bar: only SIMPLE, directly
// supported fit rules contribute a criterion here — a rule whose
// condition is ITSELF (not buried inside an and/or/not) an eq/in leaf on
// one of the seven meaningful fields, with points > 0. Compound
// conditions are never recursed into and never flattened into this
// summary, so e.g. `not(industry = Banking)` — a real restriction, not a
// positive "targets Banking" criterion — correctly contributes nothing
// here, and remains visible only in the Technical view. This function
// only reads rules; it never rewrites or discards any of them.
// ---------------------------------------------------------------------

export type TargetCriterionField = MeaningfulFitField;
export type TargetCriterionOperator = "eq" | "in";

export interface TargetCriterion {
  field: TargetCriterionField;
  operator: TargetCriterionOperator;
  values: (string | number | boolean)[];
}

type MeaningfulFitLeaf = Extract<RuleCondition, { op: "eq" | "in" }> & {
  field: MeaningfulFitField;
};

// Guarantees a stable, collision-free string key for any scalar literal
// regardless of type — `JSON.stringify(1)` and `JSON.stringify("1")`
// would otherwise collide ("1" both times); tagging with `typeof` first
// keeps every distinct (type, value) pair distinct.
function primitiveKey(value: string | number | boolean): string {
  return JSON.stringify([typeof value, value]);
}

// Always a fresh array, never a reference into the original config's
// `values` — for `in`, blank (empty/whitespace-only) entries are omitted
// entirely (a mixed array like ["Banking", ""] is still meaningful
// overall — see isMeaningfulFitLeaf — but the blank entry itself is
// never a real target value), and the remaining values are deduplicated
// and sorted by primitiveKey so semantically identical criteria (the
// same set, authored in a different order, or with a repeated value)
// produce the exact same TargetCriterion and dedupe together in
// targetCriteria below.
function normalizedValues(condition: MeaningfulFitLeaf): (string | number | boolean)[] {
  if (condition.op === "eq") return [condition.value];
  const byKey = new Map<string, string | number | boolean>();
  for (const value of condition.values) {
    if (isBlankScalar(value)) continue;
    byKey.set(primitiveKey(value), value);
  }
  return Array.from(byKey.keys())
    .sort()
    .map((key) => byKey.get(key)!);
}

function ruleToTargetCriterion(rule: WeightedRule): TargetCriterion | null {
  if (rule.points <= 0) return null;
  const condition = rule.condition;
  if (!isMeaningfulFitLeaf(condition)) return null;
  return {
    field: condition.field,
    operator: condition.op,
    values: normalizedValues(condition),
  };
}

function criterionKey(criterion: TargetCriterion): string {
  return JSON.stringify([criterion.field, criterion.operator, criterion.values]);
}

/**
 * Deterministic, deduplicated target-company criteria — one per distinct
 * (field, operator, values) combination found among this config's
 * simple, directly supported fit rules (see ruleToTargetCriterion).
 * Sorted by the same key used for deduplication, so callers get a stable
 * order across calls for the same config regardless of the author's
 * original rule order. Never points, rule ids, or thresholds — only the
 * actual configured criteria, retaining real values so a caller can
 * build a summary like "Banking and Insurance companies in EMEA". Every
 * returned `values` array is a fresh copy, never a reference owned by
 * the original config.
 */
export function targetCriteria(config: IcpProfileConfigV1 | null): TargetCriterion[] {
  if (config === null) return [];

  const byKey = new Map<string, TargetCriterion>();
  for (const rule of config.fit.rules) {
    const criterion = ruleToTargetCriterion(rule);
    if (criterion === null) continue;
    byKey.set(criterionKey(criterion), criterion);
  }

  return Array.from(byKey.keys())
    .sort()
    .map((key) => byKey.get(key)!);
}
