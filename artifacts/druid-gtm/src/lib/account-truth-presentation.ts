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

// company.employeeRange in particular has been observed, against real
// production HubSpot data, to arrive as a genuine JS number (e.g. 161
// employees) rather than a string — HubSpot's own numeric properties are
// not guaranteed to round-trip as strings the way this repo's write path
// assumes for every other field (see NEXT_SESSION.md's M3.5 checkpoint
// for the real-data finding this fixed). A finite number is therefore a
// legitimate scalar canonical value, not just a string or boolean — but
// this remains a strict allowlist: objects, arrays, NaN, and ±Infinity
// still fall back to the same missing-value convention as a genuinely
// absent value, never a raw JSON dump (defensive: even where this
// repo's own write path shouldn't produce such a shape, the UI must not
// trust that blindly).
function isDisplayableScalar(value: unknown): value is string | number {
  if (typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

// crm.lifecycleStage is an open HubSpot vocabulary (never a closed enum
// this repo defines — see canonicalFactEvaluatorInput.ts's own comment on
// why 3F never invents one) — this only capitalizes the first letter of
// whatever raw stage string HubSpot returned ("lead" -> "Lead"); it never
// reinterprets or maps specific stage values, which would be inventing
// business meaning this milestone was not asked to define.
function capitalizeFirstLetter(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

export function displayCanonicalValue(field: CanonicalTruthField, value: unknown): string {
  if (value === null || value === undefined) return MISSING_VALUE_TEXT;
  if (BOOLEAN_FIELDS.has(field)) {
    return typeof value === "boolean" ? (value ? "Yes" : "No") : MISSING_VALUE_TEXT;
  }
  if (!isDisplayableScalar(value)) return MISSING_VALUE_TEXT;
  const text = String(value);
  if (field === "company.region") return REGION_LABELS[text] ?? text;
  if (field === "crm.lifecycleStage") return capitalizeFirstLetter(text);
  return text;
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

/** Display-name casing only, reused by evidenceSourceLabel below and by
 * ../pages/account-detail.tsx's identity-alias summary (via
 * humanizeAliasType) — the one place this repo maps a provider's raw
 * name to product copy. */
export function providerDisplayName(provider: string): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? provider;
}

export function evidenceSourceLabel(evidence: EvidenceDTO): string {
  switch (evidence.kind) {
    case "manual_account_fact":
      return "Manual confirmation";
    case "observation":
      return providerDisplayName(evidence.provider);
    case "unknown":
      return "Evidence unavailable";
  }
}

// Milestone 3.5 defect fix — Account Snapshot's "Identity" summary reads
// this account's real account_aliases.alias_type values (see
// artifacts/api-server/src/services/accounts.ts's AccountDetail.
// identityAliasTypes), never an evaluation's identityResolutionLevel
// (see ../pages/account-detail.tsx's own comment on why those are
// different concepts). "domain" -> "Domain"; "external_id:<provider>" ->
// that provider's display name; anything else falls back to the raw
// alias type rather than fabricating a label.
export function humanizeAliasType(aliasType: string): string {
  if (aliasType === "domain") return "Domain";
  const externalIdMatch = aliasType.match(/^external_id:(.+)$/);
  if (externalIdMatch) {
    return providerDisplayName(externalIdMatch[1]!);
  }
  return aliasType;
}

// M3.5 real-data defect fix: an observation carrying a resolved
// displayName (e.g. crm.owner's stable HubSpot id paired with the
// owner's real name — see accountTruth.ts's own comment) shows the name
// AND the raw value together ("Mark van der Ree (89684655)") — never the
// bare stable id alone when a human name is available, but never hiding
// the real value either, so provenance stays fully truthful/traceable.
export function evidenceValueText(field: CanonicalTruthField, evidence: EvidenceDTO): string {
  if (evidence.kind === "unknown") return MISSING_VALUE_TEXT;
  const rawText = displayCanonicalValue(field, evidence.value);
  if (evidence.kind === "observation" && evidence.displayName) {
    return rawText === MISSING_VALUE_TEXT
      ? evidence.displayName
      : `${evidence.displayName} (${rawText})`;
  }
  return rawText;
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
    // M3.5 real-data defect fix: canonicalDisplayValue (e.g. an owner's
    // resolved name) is preferred when present; canonicalValue itself —
    // the real, stable value 3F actually reconciled — is never mutated,
    // only its on-screen presentation is overridden. See
    // accountTruth.ts's own comment on this field.
    valueText: apiField.canonicalDisplayValue ?? displayCanonicalValue(field, apiField.canonicalValue),
    statusText: statusLabel(apiField.resolutionState, apiField.canonicalValue),
    badgeVariant: statusBadgeVariant(apiField.resolutionState, apiField.canonicalValue),
    rationale: apiField.rationale,
    hasProvenance:
      apiField.selectedEvidence !== null ||
      apiField.supportingEvidence.length > 0 ||
      apiField.conflictingEvidence.length > 0,
  };
}
