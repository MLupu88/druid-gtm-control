// researchEligibility.test.js — unit tests for the Client Radar research-eligibility rule.
// Run with: node --test lib/gtm-shared/src/researchEligibility.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { getResearchEligibility, RESEARCH_PURPOSES } from "./researchEligibility.js";

// ───────────────────────── not a decorative always-true function ────────────────────────

test("getResearchEligibility: a row with no usable identifier at all is NOT eligible", () => {
  const result = getResearchEligibility({ provenance: "synthetic_demo_fixture" });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.purposes, []);
  assert.equal(result.reason, "no_usable_account_identifier");
});

test("getResearchEligibility: blank-string identifiers count as no usable identifier", () => {
  const result = getResearchEligibility({
    provenance: "synthetic_demo_fixture",
    account_key: "",
    company_domain: "  ",
    company_name: "",
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "no_usable_account_identifier");
});

// ───────────────────────── any single usable identifier is enough ───────────────────────

test("getResearchEligibility: account_key alone is a usable identifier", () => {
  const result = getResearchEligibility({ provenance: "synthetic_demo_fixture", account_key: "fixture:acme.example" });
  assert.equal(result.eligible, true);
});

test("getResearchEligibility: company_domain alone is a usable identifier", () => {
  const result = getResearchEligibility({ provenance: "synthetic_demo_fixture", company_domain: "acme.example" });
  assert.equal(result.eligible, true);
});

test("getResearchEligibility: company_name alone is a usable identifier", () => {
  const result = getResearchEligibility({ provenance: "synthetic_demo_fixture", company_name: "Acme Fixture Co" });
  assert.equal(result.eligible, true);
});

// ───────────────────────── purposes are derived from row state, not hardcoded ───────────

test("getResearchEligibility: no special state derives purposes: ['new_prospecting'] only", () => {
  const result = getResearchEligibility({
    provenance: "synthetic_demo_fixture",
    company_name: "Fixture Co",
    open_opportunity: "false",
    existing_customer: "false",
    hubspot_owner: "",
  });
  assert.deepEqual(result.purposes, ["new_prospecting"]);
});

test("getResearchEligibility: open_opportunity=true derives pipeline_assist + owner_support, and is eligible regardless of prospecting restrictions", () => {
  const result = getResearchEligibility({
    provenance: "synthetic_demo_fixture",
    company_name: "Fixture Opportunity Co",
    recommended_output: "Pipeline Assist",
    open_opportunity: "true",
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.purposes.slice().sort(), ["owner_support", "pipeline_assist"].sort());
});

test("getResearchEligibility: existing_customer=true derives existing_customer_intelligence + account_expansion, and is eligible even though prospecting must be blocked", () => {
  const result = getResearchEligibility({
    provenance: "synthetic_demo_fixture",
    company_name: "Fixture Existing Customer Co",
    existing_customer: "true",
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.purposes.slice().sort(), ["account_expansion", "existing_customer_intelligence"].sort());
});

test("getResearchEligibility: recommended_output=Suppressed also derives existing_customer_intelligence + account_expansion", () => {
  const result = getResearchEligibility({
    provenance: "synthetic_demo_fixture",
    company_name: "Fixture Suppressed Co",
    recommended_output: "Suppressed",
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(result.purposes.slice().sort(), ["account_expansion", "existing_customer_intelligence"].sort());
});

test("getResearchEligibility: hubspot_owner present derives owner_support + account_expansion", () => {
  const result = getResearchEligibility({
    provenance: "synthetic_demo_fixture",
    company_name: "Fixture Owned Co",
    hubspot_owner: "Fixture Owner",
  });
  assert.deepEqual(result.purposes.slice().sort(), ["account_expansion", "owner_support"].sort());
});

test("getResearchEligibility: multiple matching conditions produce a union of purposes, not just one", () => {
  const result = getResearchEligibility({
    provenance: "synthetic_demo_fixture",
    company_name: "Fixture Suppressed Owned Co",
    recommended_output: "Suppressed",
    existing_customer: "true",
    hubspot_owner: "Fixture Owner",
  });
  assert.deepEqual(
    result.purposes.slice().sort(),
    ["account_expansion", "existing_customer_intelligence", "owner_support"].sort(),
  );
});

test("getResearchEligibility: identity/prospecting state (company-only, anonymous) does not affect eligibility", () => {
  const companyOnly = getResearchEligibility({
    provenance: "synthetic_demo_fixture",
    company_name: "Fixture Company Only Ltd",
    identity_resolution: "company_level",
  });
  assert.equal(companyOnly.eligible, true);
});

test("RESEARCH_PURPOSES: every purpose ever returned by getResearchEligibility is a declared purpose", () => {
  const fixtures = [
    { provenance: "synthetic_demo_fixture", company_name: "A" },
    { provenance: "synthetic_demo_fixture", company_name: "B", open_opportunity: "true" },
    { provenance: "synthetic_demo_fixture", company_name: "C", existing_customer: "true" },
    { provenance: "synthetic_demo_fixture", company_name: "D", recommended_output: "Suppressed" },
    { provenance: "synthetic_demo_fixture", company_name: "E", hubspot_owner: "Someone" },
  ];
  for (const fixture of fixtures) {
    const { purposes } = getResearchEligibility(fixture);
    for (const purpose of purposes) {
      assert.ok(RESEARCH_PURPOSES.includes(purpose), `${purpose} must be a declared RESEARCH_PURPOSES entry`);
    }
  }
});
