import { X, Plus } from "lucide-react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  MAX_CONDITION_DEPTH,
  MAX_CONDITION_COLLECTION_SIZE,
  type RuleCondition,
  type FieldAllowlist,
  type FieldType,
} from "@workspace/evaluator";
import {
  humanizeFieldLabel,
  leafOperatorsForFieldType,
  type LeafOperator,
} from "@/lib/icp-profile-config-validation";
import {
  defaultLeafCondition,
  addConditionChild,
  replaceConditionChildAt,
  removeConditionChildAt,
  isGroupCondition,
  isNotCondition,
} from "@/lib/icp-profile-config-editing";

// Guided condition builder over the closed condition DSL
// (@workspace/evaluator's conditions.ts) — the ONLY way this editor lets
// an author express a fit/intent/actionability/eligibility condition.
// Recursive: an "and"/"or" group renders one ConditionEditor per child,
// each one depth+1; a "not" renders exactly one child. Depth and
// collection-size limits are read directly from @workspace/evaluator
// (MAX_CONDITION_DEPTH/MAX_CONDITION_COLLECTION_SIZE), never
// hand-duplicated. Field paths and raw operator names never appear as
// primary text — every field is shown via humanizeFieldLabel, every
// operator via a plain-language label from leafOperatorsForFieldType.

type ConditionKind = "field" | "and" | "or" | "not";
type LeafCondition = Extract<
  RuleCondition,
  { op: "exists" | "eq" | "in" | "gte" | "includesAny" }
>;

function kindOf(condition: RuleCondition): ConditionKind {
  if (condition.op === "and" || condition.op === "or" || condition.op === "not") {
    return condition.op;
  }
  return "field";
}

function defaultValueForType(type: FieldType | undefined): string | number | boolean {
  switch (type) {
    case "number":
      return 0;
    case "boolean":
      return true;
    default:
      return "";
  }
}

export interface ConditionEditorProps {
  condition: RuleCondition;
  allowlist: FieldAllowlist;
  /** 1 for a rule's root condition — matches conditionDepth()'s own counting (a leaf condition is depth 1). */
  depth: number;
  onChange: (next: RuleCondition) => void;
  /** Present only for a condition that is itself a child of a group — the root of a rule is never removable this way. */
  onRemove?: () => void;
}

export function ConditionEditor({
  condition,
  allowlist,
  depth,
  onChange,
  onRemove,
}: ConditionEditorProps) {
  const kind = kindOf(condition);
  // Choosing "and"/"or"/"not" here would push this node's children to
  // depth+1 — only offer that when doing so still stays within
  // MAX_CONDITION_DEPTH.
  const canNest = depth < MAX_CONDITION_DEPTH;

  function handleKindChange(nextKind: ConditionKind) {
    if (nextKind === kind) return;
    switch (nextKind) {
      case "field":
        onChange(defaultLeafCondition(allowlist));
        return;
      case "and":
      case "or":
        onChange({ op: nextKind, conditions: [defaultLeafCondition(allowlist)] });
        return;
      case "not":
        onChange({ op: "not", condition: defaultLeafCondition(allowlist) });
        return;
    }
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <Select value={kind} onValueChange={(v) => handleKindChange(v as ConditionKind)}>
          <SelectTrigger className="h-8 w-[210px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="field">Field comparison</SelectItem>
            <SelectItem value="and" disabled={!canNest}>
              All of these match (AND)
            </SelectItem>
            <SelectItem value="or" disabled={!canNest}>
              Any of these match (OR)
            </SelectItem>
            <SelectItem value="not" disabled={!canNest}>
              Not (invert)
            </SelectItem>
          </SelectContent>
        </Select>

        {kind === "field" && (
          <FieldConditionEditor
            condition={condition as LeafCondition}
            allowlist={allowlist}
            onChange={onChange}
          />
        )}

        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 ml-auto shrink-0"
            onClick={onRemove}
            aria-label="Remove condition"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {(kind === "and" || kind === "or") && isGroupCondition(condition) && (
        <div className="space-y-2 pl-3 border-l-2 border-border/60">
          {condition.conditions.map((child, index) => (
            <ConditionEditor
              key={index}
              condition={child}
              allowlist={allowlist}
              depth={depth + 1}
              onChange={(next) => onChange(replaceConditionChildAt(condition, index, next))}
              onRemove={
                condition.conditions.length > 1
                  ? () => onChange(removeConditionChildAt(condition, index))
                  : undefined
              }
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={condition.conditions.length >= MAX_CONDITION_COLLECTION_SIZE}
            onClick={() => onChange(addConditionChild(condition, defaultLeafCondition(allowlist)))}
          >
            <Plus className="w-3 h-3 mr-1" /> Add condition
          </Button>
        </div>
      )}

      {kind === "not" && isNotCondition(condition) && (
        <div className="pl-3 border-l-2 border-border/60">
          <ConditionEditor
            condition={condition.condition}
            allowlist={allowlist}
            depth={depth + 1}
            onChange={(next) => onChange({ op: "not", condition: next })}
          />
        </div>
      )}
    </div>
  );
}

// ─── Leaf field/operator/value editor ────────────────────────────────────────
function FieldConditionEditor({
  condition,
  allowlist,
  onChange,
}: {
  condition: LeafCondition;
  allowlist: FieldAllowlist;
  onChange: (next: RuleCondition) => void;
}) {
  const fieldType = allowlist[condition.field];
  const operatorOptions = fieldType ? leafOperatorsForFieldType(fieldType) : [];

  function handleFieldChange(nextField: string) {
    // Switching fields may invalidate the current operator (e.g. moving
    // from a number field using "gte" to a string field) — reset to
    // "exists", the one operator valid for every field type, rather than
    // silently carrying over an incompatible operator/value.
    onChange({ op: "exists", field: nextField });
  }

  function handleOpChange(nextOp: LeafOperator) {
    switch (nextOp) {
      case "exists":
        onChange({ op: "exists", field: condition.field });
        return;
      case "eq":
        onChange({ op: "eq", field: condition.field, value: defaultValueForType(fieldType) });
        return;
      case "in":
        onChange({
          op: "in",
          field: condition.field,
          values: [defaultValueForType(fieldType)],
        });
        return;
      case "gte":
        onChange({ op: "gte", field: condition.field, value: 0 });
        return;
      case "includesAny":
        onChange({ op: "includesAny", field: condition.field, values: [""] });
        return;
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
      <Select value={condition.field} onValueChange={handleFieldChange}>
        <SelectTrigger className="h-8 w-[190px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.keys(allowlist).map((field) => (
            <SelectItem key={field} value={field}>
              {humanizeFieldLabel(field)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={condition.op} onValueChange={(v) => handleOpChange(v as LeafOperator)}>
        <SelectTrigger className="h-8 w-[150px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operatorOptions.map((opt) => (
            <SelectItem key={opt.op} value={opt.op}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <LeafValueEditor condition={condition} fieldType={fieldType} onChange={onChange} />
    </div>
  );
}

// ─── Value input, shaped by op + field type ──────────────────────────────────
function LeafValueEditor({
  condition,
  fieldType,
  onChange,
}: {
  condition: LeafCondition;
  fieldType: FieldType | undefined;
  onChange: (next: RuleCondition) => void;
}) {
  if (condition.op === "exists") return null;

  if (condition.op === "gte") {
    return (
      <Input
        type="number"
        className="h-8 w-28 text-xs"
        value={condition.value}
        onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
      />
    );
  }

  if (condition.op === "eq") {
    if (fieldType === "boolean") {
      return (
        <Select
          value={String(condition.value)}
          onValueChange={(v) => onChange({ ...condition, value: v === "true" })}
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">True</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    if (fieldType === "number") {
      return (
        <Input
          type="number"
          className="h-8 w-28 text-xs"
          value={condition.value as number}
          onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
        />
      );
    }
    return (
      <Input
        className="h-8 w-40 text-xs"
        value={condition.value as string}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        placeholder="Value"
      />
    );
  }

  if (condition.op === "in") {
    return (
      <CommaListInput
        values={condition.values}
        fieldType={fieldType}
        onChange={(values) => onChange({ ...condition, values })}
      />
    );
  }

  // includesAny — stringArray fields only.
  return (
    <CommaListInput
      values={condition.values}
      fieldType="string"
      onChange={(values) => onChange({ ...condition, values: values as string[] })}
    />
  );
}

// Comma-separated list input, parsed to the field's scalar type on every
// change. No debounced local text buffer — a trailing ", " collapses
// immediately on render; accepted as a minor input-ergonomics tradeoff
// for this slice, never a correctness issue (only the final parsed value
// before save/validate matters).
function CommaListInput({
  values,
  fieldType,
  onChange,
}: {
  values: (string | number | boolean)[];
  fieldType: FieldType | undefined;
  onChange: (values: (string | number | boolean)[]) => void;
}) {
  function handleChange(raw: string) {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const parsed = parts.map((part): string | number | boolean => {
      if (fieldType === "number") return Number(part);
      if (fieldType === "boolean") return part.toLowerCase() === "true";
      return part;
    });
    onChange(parsed.length > 0 ? parsed : [defaultValueForType(fieldType)]);
  }

  return (
    <Input
      className="h-8 w-56 text-xs"
      value={values.join(", ")}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="value1, value2, ..."
    />
  );
}
