import { useState, type ReactNode } from "react";
import { Plus, Copy, Trash2, ChevronUp, ChevronDown, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { TechnicalDetails } from "@/components/technical-details";
import type { WeightedRule, ConditionRule, FieldAllowlist } from "@workspace/evaluator";
import { ConditionEditor } from "@/components/icp-condition-editor";
import {
  replaceItemAt,
  removeItemAt,
  moveItem,
  WEIGHT_PRESET_ORDER,
  WEIGHT_PRESET_LABELS,
  WEIGHT_PRESET_VALUES,
  weightPresetForPoints,
  type WeightPresetKey,
} from "@/lib/icp-profile-config-editing";
import type { ConfigValidationIssue } from "@/lib/icp-profile-config-validation";
import {
  describeWeightedRuleSentence,
  describeEligibilityRuleSentence,
  ruleSharePercent,
  type ScoredDimension,
  type EligibilityRuleKind,
} from "@/lib/icp-profile-business-summary";

// ---------------------------------------------------------------------
// Generic add/duplicate/reorder/remove list wrapper, shared by every
// rule collection this editor has (fit rules, intent rules,
// actionability rules, hard disqualifiers, restrictions) — only the row
// rendering (WeightedRuleRow vs ConditionRuleRow below) differs between
// a weighted (has points) and unweighted (no points) rule.
// ---------------------------------------------------------------------

export interface RuleRowActions {
  onChange: (next: unknown) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  issues: ConfigValidationIssue[];
}

export function RuleListSection<T extends { id: string }>({
  title,
  description,
  rules,
  onChange,
  onCreate,
  onDuplicateItem,
  renderRow,
  maxRules,
  issuesByIndex,
  emptyLabel = "No rules yet.",
}: {
  title: string;
  description?: string;
  rules: T[];
  onChange: (next: T[]) => void;
  onCreate: () => T;
  onDuplicateItem: (item: T) => T;
  renderRow: (rule: T, index: number, actions: RuleRowActions) => ReactNode;
  maxRules: number;
  /** Validation issues for each rule, already filtered to that rule's own path. */
  issuesByIndex: (index: number) => ConfigValidationIssue[];
  emptyLabel?: string;
}) {
  function handleAdd() {
    onChange([...rules, onCreate()]);
  }

  return (
    <div className="space-y-2.5">
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
          disabled={rules.length >= maxRules}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Add rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, index) =>
            renderRow(rule, index, {
              onChange: (next) => onChange(replaceItemAt(rules, index, next as T)),
              onDuplicate: () =>
                onChange([
                  ...rules.slice(0, index + 1),
                  onDuplicateItem(rule),
                  ...rules.slice(index + 1),
                ]),
              onRemove: () => onChange(removeItemAt(rules, index)),
              onMoveUp: () => onChange(moveItem(rules, index, -1)),
              onMoveDown: () => onChange(moveItem(rules, index, 1)),
              canMoveUp: index > 0,
              canMoveDown: index < rules.length - 1,
              issues: issuesByIndex(index),
            }),
          )}
        </div>
      )}
    </div>
  );
}

// ─── Row action buttons (shared) ─────────────────────────────────────────────
function RuleRowActionButtons({
  onDuplicate,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: Pick<
  RuleRowActions,
  "onDuplicate" | "onRemove" | "onMoveUp" | "onMoveDown" | "canMoveUp" | "canMoveDown"
>) {
  return (
    <div className="flex items-start gap-0.5 shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onMoveUp}
        disabled={!canMoveUp}
        aria-label="Move up"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onMoveDown}
        disabled={!canMoveDown}
        aria-label="Move down"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onDuplicate}
        aria-label="Duplicate rule"
      >
        <Copy className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-red-400 hover:text-red-300"
        onClick={onRemove}
        aria-label="Remove rule"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function RuleIssueList({ issues }: { issues: ConfigValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {issues.map((issue, i) => (
        <li key={i} className="text-[11px] text-red-400 flex items-start gap-1">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

// ─── Weight editor: business-friendly presets, with an Advanced numeric
// escape hatch. The select's displayed value is always derived from
// `points` (never a separate source of truth) so it can never silently
// diverge from what's actually saved — an existing arbitrary value that
// doesn't match a preset is presented as "Advanced" and its exact number
// is shown, untouched, until the author explicitly picks something else.
// ─────────────────────────────────────────────────────────────────────
type WeightMode = WeightPresetKey | "advanced";

function WeightEditor({
  points,
  onChange,
}: {
  points: number;
  onChange: (points: number) => void;
}) {
  // Only overrides the derived mode while the author is actively viewing
  // the numeric field for a value that WOULD otherwise match a preset —
  // e.g. after typing a preset's exact number by hand. Never itself the
  // source of truth for what gets saved.
  const [advancedOverride, setAdvancedOverride] = useState(false);
  const derivedPreset = weightPresetForPoints(points);
  const mode: WeightMode = advancedOverride || !derivedPreset ? "advanced" : derivedPreset;

  function handleModeChange(next: WeightMode) {
    if (next === "advanced") {
      setAdvancedOverride(true);
      return;
    }
    setAdvancedOverride(false);
    onChange(WEIGHT_PRESET_VALUES[next]);
  }

  return (
    <div className="w-40 shrink-0 space-y-1.5">
      <Label className="text-xs text-muted-foreground">Weight</Label>
      <Select value={mode} onValueChange={(v) => handleModeChange(v as WeightMode)}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WEIGHT_PRESET_ORDER.map((key) => (
            <SelectItem key={key} value={key}>
              {WEIGHT_PRESET_LABELS[key]} ({WEIGHT_PRESET_VALUES[key]} pts)
            </SelectItem>
          ))}
          <SelectItem value="advanced">Advanced (exact points)</SelectItem>
        </SelectContent>
      </Select>
      {mode === "advanced" && (
        <Input
          type="number"
          min={0}
          value={points}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 text-sm"
          aria-label="Exact points"
        />
      )}
    </div>
  );
}

// ─── Weighted rule row (fit / intent / actionability) ────────────────────────
export function WeightedRuleRow({
  rule,
  allowlist,
  dimension,
  totalPoints,
  actions,
}: {
  rule: WeightedRule;
  allowlist: FieldAllowlist;
  /** Which scored dimension this rule belongs to — drives the "Award N <dimension> points…" sentence and the weight preset labels. */
  dimension: ScoredDimension;
  /** Sum of every rule's points currently configured in this dimension — used only to show this rule's share of the total, never to change what's saved. */
  totalPoints: number;
  actions: RuleRowActions;
}) {
  const onChange = actions.onChange as (next: WeightedRule) => void;
  const share = ruleSharePercent(rule.points, totalPoints);
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              value={rule.description}
              onChange={(e) => onChange({ ...rule, description: e.target.value })}
              placeholder="e.g. Company has a known domain"
              className="h-8 text-sm"
            />
          </div>
          <WeightEditor
            points={rule.points}
            onChange={(points) => onChange({ ...rule, points })}
          />
          <div className="pt-5">
            <RuleRowActionButtons {...actions} />
          </div>
        </div>

        {share !== null && (
          <p className="text-[11px] text-muted-foreground/70">
            {rule.points} of {totalPoints} configured {dimension} points ({share}% of this
            dimension&apos;s current total) — a weight, not a score out of 100.
          </p>
        )}

        <ConditionEditor
          condition={rule.condition}
          allowlist={allowlist}
          depth={1}
          onChange={(condition) => onChange({ ...rule, condition })}
        />

        <p className="text-[11px] text-muted-foreground/70 italic">
          {describeWeightedRuleSentence(dimension, rule)}
        </p>

        <RuleIssueList issues={actions.issues} />

        <TechnicalDetails summary="Rule ID">
          <p className="font-mono text-[11px] text-muted-foreground/80">{rule.id}</p>
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

// ─── Condition-only rule row (eligibility hard disqualifiers / restrictions) ─
export function ConditionRuleRow({
  rule,
  allowlist,
  kind,
  actions,
}: {
  rule: ConditionRule;
  allowlist: FieldAllowlist;
  /** Whether this row is a hard disqualifier or a restriction — drives the "Disqualify outright…"/"Restrict outreach…" sentence. */
  kind: EligibilityRuleKind;
  actions: RuleRowActions;
}) {
  const onChange = actions.onChange as (next: ConditionRule) => void;
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              value={rule.description}
              onChange={(e) => onChange({ ...rule, description: e.target.value })}
              placeholder="e.g. Marked as an existing competitor"
              className="h-8 text-sm"
            />
          </div>
          <div className="pt-5">
            <RuleRowActionButtons {...actions} />
          </div>
        </div>

        <ConditionEditor
          condition={rule.condition}
          allowlist={allowlist}
          depth={1}
          onChange={(condition) => onChange({ ...rule, condition })}
        />

        <p className="text-[11px] text-muted-foreground/70 italic">
          {describeEligibilityRuleSentence(kind, rule)}
        </p>

        <RuleIssueList issues={actions.issues} />

        <TechnicalDetails summary="Rule ID">
          <p className="font-mono text-[11px] text-muted-foreground/80">{rule.id}</p>
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}
