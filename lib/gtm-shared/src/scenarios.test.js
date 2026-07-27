// scenarios.test.js — executable coverage for the 8 approved business-validation
// scenarios (product decision, 2026-07-24). Fixtures live in scenarioFixtures.js, marked
// provenance:"synthetic_demo_fixture" — never real evidence, customers, or Client Radar
// findings.
//
// visibleButtonsFor() mirrors rowButtons() in artifacts/druid-gtm/src/lib/queue-helpers.ts
// (buttonsForOutput + the identified-contact filter) — duplicated here only because that
// file is TypeScript in a separate workspace with no shared test runner; both ultimately
// call the same buttonsForOutput/hasIdentifiedContact functions from gtmContract.js, so
// there is no independent business-logic decision being re-made, just the same filter
// re-applied.
//
// Every scenario below asserts the same 8 things, in the same order, via
// runScenarioAssertions(): (1) recommended_output, (2) hasIdentifiedContact, (3) the
// complete visible action list, (4) relevant buttonDisabledPhaseC states, (5) research
// eligibility, (6) exact research purposes, (7) a non-empty operator-facing explanation,
// (8) provenance.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUTTONS,
  OUTPUT_TYPE_LABELS,
  SALES_REVIEW_REASON_LABELS,
  BLOCK_REASON_LABELS,
  buttonsForOutput,
  buttonDisabledPhaseC,
  hasIdentifiedContact,
  NO_PROSPECT,
} from "./gtmContract.js";
import { composeEmailDraft, composeLinkedinDraft } from "./messageComposer.js";
import { getResearchEligibility } from "./researchEligibility.js";
import { scenarioFixture } from "./scenarioFixtures.js";

function visibleButtonsFor(row) {
  const base = buttonsForOutput(row.recommended_output).filter((k) => BUTTONS[k]);
  if (hasIdentifiedContact(row)) return base;
  return base.filter((k) => k !== "approve_email" && k !== "approve_linkedin");
}

function operatorExplanation(row) {
  const meta = OUTPUT_TYPE_LABELS[row.recommended_output];
  assert.ok(meta, `OUTPUT_TYPE_LABELS must have an entry for ${row.recommended_output}`);
  assert.ok(meta.detail && meta.detail.length > 0, "operator-facing explanation must be non-empty");
  return meta.detail;
}

// scenarioId -> { expectedOutput, expectedIdentified, expectedVisible, expectedDisabled,
// expectedPurposes, extra } drives the 8 mandatory assertions uniformly; `extra(row)` adds
// any scenario-specific checks on top.
function runScenarioAssertions(scenarioId, {
  expectedOutput,
  expectedIdentified,
  expectedVisible,
  expectedDisabled,
  expectedPurposes,
  extra,
}) {
  const row = scenarioFixture(scenarioId);

  // (8) provenance
  assert.equal(row.provenance, "synthetic_demo_fixture");
  // (1) recommended_output
  assert.equal(row.recommended_output, expectedOutput);
  // (2) hasIdentifiedContact
  assert.equal(hasIdentifiedContact(row), expectedIdentified);
  // (3) complete visible action list
  const visible = visibleButtonsFor(row);
  assert.deepEqual(visible.slice().sort(), expectedVisible.slice().sort());
  // (4) relevant blocked actions via buttonDisabledPhaseC (live config, non-preview)
  const liveCfg = { engine_mode: "live" };
  for (const [btn, disabled] of Object.entries(expectedDisabled)) {
    assert.equal(
      buttonDisabledPhaseC(btn, row, liveCfg),
      disabled,
      `scenario ${scenarioId}: ${btn} disabled should be ${disabled}`,
    );
  }
  // (5) research eligibility + (6) exact purposes
  const research = getResearchEligibility(row);
  assert.equal(research.eligible, true);
  assert.deepEqual(research.purposes.slice().sort(), expectedPurposes.slice().sort());
  // (7) non-empty operator-facing explanation
  operatorExplanation(row);

  if (extra) extra(row);

  return row;
}

// ───────────────────────── Scenario 1: specific use-case interest + identified person ───

test("Scenario 1 (specific use-case interest, identified person): MQL, identified, Email/LinkedIn available, new_prospecting research", () => {
  runScenarioAssertions(1, {
    expectedOutput: "MQL",
    expectedIdentified: true,
    expectedVisible: ["approve_email", "approve_linkedin", "approve_call", "to_sales_review", "reject"],
    expectedDisabled: { approve_call: true, approve_email: false, approve_linkedin: false },
    expectedPurposes: ["new_prospecting"],
    extra: (row) => {
      assert.equal(
        buttonDisabledPhaseC("approve_linkedin", row, { engine_mode: "live" }),
        false,
        "LinkedIn preparation available for a valid identified contact where output guards permit it",
      );
    },
  });
});

// ───────────────────────── Scenario 2: generic /pricing intent ─────────────────────────

test("Scenario 2 (generic /pricing intent): never represented as MQL, Sales Review only, identified contact, generic fallback composer, new_prospecting research", () => {
  runScenarioAssertions(2, {
    expectedOutput: "Sales Review",
    expectedIdentified: true,
    expectedVisible: ["promote_mql", "nurture", "reject", "suppress"],
    expectedDisabled: { approve_call: true },
    expectedPurposes: ["new_prospecting"],
    extra: (row) => {
      assert.notEqual(row.recommended_output, "MQL", "a bare /pricing signal must never be represented as MQL");
      assert.equal(row.recommended_solution, undefined, "no specific use case backs this signal");
      assert.match(row.why_now, /\/pricing/);
      assert.ok(
        SALES_REVIEW_REASON_LABELS[row.sales_review_reason],
        "sales_review_reason must have a plain-language label",
      );

      const draft = composeLinkedinDraft(row);
      assert.equal(draft.fallback, true, "a bare /pricing signal must remain the generic fallback, never a tailored claim");
      assert.doesNotMatch(draft.text, /DRUID could help with Pricing/i);
    },
  });
});

// ───────────────────────── Scenario 3: company-only, no identified person ───────────────

test("Scenario 3 (company-only, no identified person): no prospect-facing draft, even though recommended_output is MQL; research still eligible", () => {
  runScenarioAssertions(3, {
    expectedOutput: "MQL",
    expectedIdentified: false,
    expectedVisible: ["approve_call", "to_sales_review", "reject"],
    expectedDisabled: { approve_call: true, approve_email: true, approve_linkedin: true },
    expectedPurposes: ["new_prospecting"],
    extra: (row) => {
      const emailDraft = composeEmailDraft(row);
      const linkedinDraft = composeLinkedinDraft(row);
      assert.equal(emailDraft.blocked, true);
      assert.equal(emailDraft.subject, "");
      assert.equal(emailDraft.body, "");
      assert.equal(linkedinDraft.blocked, true);
      assert.equal(linkedinDraft.text, "");

      // Defense in depth: previewOnly must not bypass the identity block either.
      assert.equal(buttonDisabledPhaseC("approve_email", row, {}, true), true);
      assert.equal(buttonDisabledPhaseC("approve_linkedin", row, {}, true), true);
    },
  });
});

// ───────────────────────── Scenario 4: existing open opportunity ────────────────────────

test("Scenario 4 (existing open opportunity): identified, Pipeline Assist, prospect-facing channels blocked by the output guard, research eligible for pipeline_assist/owner_support", () => {
  runScenarioAssertions(4, {
    expectedOutput: "Pipeline Assist",
    expectedIdentified: true,
    expectedVisible: ["notify_owner", "dismiss"],
    expectedDisabled: { approve_call: true, approve_email: true, approve_linkedin: true },
    expectedPurposes: ["pipeline_assist", "owner_support", "account_expansion"],
    extra: (row) => {
      assert.equal(row.open_opportunity, "true");
      assert.ok(NO_PROSPECT.has(row.recommended_output));
    },
  });
});

// ───────────────────────── Scenario 5: known owner, no open opportunity ─────────────────

test("Scenario 5 (known owner, no open opportunity): identified, Owner Alert, Email/LinkedIn not visible because of the Owner Alert output guard, research eligible for owner_support/account_expansion", () => {
  runScenarioAssertions(5, {
    expectedOutput: "Owner Alert",
    expectedIdentified: true,
    expectedVisible: ["notify_owner", "promote_mql_owner", "dismiss"],
    expectedDisabled: { approve_call: true, approve_email: true, approve_linkedin: true },
    expectedPurposes: ["owner_support", "account_expansion"],
    extra: (row) => {
      assert.equal(row.open_opportunity, "false");
      assert.notEqual(row.hubspot_owner, "");
      assert.ok(
        NO_PROSPECT.has(row.recommended_output),
        "Email/LinkedIn are excluded by the Owner Alert output guard (NO_PROSPECT), not merely by identity",
      );
    },
  });
});

// ───────────────────────── Scenario 6: weak or generic signal ───────────────────────────

test("Scenario 6 (weak/generic signal): not identified, Nurture, no outreach action, low-priority research", () => {
  runScenarioAssertions(6, {
    expectedOutput: "Nurture",
    expectedIdentified: false,
    expectedVisible: ["nurture", "dismiss"],
    expectedDisabled: { approve_call: true, approve_email: true, approve_linkedin: true },
    expectedPurposes: ["new_prospecting"],
    extra: (row) => {
      const explanation = OUTPUT_TYPE_LABELS[row.recommended_output].detail;
      assert.doesNotMatch(explanation, /ready for sales/i);
    },
  });
});

// ───────────────────────── Scenario 7: existing customer / suppressed ───────────────────

test("Scenario 7 (existing customer / suppressed): identified, Suppressed, all prospect-facing channels blocked, research eligible for intelligence/expansion", () => {
  runScenarioAssertions(7, {
    expectedOutput: "Suppressed",
    expectedIdentified: true,
    expectedVisible: ["view_reason"],
    expectedDisabled: { approve_call: true, approve_email: true, approve_linkedin: true },
    expectedPurposes: ["existing_customer_intelligence", "account_expansion", "owner_support"],
    extra: (row) => {
      assert.equal(row.existing_customer, "true");
      assert.ok(NO_PROSPECT.has(row.recommended_output));
      assert.ok(BLOCK_REASON_LABELS[row.block_reason], "block_reason must have a plain-language label shown to the operator");
    },
  });
});

// ───────────────────────── Scenario 8: identified contact, Email basis unknown ──────────

test("Scenario 8 (identified contact, Email basis insufficient/unknown): complete visible action list, Email blocked by its existing policy, LinkedIn preparation enabled, voice disabled", () => {
  runScenarioAssertions(8, {
    expectedOutput: "MQL",
    expectedIdentified: true,
    expectedVisible: ["approve_email", "approve_linkedin", "approve_call", "to_sales_review", "reject"],
    expectedDisabled: { approve_call: true, approve_email: true, approve_linkedin: false },
    expectedPurposes: ["new_prospecting"],
    extra: (row) => {
      assert.equal(row.region, "emea");
      assert.equal(row.consent_email, "false");
      assert.equal(row.li_basis_cleared, "false");
    },
  });
});
