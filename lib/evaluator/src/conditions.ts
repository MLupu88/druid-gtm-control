// The closed condition DSL every profile-authored rule (fit/intent/
// actionability/eligibility) is built from. Deliberately NOT a general
// expression language: no JavaScript snippets, no dynamic evaluation, a
// fixed operator set, bounded nesting, bounded collection sizes, and
// every field reference checked against a dimension-specific allowlist
// (see profileConfig.ts) rather than an unrestricted `field: string`.

import { z } from "zod/v4";

export const MAX_CONDITION_DEPTH = 6;
export const MAX_CONDITION_COLLECTION_SIZE = 8;

export type FieldType = "string" | "number" | "boolean" | "stringArray";
export type FieldAllowlist = Readonly<Record<string, FieldType>>;

type ScalarLiteral = string | number | boolean;

export type RuleCondition =
  | { op: "exists"; field: string }
  | { op: "eq"; field: string; value: ScalarLiteral }
  | { op: "in"; field: string; values: ScalarLiteral[] }
  | { op: "gte"; field: string; value: number }
  | { op: "includesAny"; field: string; values: string[] }
  | { op: "and"; conditions: RuleCondition[] }
  | { op: "or"; conditions: RuleCondition[] }
  | { op: "not"; condition: RuleCondition };

// ---------------------------------------------------------------------
// Structural (syntactic) shape. This alone does not enforce field
// allowlists, operator/type compatibility, value-type-vs-field-type
// matching, or depth — those require knowing which dimension a
// condition belongs to, so they are enforced separately by
// validateConditionAgainstAllowlist (called from profileConfig.ts, per
// dimension).
// ---------------------------------------------------------------------

const scalarLiteralSchema = z.union([z.string(), z.number(), z.boolean()]);

export const ruleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("exists"), field: z.string().min(1) }).strict(),
    z
      .object({
        op: z.literal("eq"),
        field: z.string().min(1),
        value: scalarLiteralSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("in"),
        field: z.string().min(1),
        values: z
          .array(scalarLiteralSchema)
          .min(1)
          .max(MAX_CONDITION_COLLECTION_SIZE),
      })
      .strict(),
    z
      .object({
        op: z.literal("gte"),
        field: z.string().min(1),
        value: z.number(),
      })
      .strict(),
    z
      .object({
        op: z.literal("includesAny"),
        field: z.string().min(1),
        values: z
          .array(z.string().min(1))
          .min(1)
          .max(MAX_CONDITION_COLLECTION_SIZE),
      })
      .strict(),
    z
      .object({
        op: z.literal("and"),
        conditions: z
          .array(ruleConditionSchema)
          .min(1)
          .max(MAX_CONDITION_COLLECTION_SIZE),
      })
      .strict(),
    z
      .object({
        op: z.literal("or"),
        conditions: z
          .array(ruleConditionSchema)
          .min(1)
          .max(MAX_CONDITION_COLLECTION_SIZE),
      })
      .strict(),
    z.object({ op: z.literal("not"), condition: ruleConditionSchema }).strict(),
  ]),
);

// ---------------------------------------------------------------------
// Semantic validation: field allowlist + operator/type compatibility +
// exact value-type-vs-field-type matching + bounded nesting depth, for
// one dimension.
// ---------------------------------------------------------------------

export class ConditionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionValidationError";
  }
}

const SCALAR_COMPATIBLE_TYPES: readonly FieldType[] = [
  "string",
  "number",
  "boolean",
];

export function conditionDepth(condition: RuleCondition): number {
  switch (condition.op) {
    case "exists":
    case "eq":
    case "in":
    case "gte":
    case "includesAny":
      return 1;
    case "not":
      return 1 + conditionDepth(condition.condition);
    case "and":
    case "or":
      return 1 + Math.max(...condition.conditions.map(conditionDepth));
  }
}

/**
 * Throws ConditionValidationError on the first violation found. Called
 * from profileConfig.ts's superRefine blocks, one dimension at a time.
 */
export function validateConditionAgainstAllowlist(
  condition: RuleCondition,
  allowlist: FieldAllowlist,
  dimensionLabel: string,
): void {
  const depth = conditionDepth(condition);
  if (depth > MAX_CONDITION_DEPTH) {
    throw new ConditionValidationError(
      `condition exceeds maximum nesting depth of ${MAX_CONDITION_DEPTH} (got ${depth}) for dimension "${dimensionLabel}"`,
    );
  }
  walk(condition);

  function assertFieldAllowed(field: string): FieldType {
    const type = allowlist[field];
    if (type === undefined) {
      throw new ConditionValidationError(
        `field "${field}" is not allowed for dimension "${dimensionLabel}"`,
      );
    }
    return type;
  }

  // "stringArray" is intentionally excluded — eq/in are scalar-only
  // operators; array fields only support "includesAny".
  function assertScalarCompatible(field: string, type: FieldType): void {
    if (!SCALAR_COMPATIBLE_TYPES.includes(type)) {
      throw new ConditionValidationError(
        `field "${field}" (typed "${type}") is not compatible with a scalar comparison operator for dimension "${dimensionLabel}"`,
      );
    }
  }

  // Requires the literal's JS type to EXACTLY match the allowlisted
  // field type — a boolean field can only be compared with a boolean
  // literal, a number field only with a finite number literal, a string
  // field only with a string literal. This is what makes `in` reject
  // mixed-type arrays: every element is checked against the same single
  // field type, so a value of the wrong type fails regardless of what
  // the other array elements are.
  function assertValueMatchesType(
    field: string,
    type: FieldType,
    value: ScalarLiteral,
  ): void {
    const actual = typeof value;
    if (type === "string" && actual !== "string") {
      throw new ConditionValidationError(
        `field "${field}" is typed "string" but was compared with a ${actual} value for dimension "${dimensionLabel}"`,
      );
    }
    if (type === "number") {
      if (actual !== "number") {
        throw new ConditionValidationError(
          `field "${field}" is typed "number" but was compared with a ${actual} value for dimension "${dimensionLabel}"`,
        );
      }
      if (!Number.isFinite(value as number)) {
        throw new ConditionValidationError(
          `field "${field}" is typed "number" but was compared with a non-finite number for dimension "${dimensionLabel}"`,
        );
      }
    }
    if (type === "boolean" && actual !== "boolean") {
      throw new ConditionValidationError(
        `field "${field}" is typed "boolean" but was compared with a ${actual} value for dimension "${dimensionLabel}"`,
      );
    }
  }

  function walk(c: RuleCondition): void {
    switch (c.op) {
      case "exists": {
        // Total — exists is meaningful (and allowed) against any field type.
        assertFieldAllowed(c.field);
        return;
      }
      case "eq": {
        const type = assertFieldAllowed(c.field);
        assertScalarCompatible(c.field, type);
        assertValueMatchesType(c.field, type, c.value);
        return;
      }
      case "in": {
        const type = assertFieldAllowed(c.field);
        assertScalarCompatible(c.field, type);
        c.values.forEach((value) =>
          assertValueMatchesType(c.field, type, value),
        );
        return;
      }
      case "gte": {
        const type = assertFieldAllowed(c.field);
        if (type !== "number") {
          throw new ConditionValidationError(
            `"gte" requires a number field, but "${c.field}" is typed "${type}" for dimension "${dimensionLabel}"`,
          );
        }
        return;
      }
      case "includesAny": {
        const type = assertFieldAllowed(c.field);
        if (type !== "stringArray") {
          throw new ConditionValidationError(
            `"includesAny" requires a stringArray field, but "${c.field}" is typed "${type}" for dimension "${dimensionLabel}"`,
          );
        }
        return;
      }
      case "and":
      case "or":
        c.conditions.forEach(walk);
        return;
      case "not":
        walk(c.condition);
        return;
    }
  }
}

// ---------------------------------------------------------------------
// Tri-state evaluation.
// ---------------------------------------------------------------------

export type ConditionOutcome = "match" | "no_match" | "unknown";

export interface ConditionEvaluation {
  result: ConditionOutcome;
  /** Deduplicated, sorted dotted field paths that were unknown/absent. */
  missingFields: string[];
}

function readField(input: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = input;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function dedupeSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

// ---------------------------------------------------------------------
// Tri-state combinators — the exact and/or/not composition rules from
// evaluateCondition's own doc comment below, extracted as standalone
// pure functions so a second caller (mqlDecisionReadiness.ts's
// evidence-masked resolver) can reuse the identical truth table instead
// of re-deriving an approximation of it. evaluateCondition itself is
// refactored to call these, not to duplicate their logic — this is a
// behaviour-preserving extraction, not a semantic change.
// ---------------------------------------------------------------------

export function combineNot(child: ConditionOutcome): ConditionOutcome {
  if (child === "match") return "no_match";
  if (child === "no_match") return "match";
  return "unknown";
}

export function combineAnd(results: ConditionOutcome[]): ConditionOutcome {
  if (results.some((r) => r === "no_match")) return "no_match";
  if (results.every((r) => r === "match")) return "match";
  return "unknown";
}

export function combineOr(results: ConditionOutcome[]): ConditionOutcome {
  if (results.some((r) => r === "match")) return "match";
  if (results.every((r) => r === "no_match")) return "no_match";
  return "unknown";
}

/**
 * Evaluates a RuleCondition against a plain record view of the input.
 * Semantics (exact, per the closed DSL contract):
 *   - exists is total: match or no_match, never unknown.
 *   - eq/in/gte/includesAny against an absent field: unknown, and the
 *     field is reported as missing.
 *   - not(match) = no_match; not(no_match) = match; not(unknown) = unknown.
 *   - and: any no_match => no_match; all match => match; else unknown.
 *   - or: any match => match; all no_match => no_match; else unknown.
 * unknown never silently becomes false/zero/true through negation or
 * composition — callers (rules/*.ts) must treat "match" as the only
 * outcome that contributes points or fires a rule.
 */
export function evaluateCondition(
  condition: RuleCondition,
  input: Record<string, unknown>,
): ConditionEvaluation {
  switch (condition.op) {
    case "exists": {
      const value = readField(input, condition.field);
      return {
        result: isPresent(value) ? "match" : "no_match",
        missingFields: [],
      };
    }
    case "eq": {
      const value = readField(input, condition.field);
      if (!isPresent(value))
        return { result: "unknown", missingFields: [condition.field] };
      return {
        result: value === condition.value ? "match" : "no_match",
        missingFields: [],
      };
    }
    case "in": {
      const value = readField(input, condition.field);
      if (!isPresent(value))
        return { result: "unknown", missingFields: [condition.field] };
      return {
        result: (condition.values as unknown[]).includes(value)
          ? "match"
          : "no_match",
        missingFields: [],
      };
    }
    case "gte": {
      const value = readField(input, condition.field);
      if (!isPresent(value))
        return { result: "unknown", missingFields: [condition.field] };
      if (typeof value !== "number")
        return { result: "unknown", missingFields: [condition.field] };
      return {
        result: value >= condition.value ? "match" : "no_match",
        missingFields: [],
      };
    }
    case "includesAny": {
      const value = readField(input, condition.field);
      if (!isPresent(value))
        return { result: "unknown", missingFields: [condition.field] };
      if (!Array.isArray(value))
        return { result: "unknown", missingFields: [condition.field] };
      const matches = value.some((entry) =>
        condition.values.includes(entry as string),
      );
      return { result: matches ? "match" : "no_match", missingFields: [] };
    }
    case "not": {
      const child = evaluateCondition(condition.condition, input);
      return {
        result: combineNot(child.result),
        missingFields: child.missingFields,
      };
    }
    case "and": {
      const children = condition.conditions.map((c) =>
        evaluateCondition(c, input),
      );
      const missingFields = dedupeSorted(
        children.flatMap((c) => c.missingFields),
      );
      return {
        result: combineAnd(children.map((c) => c.result)),
        missingFields,
      };
    }
    case "or": {
      const children = condition.conditions.map((c) =>
        evaluateCondition(c, input),
      );
      const missingFields = dedupeSorted(
        children.flatMap((c) => c.missingFields),
      );
      return {
        result: combineOr(children.map((c) => c.result)),
        missingFields,
      };
    }
  }
}
