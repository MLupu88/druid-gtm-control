// Validation + field/operator humanization for the ICP draft editor.
// Deliberately a thin wrapper around @workspace/evaluator's OWN
// IcpProfileConfigV1Schema — this file does not reimplement any
// structural rule (required floor tier, unique rule ids, unique tier
// codes/thresholds, condition depth/collection limits, field-allowlist
// enforcement). Every one of those is enforced exactly once, by the
// canonical schema; this module only translates the resulting Zod
// issues (or the schema's own already-human custom messages) into a
// location a UI section can filter by, plus a per-field-type list of
// which condition operators are legal (mirroring
// lib/evaluator/src/conditions.ts's own SCALAR_COMPATIBLE_TYPES/
// stringArray-only-includesAny rules, not a divergent copy of them).
//
// This is the single source of truth for "is this draft valid" in the
// editor — every section (rule editor, tier editor, error summary) reads
// from the SAME validateProfileConfigDraft() result via issuesForPath,
// so there is never a risk of one section disagreeing with another.

import {
  IcpProfileConfigV1Schema,
  FIT_FIELD_ALLOWLIST,
  INTENT_FIELD_ALLOWLIST,
  ACTIONABILITY_FIELD_ALLOWLIST,
  ELIGIBILITY_FIELD_ALLOWLIST,
  type IcpProfileConfigV1,
  type FieldAllowlist,
  type FieldType,
} from "@workspace/evaluator";

export type RuleDimension = "fit" | "intent" | "actionability" | "eligibility";

export function fieldAllowlistFor(dimension: RuleDimension): FieldAllowlist {
  switch (dimension) {
    case "fit":
      return FIT_FIELD_ALLOWLIST;
    case "intent":
      return INTENT_FIELD_ALLOWLIST;
    case "actionability":
      return ACTIONABILITY_FIELD_ALLOWLIST;
    case "eligibility":
      return ELIGIBILITY_FIELD_ALLOWLIST;
  }
}

// ---------------------------------------------------------------------
// Field label humanization — the allowlists themselves only carry
// dotted field paths ("company.employeeRange"); this is the one place
// that turns those into plain-language labels for the field picker.
// Falls back to the raw path (never fabricated) for a field this map
// hasn't been updated for yet.
// ---------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  "company.domain": "Company domain",
  "company.name": "Company name",
  "company.industry": "Industry",
  "company.employeeRange": "Employee range",
  "company.revenueRange": "Revenue range",
  "company.region": "Region",
  "company.country": "Country",
  "engagement.sources": "Engagement sources",
  "engagement.pagesVisited": "Pages visited",
  "engagement.distinctSourceCount": "Distinct engagement sources (count)",
  "engagement.repeatVisit": "Repeat visit",
  "engagement.lastSeenAt": "Last seen",
  "contact.email": "Contact email",
  "contact.phone": "Contact phone",
  "contact.linkedinUrl": "Contact LinkedIn URL",
  "crm.hubspotContactId": "HubSpot contact linked",
  "crm.hubspotOwner": "HubSpot owner assigned",
  doNotContact: "Do-not-contact flag",
  "crm.competitorFlag": "Marked as competitor",
  "crm.partnerFlag": "Marked as partner",
  "crm.existingCustomer": "Existing customer",
  "crm.openOpportunity": "Open opportunity",
};

export function humanizeFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

// ---------------------------------------------------------------------
// Which condition operators apply to a given field type — an exact
// mirror of conditions.ts's own compatibility rules (SCALAR_COMPATIBLE_
// TYPES covers string/number/boolean for eq/in; gte requires number;
// includesAny requires stringArray; exists is total, allowed for any
// type), kept here as a lookup table for the UI's operator picker rather
// than re-deriving it by calling the throwing validator speculatively.
// ---------------------------------------------------------------------

export type LeafOperator = "exists" | "eq" | "in" | "gte" | "includesAny";

export interface OperatorOption {
  op: LeafOperator;
  label: string;
}

export function leafOperatorsForFieldType(type: FieldType): OperatorOption[] {
  switch (type) {
    case "string":
    case "boolean":
      return [
        { op: "exists", label: "Is present" },
        { op: "eq", label: "Equals" },
        { op: "in", label: "Is one of" },
      ];
    case "number":
      return [
        { op: "exists", label: "Is present" },
        { op: "eq", label: "Equals" },
        { op: "in", label: "Is one of" },
        { op: "gte", label: "Is at least" },
      ];
    case "stringArray":
      return [
        { op: "exists", label: "Is present" },
        { op: "includesAny", label: "Includes any of" },
      ];
  }
}

// ---------------------------------------------------------------------
// Validation — runs the canonical schema and translates the result into
// UI-addressable issues. `describeConfigErrorLocation` turns a raw Zod
// path (e.g. ["fit","tiers",1,"minScore"]) into a plain-language location
// (e.g. "Company fit — tier #2"); the raw path itself is preserved on
// each issue for TechnicalDetails / issuesForPath filtering, never shown
// as primary text.
// ---------------------------------------------------------------------

export interface ConfigValidationIssue {
  /** Raw Zod path — technical-details use only, never shown as primary text. */
  path: (string | number)[];
  /** Plain-language "where" this issue applies, e.g. "Company fit — tier #2". */
  location: string;
  /** The message to show — the schema's own custom messages are already human-readable prose. */
  message: string;
}

export type ConfigValidationResult =
  | { valid: true; config: IcpProfileConfigV1 }
  | { valid: false; issues: ConfigValidationIssue[] };

const DIMENSION_LABELS: Record<string, string> = {
  fit: "Company fit",
  intent: "Buying intent",
  actionability: "Ability to act",
  eligibility: "Outreach eligibility",
};

const SECTION_LABELS: Record<string, string> = {
  rules: "rule",
  tiers: "band",
  hardDisqualifiers: "hard disqualifier",
  restrictions: "restriction",
};

export function describeConfigErrorLocation(path: (string | number)[]): string {
  const dimension = typeof path[0] === "string" ? DIMENSION_LABELS[path[0]] : undefined;
  const section = typeof path[1] === "string" ? SECTION_LABELS[path[1]] : undefined;
  const index = typeof path[2] === "number" ? path[2] + 1 : undefined;

  const parts: string[] = [];
  if (dimension) parts.push(dimension);
  if (section) {
    parts.push(index !== undefined ? `${section} #${index}` : `${section}s`);
  }
  return parts.length > 0 ? parts.join(" — ") : "Profile configuration";
}

export function validateProfileConfigDraft(config: unknown): ConfigValidationResult {
  const parsed = IcpProfileConfigV1Schema.safeParse(config);
  if (parsed.success) {
    return { valid: true, config: parsed.data };
  }
  const issues: ConfigValidationIssue[] = parsed.error.issues.map((issue) => {
    const path = issue.path as (string | number)[];
    return {
      path,
      location: describeConfigErrorLocation(path),
      message: issue.message,
    };
  });
  return { valid: false, issues };
}

// Filters issues whose path starts with the given prefix — e.g.
// issuesForPath(issues, ["fit", "tiers"]) for the fit tier editor,
// issuesForPath(issues, ["fit", "rules", 2]) for the third fit rule.
export function issuesForPath(
  issues: ConfigValidationIssue[],
  prefix: (string | number)[],
): ConfigValidationIssue[] {
  return issues.filter((issue) =>
    prefix.every((segment, i) => issue.path[i] === segment),
  );
}
