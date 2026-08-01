// Pure draft-vs-active configuration comparison logic for
// ../components/icp-profile-comparison.tsx. No DOM needed.
//
// Matches rules by their stable `id` and tiers by their stable `code` —
// NEVER by array position — so reordering alone (same set of ids/codes,
// different order) produces zero added/removed/changed entries, all
// falling into `unchangedCount`. This is a pure configuration diff only:
// it never estimates impact, affected-account counts, or re-score
// results — those would require running the evaluator against real
// accounts, which is explicitly out of scope for this comparison.

import type {
  IcpProfileConfigV1,
  WeightedRule,
  ConditionRule,
  Tier,
} from "@workspace/evaluator";

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";

export interface DiffEntry<T> {
  /** The stable id (rules) or code (tiers) this entry was matched on. */
  key: string;
  status: Exclude<DiffStatus, "unchanged">;
  /** Present for "added" and "changed"; null for "removed". */
  draft: T | null;
  /** Present for "removed" and "changed"; null for "added". */
  active: T | null;
  /** Which fields differ — empty for "added"/"removed" (the whole item is new/gone, not partially different). */
  changedFields: string[];
}

export interface SectionDiff<T> {
  added: DiffEntry<T>[];
  removed: DiffEntry<T>[];
  changed: DiffEntry<T>[];
  unchangedCount: number;
}

function isRecordSectionEmpty<T>(diff: SectionDiff<T>): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

export function sectionHasDifferences<T>(diff: SectionDiff<T>): boolean {
  return !isRecordSectionEmpty(diff);
}

// Generic core: matches items from `draftItems`/`activeItems` by a
// caller-supplied key (never by array index/position — this is what
// makes pure reordering a no-op), and classifies each matched pair via
// `changedFieldsOf`.
function diffSection<T>(
  draftItems: T[],
  activeItems: T[],
  keyOf: (item: T) => string,
  changedFieldsOf: (draft: T, active: T) => string[],
): SectionDiff<T> {
  const draftByKey = new Map(draftItems.map((item) => [keyOf(item), item]));
  const activeByKey = new Map(activeItems.map((item) => [keyOf(item), item]));

  const added: DiffEntry<T>[] = [];
  const changed: DiffEntry<T>[] = [];
  let unchangedCount = 0;

  for (const [key, draftItem] of draftByKey) {
    const activeItem = activeByKey.get(key);
    if (!activeItem) {
      added.push({ key, status: "added", draft: draftItem, active: null, changedFields: [] });
      continue;
    }
    const changedFields = changedFieldsOf(draftItem, activeItem);
    if (changedFields.length > 0) {
      changed.push({ key, status: "changed", draft: draftItem, active: activeItem, changedFields });
    } else {
      unchangedCount++;
    }
  }

  const removed: DiffEntry<T>[] = [];
  for (const [key, activeItem] of activeByKey) {
    if (!draftByKey.has(key)) {
      removed.push({ key, status: "removed", draft: null, active: activeItem, changedFields: [] });
    }
  }

  return { added, removed, changed, unchangedCount };
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function weightedRuleChangedFields(draft: WeightedRule, active: WeightedRule): string[] {
  const fields: string[] = [];
  if (draft.description !== active.description) fields.push("description");
  if (draft.points !== active.points) fields.push("points");
  if (!jsonEqual(draft.condition, active.condition)) fields.push("condition");
  return fields;
}

function conditionRuleChangedFields(draft: ConditionRule, active: ConditionRule): string[] {
  const fields: string[] = [];
  if (draft.description !== active.description) fields.push("description");
  if (!jsonEqual(draft.condition, active.condition)) fields.push("condition");
  return fields;
}

function tierChangedFields(draft: Tier, active: Tier): string[] {
  return draft.minScore !== active.minScore ? ["minScore"] : [];
}

function diffRules(draft: WeightedRule[], active: WeightedRule[]): SectionDiff<WeightedRule> {
  return diffSection(draft, active, (r) => r.id, weightedRuleChangedFields);
}

function diffConditionRules(
  draft: ConditionRule[],
  active: ConditionRule[],
): SectionDiff<ConditionRule> {
  return diffSection(draft, active, (r) => r.id, conditionRuleChangedFields);
}

function diffTiers(draft: Tier[], active: Tier[]): SectionDiff<Tier> {
  return diffSection(draft, active, (t) => t.code, tierChangedFields);
}

export interface NotesDiff {
  draft: string | null;
  active: string | null;
  changed: boolean;
}

function diffNotes(draftNotes: string | null, activeNotes: string | null): NotesDiff {
  return {
    draft: draftNotes,
    active: activeNotes,
    changed: (draftNotes ?? "") !== (activeNotes ?? ""),
  };
}

export interface ProfileConfigDiff {
  fit: { rules: SectionDiff<WeightedRule>; tiers: SectionDiff<Tier> };
  intent: { rules: SectionDiff<WeightedRule>; tiers: SectionDiff<Tier> };
  actionability: { rules: SectionDiff<WeightedRule> };
  eligibility: {
    hardDisqualifiers: SectionDiff<ConditionRule>;
    restrictions: SectionDiff<ConditionRule>;
  };
  notes: NotesDiff;
}

export function diffProfileConfigs(
  draftConfig: IcpProfileConfigV1,
  activeConfig: IcpProfileConfigV1,
  draftNotes: string | null,
  activeNotes: string | null,
): ProfileConfigDiff {
  return {
    fit: {
      rules: diffRules(draftConfig.fit.rules, activeConfig.fit.rules),
      tiers: diffTiers(draftConfig.fit.tiers, activeConfig.fit.tiers),
    },
    intent: {
      rules: diffRules(draftConfig.intent.rules, activeConfig.intent.rules),
      tiers: diffTiers(draftConfig.intent.tiers, activeConfig.intent.tiers),
    },
    actionability: {
      rules: diffRules(draftConfig.actionability.rules, activeConfig.actionability.rules),
    },
    eligibility: {
      hardDisqualifiers: diffConditionRules(
        draftConfig.eligibility.hardDisqualifiers,
        activeConfig.eligibility.hardDisqualifiers,
      ),
      restrictions: diffConditionRules(
        draftConfig.eligibility.restrictions,
        activeConfig.eligibility.restrictions,
      ),
    },
    notes: diffNotes(draftNotes, activeNotes),
  };
}

// Whole-diff "is there anything to show at all" check — used to decide
// between "these are identical" and rendering the full breakdown.
export function profileConfigDiffIsEmpty(diff: ProfileConfigDiff): boolean {
  return (
    !sectionHasDifferences(diff.fit.rules) &&
    !sectionHasDifferences(diff.fit.tiers) &&
    !sectionHasDifferences(diff.intent.rules) &&
    !sectionHasDifferences(diff.intent.tiers) &&
    !sectionHasDifferences(diff.actionability.rules) &&
    !sectionHasDifferences(diff.eligibility.hardDisqualifiers) &&
    !sectionHasDifferences(diff.eligibility.restrictions) &&
    !diff.notes.changed
  );
}
