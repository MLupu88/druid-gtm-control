// Unit tests for ./account-truth-presentation.ts — every DOM-free
// decision ../components/account-truth-panel.tsx relies on. This package
// has no jsdom/testing-library (confirmed against package.json's
// devDependencies before writing this file, matching
// ./account-facts-presentation.test.ts's own precedent), so actual
// component rendering — does the Accordion actually expand on click,
// does the InlineNotice's Retry button actually call refetch(), does a
// successful manual-fact mutation actually trigger both
// queryClient.invalidateQueries calls at runtime — is NOT exercised
// here. The invalidation behavior (item 11 of this milestone's required
// test list) was instead verified by direct code inspection of
// ../components/account-facts-panel.tsx's mutation onSuccess callback,
// which awaits Promise.all([invalidateQueries(accountFactsQueryKey),
// invalidateQueries(accountTruthQueryKey)]) — both keys, unconditionally,
// on every successful confirm/correct.
//
// Run with: tsx --test src/lib/account-truth-presentation.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTruthRowViewModel,
  displayCanonicalValue,
  evidenceSourceLabel,
  evidenceValueText,
  fieldLabel,
  formatEvidenceTimestamp,
  humanizeAliasType,
  sortFieldsForDisplay,
  statusBadgeVariant,
  statusLabel,
} from "./account-truth-presentation.js";
import {
  CANONICAL_TRUTH_FIELDS,
  type AccountTruthField,
  type EvidenceDTO,
} from "./account-truth-api.js";

function syntheticField(overrides: Partial<AccountTruthField> = {}): AccountTruthField {
  return {
    canonicalField: "company.industry",
    canonicalValue: "Financial Services",
    resolutionState: "single_source",
    policyVersion: "fact-reconciliation-policy-v1",
    rationale: "single hubspot observation available for company.industry",
    computedAt: "2026-08-22T12:00:00.000Z",
    selectedEvidence: {
      kind: "observation",
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      provider: "hubspot",
      value: "Financial Services",
      observedAt: null,
      importedAt: "2026-08-20T00:00:00.000Z",
      displayName: null,
    },
    supportingEvidence: [],
    conflictingEvidence: [],
    canonicalDisplayValue: null,
    ...overrides,
  };
}

const MANUAL_EVIDENCE: EvidenceDTO = {
  kind: "manual_account_fact",
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  value: "Germany",
  recordedBy: "operator@example.com",
  observedAt: "2026-08-19T00:00:00.000Z",
};
const OBSERVATION_EVIDENCE: EvidenceDTO = {
  kind: "observation",
  id: "cccccccc-0000-4000-8000-000000000003",
  provider: "hubspot",
  value: "France",
  observedAt: "2026-08-18T00:00:00.000Z",
  importedAt: "2026-08-20T00:00:00.000Z",
  displayName: null,
};
const UNKNOWN_EVIDENCE: EvidenceDTO = { kind: "unknown", id: "dddddddd-0000-4000-8000-000000000004" };

// ---------------------------------------------------------------------
// 1. single_source -> canonical value + "Confirmed"
// ---------------------------------------------------------------------
test("single_source: statusLabel is 'Confirmed', value renders as-is", () => {
  assert.equal(statusLabel("single_source", "Financial Services"), "Confirmed");
  assert.equal(displayCanonicalValue("company.industry", "Financial Services"), "Financial Services");

  const vm = buildTruthRowViewModel("company.industry", syntheticField());
  assert.equal(vm.statusText, "Confirmed");
  assert.equal(vm.valueText, "Financial Services");
});

// ---------------------------------------------------------------------
// 2. agreement -> canonical value + "Confirmed by multiple sources"
// ---------------------------------------------------------------------
test("agreement: statusLabel is 'Confirmed by multiple sources'", () => {
  assert.equal(statusLabel("agreement", "Financial Services"), "Confirmed by multiple sources");

  const vm = buildTruthRowViewModel(
    "company.industry",
    syntheticField({ resolutionState: "agreement" }),
  );
  assert.equal(vm.statusText, "Confirmed by multiple sources");
  assert.equal(vm.valueText, "Financial Services");
});

// ---------------------------------------------------------------------
// 3. conflict WITH a canonical winner -> winning value stays visible AND
// the row is still visibly marked as a conflict, never silently hidden.
// ---------------------------------------------------------------------
test("conflict with a winner: value renders, status is 'Conflict — resolved' (not just 'Confirmed')", () => {
  assert.equal(statusLabel("conflict", "Germany"), "Conflict — resolved");
  assert.notEqual(statusLabel("conflict", "Germany"), "Confirmed");

  const vm = buildTruthRowViewModel(
    "company.country",
    syntheticField({
      canonicalField: "company.country",
      canonicalValue: "Germany",
      resolutionState: "conflict",
      selectedEvidence: MANUAL_EVIDENCE,
      supportingEvidence: [MANUAL_EVIDENCE],
      conflictingEvidence: [OBSERVATION_EVIDENCE],
    }),
  );
  assert.equal(vm.valueText, "Germany");
  assert.equal(vm.statusText, "Conflict — resolved");
  assert.equal(vm.hasProvenance, true);
});

// ---------------------------------------------------------------------
// 4. conflict WITHOUT a winner -> "—" + "Conflict — unresolved", never a
// guessed value.
// ---------------------------------------------------------------------
test("conflict with no winner: value renders as '—', status is 'Conflict — unresolved'", () => {
  assert.equal(statusLabel("conflict", null), "Conflict — unresolved");
  assert.equal(displayCanonicalValue("crm.owner", null), "—");

  const vm = buildTruthRowViewModel(
    "crm.owner",
    syntheticField({
      canonicalField: "crm.owner",
      canonicalValue: null,
      resolutionState: "conflict",
      selectedEvidence: null,
      supportingEvidence: [],
      conflictingEvidence: [OBSERVATION_EVIDENCE, { ...OBSERVATION_EVIDENCE, id: "ee", provider: "cognism" }],
    }),
  );
  assert.equal(vm.valueText, "—");
  assert.equal(vm.statusText, "Conflict — unresolved");
  assert.equal(vm.hasProvenance, true);
});

// ---------------------------------------------------------------------
// 5. unresolved -> "—" + "Unresolved"
// ---------------------------------------------------------------------
test("unresolved: value renders as '—', status is 'Unresolved'", () => {
  assert.equal(statusLabel("unresolved", null), "Unresolved");

  const vm = buildTruthRowViewModel(
    "company.employeeRange",
    syntheticField({
      canonicalField: "company.employeeRange",
      canonicalValue: null,
      resolutionState: "unresolved",
      selectedEvidence: null,
      supportingEvidence: [],
      conflictingEvidence: [],
    }),
  );
  assert.equal(vm.valueText, "—");
  assert.equal(vm.statusText, "Unresolved");
  assert.equal(vm.hasProvenance, false);
});

// ---------------------------------------------------------------------
// 6. provenance presentation — selected/supporting/conflicting shapes.
// ---------------------------------------------------------------------
test("provenance: selected/supporting/conflicting evidence each resolve to a source label + value text", () => {
  const field = syntheticField({
    selectedEvidence: MANUAL_EVIDENCE,
    supportingEvidence: [MANUAL_EVIDENCE],
    conflictingEvidence: [OBSERVATION_EVIDENCE],
  });
  assert.equal(evidenceSourceLabel(field.selectedEvidence!), "Manual confirmation");
  assert.equal(evidenceValueText(field.canonicalField, field.selectedEvidence!), "Germany");
  assert.equal(evidenceSourceLabel(field.conflictingEvidence[0]!), "HubSpot");
  assert.equal(evidenceValueText(field.canonicalField, field.conflictingEvidence[0]!), "France");
});

// ---------------------------------------------------------------------
// 7. manual_account_fact renders distinctly from a provider observation.
// ---------------------------------------------------------------------
test("manual confirmation is visually/textually distinct from a provider observation", () => {
  assert.equal(evidenceSourceLabel(MANUAL_EVIDENCE), "Manual confirmation");
  assert.equal(evidenceSourceLabel(OBSERVATION_EVIDENCE), "HubSpot");
  assert.notEqual(evidenceSourceLabel(MANUAL_EVIDENCE), evidenceSourceLabel(OBSERVATION_EVIDENCE));
});

test("an unrecognized provider falls back to its raw name, never a fabricated label", () => {
  const dealfront: EvidenceDTO = { ...OBSERVATION_EVIDENCE, provider: "some_future_provider" };
  assert.equal(evidenceSourceLabel(dealfront), "some_future_provider");
});

// ---------------------------------------------------------------------
// 8. unknown/missing evidence fails safely — no throw, generic copy.
// ---------------------------------------------------------------------
test("unknown evidence renders 'Evidence unavailable' and '—', never throws", () => {
  assert.doesNotThrow(() => evidenceSourceLabel(UNKNOWN_EVIDENCE));
  assert.equal(evidenceSourceLabel(UNKNOWN_EVIDENCE), "Evidence unavailable");
  assert.equal(evidenceValueText("company.industry", UNKNOWN_EVIDENCE), "—");
});

// ---------------------------------------------------------------------
// 9. never renders a raw object/array — defensive fallback to the
// existing missing-value convention.
// ---------------------------------------------------------------------
test("non-scalar canonical values never render as raw JSON", () => {
  assert.equal(displayCanonicalValue("company.industry", { nested: "object" }), "—");
  assert.equal(displayCanonicalValue("company.industry", ["array", "value"]), "—");
  assert.equal(displayCanonicalValue("crm.existingCustomer", "true"), "—"); // string, not boolean
});

test("boolean crm fields render as Yes/No, never raw true/false text or stringified", () => {
  assert.equal(displayCanonicalValue("crm.existingCustomer", true), "Yes");
  assert.equal(displayCanonicalValue("crm.existingCustomer", false), "No");
});

test("company.region renders its closed-vocabulary label, not the raw stored code", () => {
  assert.equal(displayCanonicalValue("company.region", "emea"), "EMEA");
  assert.equal(displayCanonicalValue("company.region", "us"), "US");
});

// ---------------------------------------------------------------------
// 10. a missing/undefined API row (truth request failed, or this field
// absent) never crashes the view-model builder — safe fallback shape.
// ---------------------------------------------------------------------
test("buildTruthRowViewModel with no API row for this field renders a safe unavailable fallback, never throws", () => {
  assert.doesNotThrow(() => buildTruthRowViewModel("company.industry", undefined));
  const vm = buildTruthRowViewModel("company.industry", undefined);
  assert.equal(vm.valueText, "—");
  assert.equal(vm.statusText, "Unavailable");
  assert.equal(vm.hasProvenance, false);
  assert.equal(vm.label, "Industry");
});

// ---------------------------------------------------------------------
// 12. deterministic field ordering + labeling, regardless of API/input
// array order.
// ---------------------------------------------------------------------
test("sortFieldsForDisplay produces the same fixed order regardless of input order", () => {
  const forward = CANONICAL_TRUTH_FIELDS.map((f) => syntheticField({ canonicalField: f }));
  const shuffled = [...forward].reverse();

  const sortedForward = sortFieldsForDisplay(forward).map((f) => f.canonicalField);
  const sortedShuffled = sortFieldsForDisplay(shuffled).map((f) => f.canonicalField);

  assert.deepEqual(sortedForward, sortedShuffled);
  assert.deepEqual(sortedForward, [
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
  ]);
});

// ---------------------------------------------------------------------
// crm.lifecycleStage — real 3F output (Milestone 3F's own
// RESOLVED_FACT_CANONICAL_FIELDS, not the evaluator's narrower
// EVALUATOR_CANONICAL_FIELDS, which excludes it only because the ICP
// evaluator has no input slot for it yet). Account Truth is not an
// evaluator view — it must display this field normally, not omit it or
// treat it as boolean/region-coded.
// ---------------------------------------------------------------------
test("crm.lifecycleStage has the label 'Lifecycle stage' and is included in the field set", () => {
  assert.equal(fieldLabel("crm.lifecycleStage"), "Lifecycle stage");
  assert.ok(CANONICAL_TRUTH_FIELDS.includes("crm.lifecycleStage"));
});

// M3.5 real-data defect fix: real production data showed raw lowercase
// "lead" rendered verbatim — capitalize the first letter only (never a
// per-value lookup/reinterpretation of HubSpot's open lifecycle-stage
// vocabulary, which would be inventing business meaning this milestone
// was not asked to define).
test("crm.lifecycleStage capitalizes its first letter only, never boolean-ified or region-relabeled", () => {
  assert.equal(displayCanonicalValue("crm.lifecycleStage", "lead"), "Lead");
  assert.equal(displayCanonicalValue("crm.lifecycleStage", "customer"), "Customer");
  assert.equal(displayCanonicalValue("crm.lifecycleStage", "marketingqualifiedlead"), "Marketingqualifiedlead");
  // Not treated as a BOOLEAN_FIELDS member: a boolean value here would be
  // unexpected input, but must still fail safe to "—", never "Yes"/"No".
  assert.equal(displayCanonicalValue("crm.lifecycleStage", true), "—");
});

test("crm.lifecycleStage participates in a truth row view model like any other field", () => {
  const field = syntheticField({
    canonicalField: "crm.lifecycleStage",
    canonicalValue: "lead",
    selectedEvidence: OBSERVATION_EVIDENCE,
    supportingEvidence: [OBSERVATION_EVIDENCE],
  });
  const vm = buildTruthRowViewModel("crm.lifecycleStage", field);
  assert.equal(vm.label, "Lifecycle stage");
  assert.equal(vm.valueText, "Lead");
  assert.equal(vm.statusText, "Confirmed");
});

// ---------------------------------------------------------------------
// M3.5 real-data defect fix — numeric canonical values (e.g.
// company.employeeRange = 161, observed against real production HubSpot
// data) must display, never fall back to "—".
// ---------------------------------------------------------------------
test("a finite number renders as its plain string form, e.g. company.employeeRange = 161", () => {
  assert.equal(displayCanonicalValue("company.employeeRange", 161), "161");
  assert.equal(displayCanonicalValue("crm.owner", 89684655), "89684655");
});

test("NaN and non-finite numbers still fall back to the missing-value convention", () => {
  assert.equal(displayCanonicalValue("company.employeeRange", Number.NaN), "—");
  assert.equal(displayCanonicalValue("company.employeeRange", Number.POSITIVE_INFINITY), "—");
});

test("objects and arrays are never rendered as raw JSON, even now that numbers are allowed", () => {
  assert.equal(displayCanonicalValue("company.employeeRange", { nested: "object" }), "—");
  assert.equal(displayCanonicalValue("company.employeeRange", [1, 2, 3]), "—");
});

test("a numeric field participates in a truth row view model showing the plain number", () => {
  const field = syntheticField({
    canonicalField: "company.employeeRange",
    canonicalValue: 161,
  });
  const vm = buildTruthRowViewModel("company.employeeRange", field);
  assert.equal(vm.valueText, "161");
});

// ---------------------------------------------------------------------
// M3.5 real-data defect fix — crm.owner: the stable HubSpot owner id is
// never shown to the user when a resolved human display name is
// available; the raw id is still preserved, truthfully, alongside it in
// evidence detail.
// ---------------------------------------------------------------------
test("crm.owner's row value prefers canonicalDisplayValue (the resolved name) over the raw stable id", () => {
  const field = syntheticField({
    canonicalField: "crm.owner",
    canonicalValue: "89684655",
    canonicalDisplayValue: "Mark van der Ree",
  });
  const vm = buildTruthRowViewModel("crm.owner", field);
  assert.equal(vm.valueText, "Mark van der Ree");
  assert.notEqual(vm.valueText, "89684655");
});

test("crm.owner falls back to the raw stable id when no display name was resolved", () => {
  const field = syntheticField({
    canonicalField: "crm.owner",
    canonicalValue: "89684655",
    canonicalDisplayValue: null,
  });
  const vm = buildTruthRowViewModel("crm.owner", field);
  assert.equal(vm.valueText, "89684655");
});

test("owner evidence lines show the resolved name AND the raw id together, never the id alone", () => {
  const ownerEvidence: EvidenceDTO = {
    kind: "observation",
    id: "eeeeeeee-0000-4000-8000-000000000005",
    provider: "hubspot",
    value: "89684655",
    observedAt: null,
    importedAt: "2026-08-20T00:00:00.000Z",
    displayName: "Mark van der Ree",
  };
  assert.equal(evidenceValueText("crm.owner", ownerEvidence), "Mark van der Ree (89684655)");
});

test("owner evidence with no resolved display name shows only the raw id, unchanged", () => {
  assert.equal(evidenceValueText("crm.owner", { ...OBSERVATION_EVIDENCE, value: "89684655" }), "89684655");
});

test("every canonical field has a non-blank human label", () => {
  for (const field of CANONICAL_TRUTH_FIELDS) {
    const label = fieldLabel(field);
    assert.ok(label.trim().length > 0, `missing label for ${field}`);
    assert.notEqual(label, field); // never the raw dotted path as its own label
  }
});

test("statusBadgeVariant never throws for any resolutionState/canonicalValue combination", () => {
  const states: Array<["single_source" | "agreement" | "conflict" | "unresolved", unknown]> = [
    ["single_source", "x"],
    ["agreement", "x"],
    ["conflict", "x"],
    ["conflict", null],
    ["unresolved", null],
  ];
  for (const [state, value] of states) {
    assert.doesNotThrow(() => statusBadgeVariant(state, value));
  }
});

test("formatEvidenceTimestamp returns null for a null/unparseable timestamp, never a fabricated date", () => {
  assert.equal(formatEvidenceTimestamp(null), null);
  assert.equal(formatEvidenceTimestamp("not-a-date"), null);
  assert.equal(typeof formatEvidenceTimestamp("2026-08-19T00:00:00.000Z"), "string");
});

// ---------------------------------------------------------------------
// M3.5 real-data defect fix — Account Snapshot identity summary.
// ---------------------------------------------------------------------
test("humanizeAliasType maps domain and known external_id providers to friendly labels", () => {
  assert.equal(humanizeAliasType("domain"), "Domain");
  assert.equal(humanizeAliasType("external_id:hubspot"), "HubSpot");
  assert.equal(humanizeAliasType("external_id:rb2b"), "RB2B");
});

test("humanizeAliasType falls back to the raw alias type for an unrecognized shape, never fabricating a label", () => {
  assert.equal(humanizeAliasType("external_id:some_future_provider"), "some_future_provider");
  assert.equal(humanizeAliasType("client_radar_account_id"), "client_radar_account_id");
});
