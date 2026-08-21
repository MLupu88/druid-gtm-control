// Pure, DOM-free logic for ../components/account-truth-panel.tsx — this
// package has no jsdom/testing-library (see
// ./account-facts-presentation.ts's own module comment for the same
// discipline), so every decision that isn't "how does this look on
// screen" lives here instead, unit-tested without a DOM.
//
// TERMINOLOGY: this module is the ONLY place a resolutionState enum
// value ("single_source"/"agreement"/"conflict"/"unresolved") becomes
// product copy — the raw enum, resolved_facts, or observation internals
// must never leak into JSX directly. "Confirmed" means "selected
// canonical truth under the current reconciliation policy," never
// "objectively, universally true" — see statusLabel's own comment.

import {
  type AccountTruthField,
  type CanonicalTruthField,
  type EvidenceDTO,
  type ResolutionState,
} from "@/lib/account-truth-api";

// ---------------------------------------------------------------------
// Field labels + display order. Deliberately a SEPARATE small map from
// ../lib/icp-profile-config-validation.ts's FIELD_LABELS: that map is
// keyed to the evaluator's own historical, provider-prefixed field
// vocabulary (crm.hubspotOwner) for the ICP condition-field picker, a
// different context this module must not couple to. 3H's canonical
// field vocabulary (crm.owner, ...) is provider-neutral by design (see
// artifacts/api-server/src/services/canonicalFactEvaluatorInput.ts) and
// deserves neutral labels here, not "HubSpot owner assigned" prose.
// ---------------------------------------------------------------------

const FIELD_LABELS: Record<CanonicalTruthField, string> = {
  "company.industry": "Industry",
  "company.country": "Country",
  "company.region": "Region",
  "company.employeeRange": "Employee range",
  "company.revenueRange": "Revenue range",
  "crm.owner": "Owner",
  "crm.lifecycleStage": "Lifecycle stage",
  "crm.openOpportunity": "Open opportunity",
  "crm.existingCustomer": "Existing customer",
  "crm.competitorFlag": "Competitor",
  "crm.partnerFlag": "Partner",
};

export function fieldLabel(field: CanonicalTruthField): string {
  return FIELD_LABELS[field];
}

// A fixed, natural product order (firmographics, then CRM guardrail
// flags) rather than the API's alphabetical canonicalField ordering —
// still fully deterministic (a pure sort by a fixed index), so "API
// order is deterministic" and "display order is a stable, reviewable
// product decision" are both true at once.
const DISPLAY_ORDER: readonly CanonicalTruthField[] = [
  "company.industry",
  "company.country",
  "company.region",
  "company.employeeRange",
  "company.revenueRange",
  "crm.owner",
  "crm.lifecycleStage",
  "crm.openOpportunity",
  "crm.existingCustomer",
  "crm.competitorFlag",
  "crm.partnerFlag",
];

export function sortFieldsForDisplay(
  fields: readonly AccountTruthField[],
): AccountTruthField[] {
  return [...fields].sort(
    (a, b) => DISPLAY_ORDER.indexOf(a.canonicalField) - DISPLAY_ORDER.indexOf(b.canonicalField),
  );
}

const BOOLEAN_FIELDS = new Set<CanonicalTruthField>([
  "crm.openOpportunity",
  "crm.existingCustomer",
  "crm.competitorFlag",
  "crm.partnerFlag",
]);

const REGION_LABELS: Record<string, string> = {
  us: "US",
  emea: "EMEA",
  other: "Other",
};

const MISSING_VALUE_TEXT = "—";

// Never renders a raw object/array — anything not a plain string or
// boolean for these specific fields falls back to the same missing-value
// convention as a genuinely absent value, rather than risking a raw JSON
// dump (defensive: this repo's own contract never produces such a shape
// for these fields, but the UI must not trust that blindly).
export function displayCanonicalValue(field: CanonicalTruthField, value: unknown): string {
  if (value === null || value === undefined) return MISSING_VALUE_TEXT;
  if (BOOLEAN_FIELDS.has(field)) {
    return typeof value === "boolean" ? (value ? "Yes" : "No") : MISSING_VALUE_TEXT;
  }
  if (typeof value !== "string") return MISSING_VALUE_TEXT;
  return field === "company.region" ? (REGION_LABELS[value] ?? value) : value;
}

// ---------------------------------------------------------------------
// Status label/badge — the resolutionState -> product-copy mapping.
// "Confirmed" always means "this is the canonical value selected under
// the current policy," never a claim of objective/universal truth — see
// module comment. A conflict is NEVER hidden merely because a canonical
// winner exists: "Conflict — resolved" still visibly says "Conflict."
// ---------------------------------------------------------------------

export function statusLabel(state: ResolutionState, canonicalValue: unknown): string {
  switch (state) {
    case "single_source":
      return "Confirmed";
    case "agreement":
      return "Confirmed by multiple sources";
    case "conflict":
      return canonicalValue !== null ? "Conflict — resolved" : "Conflict — unresolved";
    case "unresolved":
      return "Unresolved";
  }
}

export type StatusBadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function statusBadgeVariant(
  state: ResolutionState,
  canonicalValue: unknown,
): StatusBadgeVariant {
  switch (state) {
    case "single_source":
      return "secondary";
    case "agreement":
      return "default";
    case "conflict":
      return canonicalValue !== null ? "outline" : "destructive";
    case "unresolved":
      return "outline";
  }
}

// ---------------------------------------------------------------------
// Evidence display — provenance detail, never raw JSON.
// ---------------------------------------------------------------------

// Display-name casing only — never a behavioral branch. Falls back to
// the raw provider string (still no invented prose) for any provider
// this map hasn't been updated for yet, matching FIELD_LABELS'/
// humanizeFieldLabel's identical "never fabricate a label" discipline.
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  hubspot: "HubSpot",
  client_radar: "Client Radar",
  rb2b: "RB2B",
  dealfront: "Dealfront",
  cognism: "Cognism",
};

export function evidenceSourceLabel(evidence: EvidenceDTO): string {
  switch (evidence.kind) {
    case "manual_account_fact":
      return "Manual confirmation";
    case "observation":
      return PROVIDER_DISPLAY_NAMES[evidence.provider] ?? evidence.provider;
    case "unknown":
      return "Evidence unavailable";
  }
}

export function evidenceValueText(field: CanonicalTruthField, evidence: EvidenceDTO): string {
  if (evidence.kind === "unknown") return MISSING_VALUE_TEXT;
  return displayCanonicalValue(field, evidence.value);
}

export function formatEvidenceTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

// ---------------------------------------------------------------------
// Row view model — exactly the strings/flags the panel renders for one
// field, given its API row (or none, e.g. the truth request failed).
// ---------------------------------------------------------------------

export interface TruthRowViewModel {
  field: CanonicalTruthField;
  label: string;
  valueText: string;
  statusText: string;
  badgeVariant: StatusBadgeVariant;
  rationale: string | null;
  hasProvenance: boolean;
}

export function buildTruthRowViewModel(
  field: CanonicalTruthField,
  apiField: AccountTruthField | undefined,
): TruthRowViewModel {
  if (!apiField) {
    return {
      field,
      label: fieldLabel(field),
      valueText: MISSING_VALUE_TEXT,
      statusText: "Unavailable",
      badgeVariant: "outline",
      rationale: null,
      hasProvenance: false,
    };
  }
  return {
    field,
    label: fieldLabel(field),
    valueText: displayCanonicalValue(field, apiField.canonicalValue),
    statusText: statusLabel(apiField.resolutionState, apiField.canonicalValue),
    badgeVariant: statusBadgeVariant(apiField.resolutionState, apiField.canonicalValue),
    rationale: apiField.rationale,
    hasProvenance:
      apiField.selectedEvidence !== null ||
      apiField.supportingEvidence.length > 0 ||
      apiField.conflictingEvidence.length > 0,
  };
}
