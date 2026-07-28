// Unit tests for NormalizedAccountInputV1's strictness and nullability
// contract.
//
// Run with: tsx --test lib/evaluator/src/types.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  NormalizedAccountInputV1Schema,
  type NormalizedAccountInputV1,
} from "./types.js";

function minimalInput(): NormalizedAccountInputV1 {
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

test("a fully-null/empty minimal input parses successfully — missing business evidence is not malformed input", () => {
  const parsed = NormalizedAccountInputV1Schema.parse(minimalInput());
  assert.equal(parsed.contact, null);
  assert.equal(parsed.company.domain, null);
});

test('schemaVersion must be exactly the literal "v1"', () => {
  const input = { ...minimalInput(), schemaVersion: "v2" };
  assert.throws(() => NormalizedAccountInputV1Schema.parse(input));
});

test("unrestricted arbitrary top-level fields are rejected", () => {
  const input = { ...minimalInput(), extraField: "not allowed" };
  assert.throws(() => NormalizedAccountInputV1Schema.parse(input));
});

test("unrestricted arbitrary nested fields are rejected", () => {
  const input = minimalInput();
  const withExtra = {
    ...input,
    company: { ...input.company, unexpected: true },
  };
  assert.throws(() => NormalizedAccountInputV1Schema.parse(withExtra));
});

test("a populated contact with a stable identifier and explicit provenance parses successfully", () => {
  const input = minimalInput();
  input.contact = {
    name: "Jordan Rivera",
    email: "j.rivera@example.com",
    phone: null,
    title: "Director of CX",
    linkedinUrl: null,
    origin: "rb2b",
  };
  const parsed = NormalizedAccountInputV1Schema.parse(input);
  assert.equal(parsed.contact?.origin, "rb2b");
});

test("blank strings are rejected in favor of null (never an empty-string placeholder)", () => {
  const input = minimalInput();
  input.company.domain = "";
  assert.throws(() => NormalizedAccountInputV1Schema.parse(input));
});

test("contact.origin must be one of the closed enum values", () => {
  const valid = minimalInput();
  const input = {
    ...valid,
    contact: {
      name: null,
      email: "a@example.com",
      phone: null,
      title: null,
      linkedinUrl: null,
      origin: "made_up_source",
    },
  };
  assert.throws(() => NormalizedAccountInputV1Schema.parse(input));
});
