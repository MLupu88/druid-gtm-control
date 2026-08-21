// M3.5 — unit tests for ./rb2bIdentity.ts's pure request-shaping helpers.
// No DB, no network. See ./rb2bIdentity.integration.test.ts for the real
// Postgres-backed resolution behavior these builders feed into.
//
// Run with: tsx --test src/services/rb2bIdentity.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { buildRb2bCompany, buildRb2bPerson } from "./rb2bIdentity.js";
import type { Rb2bSignalBridgeRequest } from "./rb2bObservationMapping.js";

function minimalEvent(overrides: Partial<Rb2bSignalBridgeRequest> = {}): Rb2bSignalBridgeRequest {
  return {
    source: "rb2b",
    signal_type: "page_view",
    source_record_id: "evt-1",
    ingestion_attempt_at: "2026-08-22T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// buildRb2bCompany
// ---------------------------------------------------------------------

test("a company_domain becomes the normalized SignalCompanyV1 domain, with an empty externalIds map", () => {
  const company = buildRb2bCompany(minimalEvent({ company_domain: "HTTPS://WWW.Acme.Example/" }));
  assert.equal(company.domain, "acme.example");
  assert.deepEqual(company.externalIds, {});
});

test("no company_domain (or an unnormalizable one) becomes a null domain, never a guessed value", () => {
  const noDomain = buildRb2bCompany(minimalEvent({ company_domain: null }));
  assert.equal(noDomain.domain, null);
});

test("company_name is trimmed; a blank company_name becomes null", () => {
  const named = buildRb2bCompany(minimalEvent({ company_name: "  Acme Inc  " }));
  assert.equal(named.name, "Acme Inc");

  const blank = buildRb2bCompany(minimalEvent({ company_name: "   " }));
  assert.equal(blank.name, null);
});

// ---------------------------------------------------------------------
// buildRb2bPerson — company-level events must never manufacture a person
// ---------------------------------------------------------------------

test("an event with no contact fields at all returns null — never a fabricated person", () => {
  const person = buildRb2bPerson(minimalEvent());
  assert.equal(person, null);
});

test("contact_email alone is enough to build a person, normalized to a work email", () => {
  const person = buildRb2bPerson(minimalEvent({ contact_email: "Jane.Doe@Acme.EXAMPLE" }));
  assert.notEqual(person, null);
  assert.equal(person?.workEmail, "jane.doe@acme.example");
  assert.deepEqual(person?.externalIds, {});
});

test("contact_name/linkedin/contact_phone/contact_title alone (no email) still builds a person object, but with no workEmail — resolution decides strength, not this builder", () => {
  const person = buildRb2bPerson(minimalEvent({ contact_name: "Jane Doe" }));
  assert.notEqual(person, null);
  assert.equal(person?.fullName, "Jane Doe");
  assert.equal(person?.workEmail, null);
});

test("fullName/title/linkedinUrl are trimmed and blank strings become null", () => {
  const person = buildRb2bPerson(
    minimalEvent({ contact_name: "  Jane Doe  ", contact_title: "   ", linkedin: "  " }),
  );
  assert.equal(person?.fullName, "Jane Doe");
  assert.equal(person?.title, null);
  assert.equal(person?.linkedinUrl, null);
});

test("an invalid contact_email normalizes to a null workEmail rather than throwing", () => {
  const person = buildRb2bPerson(minimalEvent({ contact_email: "not-an-email" }));
  assert.notEqual(person, null);
  assert.equal(person?.workEmail, null);
});
