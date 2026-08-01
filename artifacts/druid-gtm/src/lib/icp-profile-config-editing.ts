// Pure, DOM-free editing helpers for the ICP draft editor
// (../components/icp-profile-draft-editor.tsx,
// ../components/icp-rule-editor.tsx, ../components/icp-condition-editor.tsx,
// ../components/icp-tier-editor.tsx). Every function here operates only on
// plain data (IcpProfileConfigV1 and its parts, from @workspace/evaluator)
// and returns new values — no React state, no DOM — so the editor's
// add/duplicate/reorder/remove/starter-config/id-generation behavior is
// fully unit-testable without a DOM (this package has no
// jsdom/testing-library — see ../lib/accounts-api.limit.test.ts).
//
// Validation is deliberately NOT here — see
// ../lib/icp-profile-config-validation.ts, which runs the real
// IcpProfileConfigV1Schema (the single source of truth) rather than
// reimplementing any of its rules.

import type {
  IcpProfileConfigV1,
  WeightedRule,
  ConditionRule,
  Tier,
  RuleCondition,
  FieldAllowlist,
} from "@workspace/evaluator";

// ---------------------------------------------------------------------
// Rule/tier id generation. RuleIdSchema/TierCodeSchema both require
// lowercase snake_case starting with a letter
// (lib/evaluator/src/profileConfig.ts's IDENTIFIER_PATTERN,
// ^[a-z][a-z0-9_]*$) — crypto.randomUUID()'s hex characters (already
// lowercase) satisfy that once hyphens are stripped, so a fixed
// lowercase-letter prefix plus a UUID fragment always produces a valid,
// effectively-unique id without needing a server round-trip.
//
// Generated ONCE, when a rule/disqualifier/restriction is first created
// (via newWeightedRule/newConditionRule) or explicitly duplicated (via
// duplicateWeightedRule/duplicateConditionRule) — never regenerated for
// an existing rule the user is merely editing the description/points/
// condition of. The draft editor is responsible for preserving an
// existing rule's `id` field untouched across every edit that isn't an
// explicit "duplicate".
// ---------------------------------------------------------------------

export type RuleIdPrefix = "rule" | "hard_disqualifier" | "restriction" | "tier";

export function generateRuleId(prefix: RuleIdPrefix = "rule"): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `${prefix}_${suffix}`;
}

// ---------------------------------------------------------------------
// Starter config for a brand-new profile — the ONLY thing that must be
// true is structural validity (IcpProfileConfigV1Schema.safeParse must
// accept it): empty rule collections everywhere, and exactly the
// required minimum per scored dimension — one tier, at minScore 0 (the
// schema's own required floor tier). No rules are invented; a new
// profile starts with nothing scored and nothing disqualified until the
// author adds real criteria.
//
// The required minScore-0 tier's `code` is the one thing that must have
// SOME value (RuleIdSchema-shaped identifiers can't be blank), so it is
// given an honest, dimension-specific label describing what it actually
// means — "no rule has matched yet" — rather than an arbitrary word like
// "base"/"floor"/"unscored" that carries no meaning to a non-technical
// author. Tier `code` must be lowercase snake_case (see TierCodeSchema);
// every display surface (icp-tier-editor.tsx, icp-preview-presentation.ts)
// humanizes it (e.g. "not_yet_qualified" -> "Not Yet Qualified") rather
// than showing the raw code as prose.
// ---------------------------------------------------------------------

export function buildStarterProfileConfig(): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "not_yet_qualified", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "no_observed_intent", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

// ---------------------------------------------------------------------
// Business-friendly weight presets. A rule's `points` field is a plain
// number with no fixed scale (see profileConfig.ts) — most authors don't
// need to pick an arbitrary integer, they need to say how much a
// criterion matters. These three documented values are the only thing a
// "preset" ever means; picking one always sets `points` to exactly this
// number, deterministically. An existing rule whose points value doesn't
// match any of these three is presented as "Advanced" (see
// ../components/icp-rule-list-section.tsx) — its value is never silently
// snapped to the nearest preset.
// ---------------------------------------------------------------------

export const WEIGHT_PRESET_VALUES = {
  supporting: 5,
  important: 15,
  critical: 30,
} as const;

export type WeightPresetKey = keyof typeof WEIGHT_PRESET_VALUES;

export const WEIGHT_PRESET_ORDER: WeightPresetKey[] = [
  "supporting",
  "important",
  "critical",
];

export const WEIGHT_PRESET_LABELS: Record<WeightPresetKey, string> = {
  supporting: "Supporting",
  important: "Important",
  critical: "Critical",
};

/** Returns the preset key whose documented value exactly matches `points`, or null when it doesn't match any preset (i.e. an "Advanced"/custom value). */
export function weightPresetForPoints(points: number): WeightPresetKey | null {
  for (const key of WEIGHT_PRESET_ORDER) {
    if (WEIGHT_PRESET_VALUES[key] === points) return key;
  }
  return null;
}

// ---------------------------------------------------------------------
// Default leaf condition for a newly-added rule — "is present" against
// the dimension's first allowed field. Never a fabricated eq/in/gte
// comparison with a guessed value; "exists" is the only leaf op with no
// value to guess.
// ---------------------------------------------------------------------

export function defaultLeafCondition(allowlist: FieldAllowlist): RuleCondition {
  const [firstField] = Object.keys(allowlist);
  return { op: "exists", field: firstField ?? "" };
}

// ---------------------------------------------------------------------
// New / duplicate rule constructors.
// ---------------------------------------------------------------------

export function newWeightedRule(allowlist: FieldAllowlist): WeightedRule {
  return {
    id: generateRuleId("rule"),
    description: "",
    points: 0,
    condition: defaultLeafCondition(allowlist),
  };
}

export function duplicateWeightedRule(rule: WeightedRule): WeightedRule {
  return { ...rule, id: generateRuleId("rule") };
}

export function newConditionRule(
  allowlist: FieldAllowlist,
  prefix: Extract<RuleIdPrefix, "hard_disqualifier" | "restriction">,
): ConditionRule {
  return {
    id: generateRuleId(prefix),
    description: "",
    condition: defaultLeafCondition(allowlist),
  };
}

export function duplicateConditionRule(
  rule: ConditionRule,
  prefix: Extract<RuleIdPrefix, "hard_disqualifier" | "restriction">,
): ConditionRule {
  return { ...rule, id: generateRuleId(prefix) };
}

// ---------------------------------------------------------------------
// New tier. Unlike rule ids, a tier's `code` is a real, user-authored
// label (see lib/evaluator/src/profileConfig.ts's own comment: "a
// profile author could call it 'floor', 'base', 'entry', or anything
// else") — so it is intentionally left blank here for the author to
// name, never auto-generated.
// ---------------------------------------------------------------------

export function newTier(): Tier {
  return { code: "", minScore: 0 };
}

// ---------------------------------------------------------------------
// Generic array operations, used for rules, tiers, and condition-group
// children alike. All pure — return a new array, never mutate the input.
// ---------------------------------------------------------------------

export function replaceItemAt<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, i) => (i === index ? value : item));
}

export function removeItemAt<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  const tmp = next[index]!;
  next[index] = next[target]!;
  next[target] = tmp;
  return next;
}

// ---------------------------------------------------------------------
// Condition-tree editing — operates only on "and"/"or" group nodes
// (the only condition shapes with a `conditions` child array) and "not"
// nodes (a single `condition` child). Used by
// ../components/icp-condition-editor.tsx's recursive rendering.
// ---------------------------------------------------------------------

type GroupCondition = Extract<RuleCondition, { op: "and" | "or" }>;
type NotCondition = Extract<RuleCondition, { op: "not" }>;

export function isGroupCondition(condition: RuleCondition): condition is GroupCondition {
  return condition.op === "and" || condition.op === "or";
}

export function isNotCondition(condition: RuleCondition): condition is NotCondition {
  return condition.op === "not";
}

export function addConditionChild(
  group: GroupCondition,
  child: RuleCondition,
): GroupCondition {
  return { ...group, conditions: [...group.conditions, child] };
}

export function replaceConditionChildAt(
  group: GroupCondition,
  index: number,
  child: RuleCondition,
): GroupCondition {
  return { ...group, conditions: replaceItemAt(group.conditions, index, child) };
}

export function removeConditionChildAt(
  group: GroupCondition,
  index: number,
): GroupCondition {
  return { ...group, conditions: removeItemAt(group.conditions, index) };
}
