import { type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  WEIGHT_PRESET_ORDER,
  WEIGHT_PRESET_LABELS,
  WEIGHT_PRESET_VALUES,
} from "@/lib/icp-profile-config-editing";
import { weightPresetForPoints, type WeightPresetKey } from "@workspace/evaluator";
import {
  partitionRules,
  updateRuleById,
  removeRuleById,
  duplicateRuleAfterId,
  appendRule,
} from "@/lib/icp-business-rule-editing";

// Importance selector for a simple business rule row — deliberately only
// the three business weight presets (Supporting/Important/Critical), no
// "Advanced (exact points)" escape hatch like the technical weight
// editor (../components/icp-rule-list-section.tsx's WeightEditor) has.
// Picking an option always sets `points` to exactly that preset's
// documented value, from the same @workspace/evaluator constants that
// define what "simple" means — so a row edited here can never silently
// drift into a custom/Advanced points value.
export function ImportanceSelect({
  points,
  onChange,
}: {
  points: number;
  onChange: (points: number) => void;
}) {
  const preset = weightPresetForPoints(points);
  return (
    <div className="w-40 shrink-0 space-y-1.5">
      <label className="text-xs text-muted-foreground">Importance</label>
      <Select
        value={preset ?? undefined}
        onValueChange={(value) => onChange(WEIGHT_PRESET_VALUES[value as WeightPresetKey])}
      >
        <SelectTrigger className="h-8 text-sm w-full">
          <SelectValue placeholder="Choose importance" />
        </SelectTrigger>
        <SelectContent>
          {WEIGHT_PRESET_ORDER.map((key) => (
            <SelectItem key={key} value={key}>
              {WEIGHT_PRESET_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export interface BusinessRuleRowActions<T> {
  onChange: (next: T) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  /** False once allRules.length has already reached maxRules — a row component should disable its Duplicate control when this is false, the same way BusinessRuleListSection's own "Add" button disables itself. */
  canDuplicate: boolean;
}

/**
 * Business editing wrapper for a rule array that supports simple,
 * directly-editable rows (see @workspace/evaluator's
 * isSimpleFitRule/isSimpleIntentRule) alongside advanced/compound rules
 * that stay Technical-only. Always operates on the FULL `allRules` array
 * — every edit/remove/duplicate/add call goes through
 * ../lib/icp-business-rule-editing.ts's by-id helpers against that same
 * full array, so an advanced rule sitting alongside the simple ones is
 * never touched, reordered, or discarded, even though it isn't rendered
 * as an editable row here.
 *
 * `duplicateRule` is a caller-supplied constructor (e.g.
 * ../lib/icp-business-rule-editing.ts's duplicateSimpleRule) rather than
 * something this generic component builds itself, so it can mint a
 * properly-typed fresh id and an independent deep copy of the rule's
 * condition without this component needing to know the concrete rule
 * type beyond `{ id: string }`.
 */
export function BusinessRuleListSection<T extends { id: string }>({
  title,
  description,
  allRules,
  isSimple,
  onChange,
  onCreateSimple,
  duplicateRule,
  renderSimpleRow,
  describeAdvanced,
  maxRules,
  emptyMessage,
  advancedNote = "Edit these in Technical configuration below.",
}: {
  title: string;
  description?: string;
  allRules: T[];
  isSimple: (rule: T) => boolean;
  onChange: (nextAllRules: T[]) => void;
  onCreateSimple: () => T;
  duplicateRule: (rule: T) => T;
  renderSimpleRow: (rule: T, actions: BusinessRuleRowActions<T>) => ReactNode;
  describeAdvanced: (rule: T) => string;
  maxRules: number;
  emptyMessage: string;
  advancedNote?: string;
}) {
  const { simple, advanced } = partitionRules(allRules, isSimple);
  // Duplicate would push the FULL array (simple + advanced) past
  // maxRules exactly like Add does — both are gated on the same
  // combined count, not just the simple subset shown here.
  const atMaxRules = allRules.length >= maxRules;

  function handleAdd() {
    if (atMaxRules) return;
    onChange(appendRule(allRules, onCreateSimple()));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-foreground">{title}</h4>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs shrink-0"
          onClick={handleAdd}
          disabled={atMaxRules}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Add
        </Button>
      </div>

      {simple.length === 0 && advanced.length === 0 && (
        <p className="text-xs text-muted-foreground italic">{emptyMessage}</p>
      )}

      {simple.length > 0 && (
        <div className="space-y-2">
          {simple.map((rule) =>
            renderSimpleRow(rule, {
              onChange: (next) => onChange(updateRuleById(allRules, rule.id, next)),
              onRemove: () => onChange(removeRuleById(allRules, rule.id)),
              onDuplicate: () => {
                if (atMaxRules) return;
                onChange(duplicateRuleAfterId(allRules, rule.id, duplicateRule(rule)));
              },
              canDuplicate: !atMaxRules,
            }),
          )}
        </div>
      )}

      {advanced.length > 0 && (
        <AdvancedCriteriaList rules={advanced} describeRule={describeAdvanced} note={advancedNote} />
      )}
    </div>
  );
}

/**
 * Read-only "Advanced criterion" summaries — one plain-language sentence
 * per rule, never the rule's raw condition tree, points, or id. Used
 * both by BusinessRuleListSection above (for the advanced remainder of a
 * partially-simple dimension) and directly by sections that have NO
 * supported simple shape at all yet (actionability, eligibility — see
 * ../components/icp-profile-draft-editor.tsx's Qualification and
 * outreach policy section).
 */
export function AdvancedCriteriaList<T extends { id: string }>({
  rules,
  describeRule,
  note,
}: {
  rules: T[];
  describeRule: (rule: T) => string;
  note: string;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/10 p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Advanced criteria ({rules.length}) — {note}
      </p>
      <ul className="space-y-1">
        {rules.map((rule) => (
          <li key={rule.id} className="text-xs text-muted-foreground/90 italic">
            {describeRule(rule)}
          </li>
        ))}
      </ul>
    </div>
  );
}
