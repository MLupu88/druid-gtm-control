import type { ReactNode } from "react";
import { Plus, Copy, Trash2, ChevronUp, ChevronDown, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TechnicalDetails } from "@/components/technical-details";
import type { WeightedRule, ConditionRule, FieldAllowlist } from "@workspace/evaluator";
import { ConditionEditor } from "@/components/icp-condition-editor";
import { replaceItemAt, removeItemAt, moveItem } from "@/lib/icp-profile-config-editing";
import type { ConfigValidationIssue } from "@/lib/icp-profile-config-validation";

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

// ─── Weighted rule row (fit / intent / actionability) ────────────────────────
export function WeightedRuleRow({
  rule,
  allowlist,
  actions,
}: {
  rule: WeightedRule;
  allowlist: FieldAllowlist;
  actions: RuleRowActions;
}) {
  const onChange = actions.onChange as (next: WeightedRule) => void;
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
          <div className="w-24 shrink-0 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Points</Label>
            <Input
              type="number"
              min={0}
              value={rule.points}
              onChange={(e) => onChange({ ...rule, points: Number(e.target.value) })}
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
  actions,
}: {
  rule: ConditionRule;
  allowlist: FieldAllowlist;
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

        <RuleIssueList issues={actions.issues} />

        <TechnicalDetails summary="Rule ID">
          <p className="font-mono text-[11px] text-muted-foreground/80">{rule.id}</p>
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}
