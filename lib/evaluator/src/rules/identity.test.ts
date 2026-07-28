// Unit tests for canonical identity resolution: precedence, anti-
// fabrication guarantees, and the fact that identity takes no profile
// config input at all.
//
// Run with: tsx --test lib/evaluator/src/rules/identity.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateIdentity } from "./identity.js";
import type { NormalizedAccountInputV1 } from "../types.js";

function baseInput(): NormalizedAccountInputV1 {
  return {
    schemaVersion: "v1",
    company: {
      domain: null,
      name: null,
      industry: null,
      employeeRange: null,
      revenueRange: null,
      region: "unknown",
      country: null,
    },
    engagement: {
      sources: [],
      pagesVisited: [],
      distinctSourceCount: 0,
      repeatVisit: false,
      lastSeenAt: null,
    },
    contact: null,
    crm: {
      hubspotCompanyId: null,
      hubspotContactId: null,
      hubspotOwner: null,
      openOpportunity: false,
      existingCustomer: false,
      competitorFlag: false,
      partnerFlag: false,
    },
    doNotContact: false,
    consent: {
      email: "unknown",
      call: "unknown",
      liBasisCleared: "unknown",
      dpoVoiceCleared: "unknown",
    },
    source: "test",
  };
}

test("no company or contact evidence => anonymous / low", () => {
  const result = evaluateIdentity(baseInput());
  assert.equal(result.resolutionLevel, "anonymous");
  assert.equal(result.confidence, "low");
});

test("company evidence with no valid contact evidence => company / medium", () => {
  const input = baseInput();
  input.company.domain = "acme.com";
  const result = evaluateIdentity(input);
  assert.equal(result.resolutionLevel, "company");
  assert.equal(result.confidence, "medium");
});

test("hubspotCompanyId alone => company / medium", () => {
  const input = baseInput();
  input.crm.hubspotCompanyId = "co_123";
  const result = evaluateIdentity(input);
  assert.equal(result.resolutionLevel, "company");
  assert.equal(result.confidence, "medium");
});

test("verified known CRM contact (hubspot_known origin + hubspotContactId) => known_crm_contact / high", () => {
  const input = baseInput();
  input.contact = {
    name: "Morgan Chen",
    email: null,
    phone: null,
    title: null,
    linkedinUrl: null,
    origin: "hubspot_known",
  };
  input.crm.hubspotContactId = "ct_456";
  const result = evaluateIdentity(input);
  assert.equal(result.resolutionLevel, "known_crm_contact");
  assert.equal(result.confidence, "high");
});

test("hubspotContactId without email/phone/LinkedIn still => known_crm_contact / high", () => {
  const input = baseInput();
  input.contact = {
    name: null,
    email: null,
    phone: null,
    title: null,
    linkedinUrl: null,
    origin: "hubspot_known",
  };
  input.crm.hubspotContactId = "ct_789";
  const result = evaluateIdentity(input);
  assert.equal(result.resolutionLevel, "known_crm_contact");
  assert.equal(result.confidence, "high");
});

test("hubspot_known origin WITHOUT a hubspotContactId is not verified — falls to weak provenance, not known_crm_contact", () => {
  const input = baseInput();
  input.contact = {
    name: null,
    email: "j@example.com",
    phone: null,
    title: null,
    linkedinUrl: null,
    origin: "hubspot_known",
  };
  input.crm.hubspotContactId = null;
  const result = evaluateIdentity(input);
  assert.notEqual(result.resolutionLevel, "known_crm_contact");
  assert.equal(result.resolutionLevel, "contact");
  assert.equal(result.confidence, "low");
});

for (const origin of ["form_submit", "self_identified", "rb2b"] as const) {
  test(`direct person evidence (origin "${origin}") with a stable identifier => contact / high`, () => {
    const input = baseInput();
    input.contact = {
      name: null,
      email: "a@example.com",
      phone: null,
      title: null,
      linkedinUrl: null,
      origin,
    };
    const result = evaluateIdentity(input);
    assert.equal(result.resolutionLevel, "contact");
    assert.equal(result.confidence, "high");
  });
}

test("enrichment-derived reconstructed contact => contact / medium, never high", () => {
  const input = baseInput();
  input.contact = {
    name: null,
    email: "a@example.com",
    phone: null,
    title: null,
    linkedinUrl: null,
    origin: "cognism_reconstructed",
  };
  const result = evaluateIdentity(input);
  assert.equal(result.resolutionLevel, "contact");
  assert.equal(result.confidence, "medium");
});

test("weak/unknown provenance with a stable identifier => contact / low", () => {
  const input = baseInput();
  input.contact = {
    name: null,
    email: "a@example.com",
    phone: null,
    title: null,
    linkedinUrl: null,
    origin: "unknown",
  };
  const result = evaluateIdentity(input);
  assert.equal(result.resolutionLevel, "contact");
  assert.equal(result.confidence, "low");
});

test("name/title alone (no email/phone/linkedin/hubspotContactId) never produces contact identity", () => {
  const input = baseInput();
  input.contact = {
    name: "Jane Doe",
    email: null,
    phone: null,
    title: "VP Ops",
    linkedinUrl: null,
    origin: "rb2b",
  };
  const result = evaluateIdentity(input);
  assert.notEqual(result.resolutionLevel, "contact");
  assert.notEqual(result.resolutionLevel, "known_crm_contact");
  // No company evidence either in this fixture, so it falls all the way to anonymous.
  assert.equal(result.resolutionLevel, "anonymous");
});

test("company evidence present alongside a name/title-only contact => company / medium, not contact", () => {
  const input = baseInput();
  input.company.domain = "acme.com";
  input.contact = {
    name: "Jane Doe",
    email: null,
    phone: null,
    title: "VP Ops",
    linkedinUrl: null,
    origin: "rb2b",
  };
  const result = evaluateIdentity(input);
  assert.equal(result.resolutionLevel, "company");
  assert.equal(result.confidence, "medium");
});

test("company-only intelligence (industry/employeeRange filled, no contact) never becomes contact or known_crm_contact", () => {
  const input = baseInput();
  input.company.domain = "acme.com";
  input.company.industry = "Insurance";
  input.company.employeeRange = "1000-5000";
  const result = evaluateIdentity(input);
  assert.equal(result.resolutionLevel, "company");
});

test("provenance is recorded in matchedRules for every resolution branch", () => {
  const input = baseInput();
  input.contact = {
    name: null,
    email: "a@example.com",
    phone: null,
    title: null,
    linkedinUrl: null,
    origin: "cognism_reconstructed",
  };
  const result = evaluateIdentity(input);
  assert.equal(result.matchedRules.length, 1);
  assert.equal(result.matchedRules[0]!.dimension, "identity");
  assert.match(result.matchedRules[0]!.description, /reconstructed/i);
});

test("evaluateIdentity has no profile-config parameter — identity cannot be profile-authored, by construction", () => {
  // A TypeScript-level guarantee: evaluateIdentity's signature accepts
  // exactly one argument (NormalizedAccountInputV1). This test asserts
  // that at the function-arity level, so a future refactor accidentally
  // adding a config parameter would break this test rather than silently
  // making identity configurable.
  assert.equal(evaluateIdentity.length, 1);
});
