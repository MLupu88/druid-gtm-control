// Unit tests for ./account-facts-presentation.ts — every DOM-free
// decision ../components/account-facts-panel.tsx relies on. This package
// has no jsdom/testing-library (confirmed against package.json's
// devDependencies before writing this file), so actual component
// rendering (does the panel visually show these strings, does clicking
// "Confirm" open the form, does the Select widget restrict input to
// us/emea/other) is NOT exercised here — see the module comment at the
// bottom of this file for the exact list of browser-only interactions
// this leaves uncovered.
//
// Run with: tsx --test src/lib/account-facts-presentation.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFactRowViewModel,
  buildRecordAccountFactArgs,
  currentForField,
  describeAccountFactsError,
  displayFactValue,
  formatFactDateTime,
  historyForField,
} from "./account-facts-presentation.js";
import {
  ACCOUNT_FACT_FIELDS,
  ACCOUNT_FACT_REGION_VALUES,
  AccountFactsApiError,
  type AccountFact,
} from "./account-facts-api.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const FACT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function syntheticFact(overrides: Partial<AccountFact> = {}): AccountFact {
  return {
    id: FACT_ID,
    field: "company.industry",
    value: "Banking",
    recordedBy: "operator@example.com",
    observedAt: "2026-01-01T12:00:00.000Z",
    recordedAt: "2026-01-01T12:00:00.000Z",
    correctionReason: null,
    supersedesFactId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// All five supported fields are represented.
// ---------------------------------------------------------------------

test("all five supported fields are represented, and each produces a valid view model", () => {
  assert.deepEqual(ACCOUNT_FACT_FIELDS, [
    "company.industry",
    "company.country",
    "company.region",
    "company.employeeRange",
    "company.revenueRange",
  ]);
  for (const field of ACCOUNT_FACT_FIELDS) {
    const vm = buildFactRowViewModel(field, null);
    assert.equal(vm.field, field);
    assert.ok(vm.label.length > 0, `${field} must have a non-empty label`);
  }
});

// ---------------------------------------------------------------------
// Row view model: absent -> "Not yet confirmed"; present -> value +
// operator + date.
// ---------------------------------------------------------------------

test("absent values display 'Not yet confirmed', with no value/attribution text", () => {
  const vm = buildFactRowViewModel("company.industry", null);
  assert.equal(vm.confirmed, false);
  assert.equal(vm.statusText, "Not yet confirmed");
  assert.equal(vm.valueText, null);
  assert.equal(vm.attributionText, null);
  assert.equal(vm.actionLabel, "Confirm");
});

test("current facts display value, operator and date", () => {
  const fact = syntheticFact({ value: "Banking", recordedBy: "jane@example.com" });
  const vm = buildFactRowViewModel("company.industry", fact);
  assert.equal(vm.confirmed, true);
  assert.equal(vm.statusText, null);
  assert.equal(vm.valueText, "Banking");
  assert.ok(vm.attributionText!.includes("jane@example.com"));
  assert.ok(vm.attributionText!.includes(formatFactDateTime(fact.observedAt)));
  assert.equal(vm.actionLabel, "Correct");
});

test("displayFactValue renders company.region values as US/EMEA/Other, and every other field verbatim", () => {
  assert.equal(displayFactValue("company.region", "us"), "US");
  assert.equal(displayFactValue("company.region", "emea"), "EMEA");
  assert.equal(displayFactValue("company.region", "other"), "Other");
  assert.equal(displayFactValue("company.industry", "Banking"), "Banking");
});

test("formatFactDateTime returns a non-empty, non-em-dash string for a valid ISO timestamp", () => {
  const formatted = formatFactDateTime("2026-01-01T12:00:00.000Z");
  assert.notEqual(formatted, "—");
  assert.ok(formatted.length > 0);
});

test("formatFactDateTime falls back to an em dash for an invalid timestamp, never throwing or showing 'Invalid Date'", () => {
  assert.equal(formatFactDateTime("not-a-date"), "—");
});

// ---------------------------------------------------------------------
// Region offers only us, emea, other.
// ---------------------------------------------------------------------

test("region offers only 'us', 'emea', and 'other' — never 'unknown' or any other value", () => {
  assert.deepEqual(ACCOUNT_FACT_REGION_VALUES, ["us", "emea", "other"]);
});

// ---------------------------------------------------------------------
// Grouping helpers.
// ---------------------------------------------------------------------

test("currentForField returns the matching current fact, or null", () => {
  const industry = syntheticFact({ id: "a", field: "company.industry" });
  const country = syntheticFact({ id: "b", field: "company.country" });
  const current = [industry, country];
  assert.equal(currentForField(current, "company.industry"), industry);
  assert.equal(currentForField(current, "company.region"), null);
});

test("history includes prior assertions for the field, and excludes other fields", () => {
  const industryOld = syntheticFact({ id: "old", field: "company.industry", value: "Insurance" });
  const countryOld = syntheticFact({ id: "c-old", field: "company.country", value: "Germany" });
  const history = [industryOld, countryOld];
  assert.deepEqual(historyForField(history, "company.industry"), [industryOld]);
  assert.deepEqual(historyForField(history, "company.country"), [countryOld]);
  assert.deepEqual(historyForField(history, "company.region"), []);
});

// ---------------------------------------------------------------------
// Submission — the exact CAS args a Confirm/Correct submit sends.
// ---------------------------------------------------------------------

test("initial confirmation submits expectedCurrentFactId: null and correctionReason: null", () => {
  const result = buildRecordAccountFactArgs({
    accountId: ACCOUNT_ID,
    field: "company.industry",
    currentFactId: null,
    draftValue: "Banking",
    draftCorrectionReason: "",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.args.expectedCurrentFactId, null);
    assert.equal(result.args.correctionReason, null);
    assert.equal(result.args.value, "Banking");
    assert.equal(result.args.accountId, ACCOUNT_ID);
    assert.equal(result.args.field, "company.industry");
  }
});

test("correction submits the current fact ID as expectedCurrentFactId", () => {
  const result = buildRecordAccountFactArgs({
    accountId: ACCOUNT_ID,
    field: "company.industry",
    currentFactId: FACT_ID,
    draftValue: "Insurance",
    draftCorrectionReason: "Updated after a re-check",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.args.expectedCurrentFactId, FACT_ID);
    assert.equal(result.args.correctionReason, "Updated after a re-check");
  }
});

test("correction is blocked until the reason is non-blank", () => {
  for (const blankReason of ["", "   "]) {
    const result = buildRecordAccountFactArgs({
      accountId: ACCOUNT_ID,
      field: "company.industry",
      currentFactId: FACT_ID,
      draftValue: "Insurance",
      draftCorrectionReason: blankReason,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "correction_reason_required");
    }
  }
});

test("a blank value is always rejected, correction or not", () => {
  const initial = buildRecordAccountFactArgs({
    accountId: ACCOUNT_ID,
    field: "company.industry",
    currentFactId: null,
    draftValue: "   ",
    draftCorrectionReason: "",
  });
  assert.equal(initial.ok, false);
  if (!initial.ok) assert.equal(initial.error, "value_required");

  const correction = buildRecordAccountFactArgs({
    accountId: ACCOUNT_ID,
    field: "company.industry",
    currentFactId: FACT_ID,
    draftValue: "",
    draftCorrectionReason: "a real reason",
  });
  assert.equal(correction.ok, false);
  if (!correction.ok) assert.equal(correction.error, "value_required");
});

test("submitted value and correction reason are trimmed", () => {
  const result = buildRecordAccountFactArgs({
    accountId: ACCOUNT_ID,
    field: "company.industry",
    currentFactId: FACT_ID,
    draftValue: "  Insurance  ",
    draftCorrectionReason: "  a reason  ",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.args.value, "Insurance");
    assert.equal(result.args.correctionReason, "a reason");
  }
});

// ---------------------------------------------------------------------
// Refresh-and-retry preserves the operator's draft: the panel's retry
// path re-derives args from the SAME draftValue/draftCorrectionReason
// state, only currentFactId changes (see
// ../components/account-facts-panel.tsx's refreshAndRetry, which never
// touches `value`/`correctionReason` state) — proven here by calling the
// same pure builder twice with an updated id and asserting the draft
// text survives unchanged.
// ---------------------------------------------------------------------

test("refresh-and-retry preserves the operator's draft value and reason across a stale-id retry", () => {
  const draftValue = "Insurance";
  const draftCorrectionReason = "Corrected after review";

  const staleAttempt = buildRecordAccountFactArgs({
    accountId: ACCOUNT_ID,
    field: "company.industry",
    currentFactId: "stale-fact-id",
    draftValue,
    draftCorrectionReason,
  });
  assert.equal(staleAttempt.ok, true);

  // Simulates refreshAndRetry: only currentFactId is refreshed to the
  // now-current id; the operator's draft text is untouched.
  const retryAttempt = buildRecordAccountFactArgs({
    accountId: ACCOUNT_ID,
    field: "company.industry",
    currentFactId: "fresh-fact-id",
    draftValue,
    draftCorrectionReason,
  });
  assert.equal(retryAttempt.ok, true);
  if (staleAttempt.ok && retryAttempt.ok) {
    assert.equal(retryAttempt.args.value, staleAttempt.args.value);
    assert.equal(retryAttempt.args.correctionReason, staleAttempt.args.correctionReason);
    assert.notEqual(retryAttempt.args.expectedCurrentFactId, staleAttempt.args.expectedCurrentFactId);
    assert.equal(retryAttempt.args.expectedCurrentFactId, "fresh-fact-id");
  }
});

// ---------------------------------------------------------------------
// Error presentation — 409 produces the stale-value conflict state;
// every other error uses the normal safe generic presentation.
// ---------------------------------------------------------------------

test("HTTP 409 (stale_fact_correction) produces the stale-value conflict state", () => {
  const err = new AccountFactsApiError("changed since loaded", "stale_fact_correction");
  const presentation = describeAccountFactsError(err);
  assert.deepEqual(presentation, { kind: "conflict" });
});

test("an unrelated AccountFactsApiError uses the normal safe error presentation with its own message", () => {
  const err = new AccountFactsApiError("Not found.", "account_not_found");
  const presentation = describeAccountFactsError(err);
  assert.deepEqual(presentation, { kind: "generic", message: "Not found." });
});

test("a non-API error (e.g. a network failure) uses the safe fallback message, never a raw/leaked message", () => {
  const presentation = describeAccountFactsError(new TypeError("Failed to fetch"));
  assert.equal(presentation.kind, "generic");
  if (presentation.kind === "generic") {
    assert.equal(presentation.message, "Could not save this fact.");
  }
});

test("a thrown non-Error value also uses the safe fallback message", () => {
  const presentation = describeAccountFactsError("some string thrown");
  assert.deepEqual(presentation, { kind: "generic", message: "Could not save this fact." });
});

// ---------------------------------------------------------------------
// Explicitly browser-only (NOT covered by this file, no DOM available):
//   - the panel actually renders these strings on screen;
//   - clicking Confirm/Correct opens the inline form;
//   - the region Select widget visually restricts input to US/EMEA/Other
//     (buildRecordAccountFactArgs/ACCOUNT_FACT_REGION_VALUES prove the
//     DATA is restricted; the widget itself rendering only those three
//     options, and rejecting free typing, is a rendering concern);
//   - the History disclosure toggling open/closed;
//   - the Save button's disabled state actually preventing a click;
//   - React Query's real network round-trip / query invalidation timing;
//   - visual conflict/error banners appearing in the DOM.
// ---------------------------------------------------------------------
