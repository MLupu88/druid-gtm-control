import { useEffect, useRef, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
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
import { MEANINGFUL_FIT_FIELDS, type RuleCondition, type WeightedRule } from "@workspace/evaluator";
import { humanizeFieldLabel } from "@/lib/icp-profile-config-validation";
import { describeWeightedRuleSentence } from "@/lib/icp-profile-business-summary";
import { ImportanceSelect, type BusinessRuleRowActions } from "@/components/icp-business-rule-list-section";

// Simple business rows for fit/intent rules — rendered ONLY for rules
// already classified by @workspace/evaluator's isSimpleFitRule/
// isSimpleIntentRule (see ../components/icp-business-rule-list-section.tsx),
// so each row can assume its rule's condition is exactly the shape its
// classifier guarantees. Every edit goes through actions.onChange with a
// full replacement WeightedRule — never a partial/mutated one — matching
// the same "immutable, full-object update" convention as the technical
// row editor (../components/icp-rule-list-section.tsx).

function RowActionButtons({ actions }: { actions: Pick<BusinessRuleRowActions<WeightedRule>, "onDuplicate" | "onRemove" | "canDuplicate"> }) {
  return (
    <div className="flex items-start gap-0.5 shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={actions.onDuplicate}
        disabled={!actions.canDuplicate}
        aria-label="Duplicate rule"
      >
        <Copy className="w-3.5 h-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-red-400 hover:text-red-300"
        onClick={actions.onRemove}
        aria-label="Remove rule"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// Comma-separated string list. Keeps its own local, uncommitted visible
// text — trailing commas/spaces are never stripped mid-typing — while
// still pushing a PARSED value array up to the parent on every keystroke
// (so live previews/validation elsewhere in the editor stay current).
// Only the visible text itself is normalized (collapsed to "a, b" form)
// on blur/Enter.
//
// `lastEmittedRef` distinguishes an external prop change (the parent
// resetting `values` because the field/operator/signal type changed, or
// an undo/duplicate) from the mere echo of this input's own most recent
// onChange call — without that distinction, syncing local text from
// `values` on every prop change would immediately clobber whatever the
// author is mid-typing (e.g. "Banking, " getting stripped back to
// "Banking" one keystroke after it was typed).
function CommaListInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => values.join(", "));
  const lastEmittedRef = useRef<string[]>(values);

  useEffect(() => {
    if (!stringArraysEqual(values, lastEmittedRef.current)) {
      setText(values.join(", "));
      lastEmittedRef.current = values;
    }
  }, [values]);

  function handleChange(raw: string) {
    setText(raw);
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const next = parts.length > 0 ? parts : [""];
    lastEmittedRef.current = next;
    onChange(next);
  }

  function normalizeVisibleText() {
    const parts = text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    setText(parts.join(", "));
  }

  return (
    <Input
      className="h-8 text-sm"
      value={text}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={normalizeVisibleText}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          normalizeVisibleText();
        }
      }}
      placeholder={placeholder ?? "value1, value2, ..."}
    />
  );
}

// ---------------------------------------------------------------------
// Fit business row — Company attribute (one of the seven meaningful
// fields) + Match (Equals/Is one of) + Value + Importance.
// ---------------------------------------------------------------------

type FitLeafCondition = Extract<RuleCondition, { op: "eq" | "in" }>;

/** The first non-blank entry, or the first entry at all if every one is blank, or "" if the array is empty — used when collapsing an "in" list down to a single "eq" value so a real typed value is never silently dropped in favor of a blank one. */
function firstMeaningfulValue(values: string[]): string {
  return values.find((value) => value.trim() !== "") ?? values[0] ?? "";
}

export function FitBusinessRuleRow({
  rule,
  actions,
}: {
  rule: WeightedRule;
  actions: BusinessRuleRowActions<WeightedRule>;
}) {
  // Safe: this row is only ever rendered for a rule isSimpleFitRule has
  // already classified as a direct eq/in leaf on a meaningful fit field.
  const condition = rule.condition as FitLeafCondition;

  // Every meaningful fit field is string-typed (see
  // @workspace/evaluator's FIT_FIELD_ALLOWLIST) — there is no
  // field-type incompatibility to guard against among them, so the
  // currently entered value(s) always carry over unchanged.
  function handleFieldChange(field: string) {
    actions.onChange({ ...rule, condition: { ...condition, field } });
  }

  function handleOperatorChange(op: "eq" | "in") {
    if (op === condition.op) return;
    if (op === "eq") {
      const value = condition.op === "in" ? firstMeaningfulValue(condition.values as string[]) : "";
      actions.onChange({ ...rule, condition: { op: "eq", field: condition.field, value } });
    } else {
      const values = condition.op === "eq" ? [condition.value as string] : [""];
      actions.onChange({ ...rule, condition: { op: "in", field: condition.field, values } });
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              value={rule.description}
              onChange={(e) => actions.onChange({ ...rule, description: e.target.value })}
              placeholder="e.g. Targets Banking industry"
              className="h-8 text-sm"
            />
          </div>
          <div className="sm:pt-5">
            <RowActionButtons actions={actions} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Company attribute</Label>
            <Select value={condition.field} onValueChange={handleFieldChange}>
              <SelectTrigger className="h-8 text-sm w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEANINGFUL_FIT_FIELDS.map((field) => (
                  <SelectItem key={field} value={field}>
                    {humanizeFieldLabel(field)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Match</Label>
            <Select value={condition.op} onValueChange={(v) => handleOperatorChange(v as "eq" | "in")}>
              <SelectTrigger className="h-8 text-sm w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eq">Equals</SelectItem>
                <SelectItem value="in">Is one of</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[10rem] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Value</Label>
            {condition.op === "eq" ? (
              <Input
                className="h-8 text-sm"
                value={condition.value as string}
                onChange={(e) =>
                  actions.onChange({ ...rule, condition: { ...condition, value: e.target.value } })
                }
                placeholder="e.g. Banking"
              />
            ) : (
              <CommaListInput
                values={condition.values as string[]}
                onChange={(values) => actions.onChange({ ...rule, condition: { ...condition, values } })}
                placeholder="e.g. Banking, Insurance"
              />
            )}
          </div>
          <ImportanceSelect points={rule.points} onChange={(points) => actions.onChange({ ...rule, points })} />
        </div>

        <p className="text-[11px] text-muted-foreground/70 italic">
          {describeWeightedRuleSentence("fit", rule)}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Intent business row — a "Signal" picker over the exactly four
// supported intent shapes (see @workspace/evaluator's isSimpleIntentRule),
// each with its own value editor, + Importance. engagement.lastSeenAt is
// never offered here — it stays Technical-only.
// ---------------------------------------------------------------------

type IntentSignalType = "sources" | "pages" | "distinctCount" | "repeatVisit";

const INTENT_SIGNAL_TYPE_ORDER: IntentSignalType[] = [
  "sources",
  "pages",
  "distinctCount",
  "repeatVisit",
];

const INTENT_SIGNAL_TYPE_LABELS: Record<IntentSignalType, string> = {
  sources: "Visited specific sources",
  pages: "Visited specific pages",
  distinctCount: "Visited at least N distinct sources",
  repeatVisit: "Is a repeat visitor",
};

function intentSignalTypeForCondition(condition: RuleCondition): IntentSignalType {
  if (condition.op === "includesAny" && condition.field === "engagement.pagesVisited") return "pages";
  if (condition.op === "gte" && condition.field === "engagement.distinctSourceCount") {
    return "distinctCount";
  }
  if (condition.op === "eq" && condition.field === "engagement.repeatVisit") return "repeatVisit";
  // Default/fallback: includesAny on engagement.sources — the remaining
  // supported shape, and isSimpleIntentRule guarantees the condition is
  // one of these four, so this is only ever reached for that shape.
  return "sources";
}

function conditionForIntentSignalType(type: IntentSignalType): RuleCondition {
  switch (type) {
    case "sources":
      return { op: "includesAny", field: "engagement.sources", values: [""] };
    case "pages":
      return { op: "includesAny", field: "engagement.pagesVisited", values: [""] };
    case "distinctCount":
      return { op: "gte", field: "engagement.distinctSourceCount", value: 1 };
    case "repeatVisit":
      return { op: "eq", field: "engagement.repeatVisit", value: true };
  }
}

function IntentValueEditor({
  condition,
  onChange,
}: {
  condition: RuleCondition;
  onChange: (next: RuleCondition) => void;
}) {
  switch (condition.op) {
    case "includesAny":
      return (
        <CommaListInput
          values={condition.values}
          onChange={(values) => onChange({ ...condition, values })}
          placeholder="e.g. ads, webinar"
        />
      );
    case "gte":
      return (
        <Input
          type="number"
          min={0}
          className="h-8 text-sm"
          value={condition.value}
          onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
        />
      );
    case "eq":
      return (
        <Select
          value={String(condition.value)}
          onValueChange={(v) => onChange({ op: "eq", field: condition.field, value: v === "true" })}
        >
          <SelectTrigger className="h-8 text-sm w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Repeat visitor</SelectItem>
            <SelectItem value="false">Not a repeat visitor</SelectItem>
          </SelectContent>
        </Select>
      );
    default:
      // Unreachable for a rule isSimpleIntentRule has already classified.
      return null;
  }
}

export function IntentBusinessRuleRow({
  rule,
  actions,
}: {
  rule: WeightedRule;
  actions: BusinessRuleRowActions<WeightedRule>;
}) {
  const signalType = intentSignalTypeForCondition(rule.condition);

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-3 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              value={rule.description}
              onChange={(e) => actions.onChange({ ...rule, description: e.target.value })}
              placeholder="e.g. Visited pricing or demo pages"
              className="h-8 text-sm"
            />
          </div>
          <div className="sm:pt-5">
            <RowActionButtons actions={actions} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Signal</Label>
            <Select
              value={signalType}
              onValueChange={(v) =>
                actions.onChange({ ...rule, condition: conditionForIntentSignalType(v as IntentSignalType) })
              }
            >
              <SelectTrigger className="h-8 text-sm w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTENT_SIGNAL_TYPE_ORDER.map((type) => (
                  <SelectItem key={type} value={type}>
                    {INTENT_SIGNAL_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[10rem] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Value</Label>
            <IntentValueEditor
              condition={rule.condition}
              onChange={(condition) => actions.onChange({ ...rule, condition })}
            />
          </div>
          <ImportanceSelect points={rule.points} onChange={(points) => actions.onChange({ ...rule, points })} />
        </div>

        <p className="text-[11px] text-muted-foreground/70 italic">
          {describeWeightedRuleSentence("intent", rule)}
        </p>
      </CardContent>
    </Card>
  );
}
