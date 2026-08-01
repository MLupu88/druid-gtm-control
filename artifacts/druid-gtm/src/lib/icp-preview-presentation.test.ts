// Tests for ./icp-preview-presentation.ts — the humanization logic
// behind the Account Detail UX pass's "ICP preview" panel
// (../components/account-icp-preview-panel.tsx). Pure functions, no DOM
// needed (this package has no jsdom/testing-library — see
// ./accounts-api.limit.test.ts, the first frontend test in this repo).
//
// Run with: tsx --test src/lib/icp-preview-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  humanizeDimension,
  humanizeTierLabel,
  formatScorePoints,
  describeReasonEntry,
  categorizeMissingInputs,
  TIER_EXPLANATION,
  eligibilityLabel,
  eligibilityBadgeVariant,
  hasIdentityNotPersonAddressableRestriction,
  deriveActionabilityState,
  ACTIONABILITY_STATE_LABELS,
} from "./icp-preview-presentation.js";

// ---------------------------------------------------------------------
// Humanized dimension/metric terminology
// ---------------------------------------------------------------------

test("humanizeDimension maps every evaluator dimension to plain GTM language", () => {
  assert.equal(humanizeDimension("fit"), "ICP fit");
  assert.equal(humanizeDimension("intent"), "Buying intent");
  assert.equal(humanizeDimension("actionability"), "Ability to act");
  assert.equal(humanizeDimension("eligibility"), "Outreach eligibility");
  assert.equal(humanizeDimension("identity"), "Identity resolution");
});

test("humanizeDimension falls back to a humanized token for an unknown dimension, never the raw value verbatim", () => {
  assert.equal(humanizeDimension("some_new_dimension"), "Some New Dimension");
});

test("formatScorePoints labels the number as a weighted score, never an invented out-of-100 scale", () => {
  assert.equal(formatScorePoints("42"), "42 points (weighted score)");
  assert.equal(formatScorePoints(null), "—");
  const result = formatScorePoints("42");
  assert.ok(!result.includes("100"), "score formatting must not invent a fixed maximum");
  assert.ok(result.includes("weighted"));
});

// ---------------------------------------------------------------------
// Band labels — "base"/"floor" must never render as bare title-cased
// tokens; meaning can't be safely inferred from the code alone (see
// ./icp-preview-presentation.ts's comment), so every band gets the same
// neutral, honest treatment. "Tier" is an internal/legacy word — never
// user-facing; see the "band" business terminology used throughout the
// ICP editor and account preview surfaces.
// ---------------------------------------------------------------------

test("band labels are never bare title-cased tokens like 'Base' or 'Floor', and use 'band' business language", () => {
  const base = humanizeTierLabel("base");
  const floor = humanizeTierLabel("floor");
  assert.ok(base);
  assert.ok(floor);
  assert.notEqual(base!.label, "Base");
  assert.notEqual(floor!.label, "Floor");
  assert.match(base!.label, /^Configured band: Base$/);
  assert.match(floor!.label, /^Configured band: Floor$/);
});

test("tier labels preserve the raw code separately for a technical-details view", () => {
  const tier = humanizeTierLabel("base");
  assert.equal(tier!.raw, "base");
});

test("a tier explanation is available to accompany every tier label", () => {
  assert.ok(TIER_EXPLANATION.toLowerCase().includes("profile"));
});

test("humanizeTierLabel returns null for a null/blank tier, never a fabricated label", () => {
  assert.equal(humanizeTierLabel(null), null);
  assert.equal(humanizeTierLabel("  "), null);
});

// ---------------------------------------------------------------------
// Reason-entry humanization — raw ruleId/field must never be the primary
// user-facing text.
// ---------------------------------------------------------------------

test("describeReasonEntry uses the curated canonical label for a known system ruleId", () => {
  const entry = describeReasonEntry({
    ruleId: "identity.company_only",
    dimension: "identity",
    description: "Company-level evidence present with no valid contact evidence.",
  });
  assert.match(entry.primary, /company is identified.*no verified individual contact/i);
  assert.equal(entry.technical, "identity.company_only");
  assert.notEqual(entry.primary, "identity.company_only");
});

test("describeReasonEntry uses the curated label for the canonical identity restriction", () => {
  const entry = describeReasonEntry({
    ruleId: "canonical.identity_not_person_addressable",
    description: "Identity resolved to anonymous or company only.",
  });
  assert.match(entry.primary, /cannot be used for person-addressed outreach/i);
  assert.equal(entry.technical, "canonical.identity_not_person_addressable");
});

test("describeReasonEntry uses the profile author's own description for a profile-authored rule, not the raw ruleId", () => {
  const entry = describeReasonEntry({
    ruleId: "has_domain",
    description: "A verified company domain is available.",
  });
  assert.equal(entry.primary, "A verified company domain is available.");
  assert.equal(entry.technical, "has_domain");
  assert.notEqual(entry.primary, "has_domain");
});

test("describeReasonEntry never uses a raw ruleId/field as primary text when no description exists", () => {
  const entry = describeReasonEntry({ ruleId: "some_obscure_internal_rule_42" });
  assert.notEqual(entry.primary, "some_obscure_internal_rule_42");
  assert.ok(entry.primary.length > 0);
  assert.equal(entry.technical, "some_obscure_internal_rule_42");

  const fieldOnly = describeReasonEntry({ field: "company.industry" });
  assert.notEqual(fieldOnly.primary, "company.industry");
  assert.equal(fieldOnly.technical, "company.industry");
});

test("describeReasonEntry falls back to neutral text (never raw JSON) for a totally unrecognized shape", () => {
  const entry = describeReasonEntry([1, 2, 3]);
  assert.notEqual(entry.primary, JSON.stringify([1, 2, 3]));
});

test("describeReasonEntry prefixes the humanized dimension when present", () => {
  const entry = describeReasonEntry({
    ruleId: "custom_rule",
    dimension: "fit",
    description: "This company is in a target industry.",
  });
  assert.ok(entry.primary.startsWith("ICP fit:"));
});

// ---------------------------------------------------------------------
// Missing-input categorization — must never let "no missing inputs"
// coexist with an unconditional "CRM/engagement/contact data is
// unavailable" claim. null (can't derive) / [] (verified none) /
// populated (real categories) are three distinct, non-contradictory
// states.
// ---------------------------------------------------------------------

test("categorizeMissingInputs returns null (not []) when the shape can't be read — 'data not available', never a false 'nothing missing'", () => {
  assert.equal(categorizeMissingInputs(undefined), null);
  assert.equal(categorizeMissingInputs("not an array"), null);
  assert.equal(categorizeMissingInputs({ not: "an array" }), null);
});

test("categorizeMissingInputs returns a real empty array when the evaluation genuinely had everything it needed", () => {
  const result = categorizeMissingInputs([]);
  assert.deepEqual(result, []);
});

test("categorizeMissingInputs groups known allowlisted fields into the requested plain-language categories", () => {
  const result = categorizeMissingInputs([
    { field: "crm.hubspotContactId", affects: ["actionability"] },
    { field: "engagement.pagesVisited", affects: ["intent"] },
    { field: "contact.email", affects: ["actionability"] },
  ]);
  assert.ok(result);
  const categories = result!.map((c) => c.category).sort();
  assert.deepEqual(categories, [
    "CRM context",
    "Engagement history",
    "Verified contact",
  ]);
});

test("categorizeMissingInputs attaches the humanized affected dimensions per category", () => {
  const result = categorizeMissingInputs([
    { field: "contact.email", affects: ["actionability"] },
    { field: "contact.phone", affects: ["actionability"] },
  ]);
  const contactCategory = result!.find((c) => c.category === "Verified contact");
  assert.ok(contactCategory);
  assert.deepEqual(contactCategory!.dimensions, ["Ability to act"]);
  assert.deepEqual(contactCategory!.fields, ["contact.email", "contact.phone"]);
});

test("categorizeMissingInputs never fabricates a consent category unless a real field actually names one", () => {
  const withoutConsent = categorizeMissingInputs([
    { field: "company.domain", affects: ["fit"] },
  ]);
  assert.ok(!withoutConsent!.some((c) => c.category === "Consent or lawful-basis information"));
});

// ---------------------------------------------------------------------
// Outreach eligibility label/badge
// ---------------------------------------------------------------------

test("eligibilityLabel truthfully reflects every real eligibilityOutcome value — never 'Eligible' for a restricted/ineligible result", () => {
  assert.equal(eligibilityLabel("eligible"), "Eligible");
  assert.equal(eligibilityLabel("restricted"), "Restricted");
  assert.equal(eligibilityLabel("ineligible"), "Disqualified");
  assert.equal(eligibilityLabel(null), "Unknown");
});

test("eligibilityBadgeVariant never uses the default/positive variant for a restricted or ineligible outcome", () => {
  assert.notEqual(eligibilityBadgeVariant("restricted"), "default");
  assert.notEqual(eligibilityBadgeVariant("ineligible"), "default");
  assert.equal(eligibilityBadgeVariant("eligible"), "default");
  assert.equal(eligibilityBadgeVariant("ineligible"), "destructive");
});

// ---------------------------------------------------------------------
// Identity-not-person-addressable restriction clarification
// ---------------------------------------------------------------------

test("hasIdentityNotPersonAddressableRestriction detects only the specific canonical rule, not any restriction", () => {
  assert.equal(
    hasIdentityNotPersonAddressableRestriction([
      { ruleId: "canonical.identity_not_person_addressable", description: "x" },
    ]),
    true,
  );
  assert.equal(
    hasIdentityNotPersonAddressableRestriction([
      { ruleId: "some_other_restriction", description: "x" },
    ]),
    false,
  );
});

test("hasIdentityNotPersonAddressableRestriction is defensively false for empty/malformed input, never a guess", () => {
  assert.equal(hasIdentityNotPersonAddressableRestriction([]), false);
  assert.equal(hasIdentityNotPersonAddressableRestriction(null), false);
  assert.equal(hasIdentityNotPersonAddressableRestriction("not an array"), false);
});

// ---------------------------------------------------------------------
// Actionability state derivation
// ---------------------------------------------------------------------

// A positive score does NOT win over a real, structurally-marked
// actionability gap (missingInputs entry whose `affects` includes
// "actionability" — real evaluator output, not a guess). Some rule may
// have matched (e.g. a CRM-owner rule) producing a positive score while
// a genuinely required field (contact.email) is still missing — that
// account still needs that data before real outreach.

test("positive score + an actionability-affecting contact.* gap => 'needs_contact_data' (the gap wins, not the score)", () => {
  assert.equal(
    deriveActionabilityState("5", [{ field: "contact.email", affects: ["actionability"] }]),
    "needs_contact_data",
  );
});

test("positive score + an actionability-affecting crm.* gap => 'needs_crm_data' (the gap wins, not the score)", () => {
  assert.equal(
    deriveActionabilityState("5", [{ field: "crm.hubspotOwner", affects: ["actionability"] }]),
    "needs_crm_data",
  );
});

test("positive score + a missing input that does NOT affect actionability => 'actionable' (an irrelevant gap never blocks it)", () => {
  assert.equal(
    deriveActionabilityState("5", [{ field: "engagement.pagesVisited", affects: ["intent"] }]),
    "actionable",
  );
  assert.equal(
    deriveActionabilityState("5", [{ field: "contact.email", affects: ["fit"] }]),
    "actionable",
  );
});

test("positive score + no relevant gaps at all => 'actionable'", () => {
  assert.equal(deriveActionabilityState("10", []), "actionable");
});

test("zero score + no relevant gaps => 'not_yet_actionable' (never fabricates a reason no missing-input entry supports)", () => {
  assert.equal(deriveActionabilityState("0", []), "not_yet_actionable");
  assert.equal(
    deriveActionabilityState("0", [{ field: "engagement.pagesVisited", affects: ["intent"] }]),
    "not_yet_actionable",
  );
});

test("deriveActionabilityState is 'needs_contact_data' when a zero/null score is explained by a missing contact.* field", () => {
  assert.equal(
    deriveActionabilityState("0", [{ field: "contact.email", affects: ["actionability"] }]),
    "needs_contact_data",
  );
  assert.equal(
    deriveActionabilityState(null, [{ field: "contact.phone", affects: ["actionability"] }]),
    "needs_contact_data",
  );
});

test("deriveActionabilityState is 'needs_crm_data' when a zero score is explained by a missing crm.* field, not contact.*", () => {
  assert.equal(
    deriveActionabilityState("0", [{ field: "crm.hubspotOwner", affects: ["actionability"] }]),
    "needs_crm_data",
  );
});

test("ACTIONABILITY_STATE_LABELS covers every state with plain business language, never a raw score", () => {
  for (const label of Object.values(ACTIONABILITY_STATE_LABELS)) {
    assert.ok(!/^\d/.test(label), `label "${label}" must not start with a raw number`);
  }
  assert.equal(ACTIONABILITY_STATE_LABELS.actionable, "Actionable");
  assert.equal(ACTIONABILITY_STATE_LABELS.needs_contact_data, "Needs contact data");
  assert.equal(ACTIONABILITY_STATE_LABELS.needs_crm_data, "Needs CRM data");
});
