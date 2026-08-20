// Unit tests for ProviderObservationV1's discriminated-union strictness,
// per-class shape, and cross-field invariants.
//
// Run with: tsx --test lib/observation/src/types.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  ProviderObservationV1Schema,
  type IdentityObservationV1,
  type FirmographicFactObservationV1,
  type CrmStateObservationV1,
  type BehavioralSignalObservationV1,
  type ResearchIntelligenceObservationV1,
} from "./types.js";

function envelope() {
  return {
    schemaVersion: "v1" as const,
    provider: "hubspot",
    sourceRecordId: "57634473634",
    observedAt: null,
    importedAt: "2026-08-20T10:00:00Z",
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
}

function firmographicFact(): FirmographicFactObservationV1 {
  return {
    ...envelope(),
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    rawValue: "CAPITAL_MARKETS",
    normalizedValue: null,
  };
}

function crmState(): CrmStateObservationV1 {
  return {
    ...envelope(),
    observationClass: "crm_state",
    canonicalField: "crm.lifecycleStage",
    rawValue: "lead",
    normalizedValue: null,
  };
}

function identityObservation(): IdentityObservationV1 {
  return {
    ...envelope(),
    observationClass: "identity",
    subjectType: "account",
    identityKey: "domain",
    identityValue: "acme.com",
  };
}

function behavioralSignal(): BehavioralSignalObservationV1 {
  return {
    ...envelope(),
    observedAt: "2026-08-20T09:55:00Z",
    observationClass: "behavioral_signal",
    eventType: "page_view",
    rawValue: { pageUrl: "https://acme.com/pricing" },
    normalizedValue: null,
  };
}

function researchIntelligence(): ResearchIntelligenceObservationV1 {
  return {
    ...envelope(),
    observationClass: "research_intelligence",
    findingType: "company_summary",
    rawValue: { summary: "Acme is expanding into EMEA." },
    normalizedValue: null,
    evidenceRefs: [{ type: "client_radar_evidence_item", ref: "ev-123" }],
  };
}

test("a minimal firmographic_fact observation parses successfully", () => {
  const parsed = ProviderObservationV1Schema.parse(firmographicFact());
  assert.equal(parsed.observationClass, "firmographic_fact");
});

test("a minimal crm_state observation parses successfully", () => {
  const parsed = ProviderObservationV1Schema.parse(crmState());
  assert.equal(parsed.observationClass, "crm_state");
});

test("a minimal identity observation parses successfully", () => {
  const parsed = ProviderObservationV1Schema.parse(identityObservation());
  assert.equal(parsed.observationClass, "identity");
});

test("a minimal behavioral_signal observation parses successfully", () => {
  const parsed = ProviderObservationV1Schema.parse(behavioralSignal());
  assert.equal(parsed.observationClass, "behavioral_signal");
});

test("a minimal research_intelligence observation (with evidence) parses successfully", () => {
  const parsed = ProviderObservationV1Schema.parse(researchIntelligence());
  assert.equal(parsed.observationClass, "research_intelligence");
});

test("observedAt may be null (e.g. HubSpot property observations, per 3A.5)", () => {
  const parsed = ProviderObservationV1Schema.parse(firmographicFact());
  assert.equal(parsed.observedAt, null);
});

test("importedAt is required", () => {
  const input = { ...firmographicFact(), importedAt: undefined };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("confidence accepts low/medium/high or null, never a numeric score", () => {
  assert.equal(
    ProviderObservationV1Schema.parse({ ...firmographicFact(), confidence: "high" })
      .confidence,
    "high",
  );
  assert.throws(() =>
    ProviderObservationV1Schema.parse({ ...firmographicFact(), confidence: 0.9 }),
  );
});

test("research_intelligence requires at least one evidenceRef", () => {
  const input = { ...researchIntelligence(), evidenceRefs: [] };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("firmographic_fact requires a canonicalField", () => {
  const input = { ...firmographicFact(), canonicalField: "" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("firmographic_fact canonicalField is closed to FirmographicCanonicalFieldV1 — an unrecognized field name is rejected", () => {
  const input = { ...firmographicFact(), canonicalField: "company.foundedYear" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("firmographic_fact canonicalField rejects company.domain/company.name — those are identity, not a firmographic fact", () => {
  assert.throws(() =>
    ProviderObservationV1Schema.parse({ ...firmographicFact(), canonicalField: "company.domain" }),
  );
  assert.throws(() =>
    ProviderObservationV1Schema.parse({ ...firmographicFact(), canonicalField: "company.name" }),
  );
});

test("crm_state canonicalField is closed to CrmCanonicalFieldV1 — an unrecognized field name is rejected", () => {
  const input = { ...crmState(), canonicalField: "crm.dealStage" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("crm_state canonicalField rejects the retired provider-prefixed name crm.hubspotOwner — the approved vocabulary uses crm.owner instead", () => {
  const input = { ...crmState(), canonicalField: "crm.hubspotOwner" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("crm_state canonicalField rejects a provider record id — that belongs to the identity class instead", () => {
  const input = { ...crmState(), canonicalField: "crm.contactId" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("every CrmCanonicalFieldV1 value parses successfully", () => {
  const fields = [
    "crm.owner",
    "crm.lifecycleStage",
    "crm.openOpportunity",
    "crm.existingCustomer",
    "crm.competitorFlag",
    "crm.partnerFlag",
  ] as const;
  for (const canonicalField of fields) {
    const parsed = ProviderObservationV1Schema.parse({ ...crmState(), canonicalField });
    assert.equal(parsed.observationClass === "crm_state" && parsed.canonicalField, canonicalField);
  }
});

test("identityKey is closed to IdentityKeyV1 — an unrecognized identity key is rejected", () => {
  const input = { ...identityObservation(), identityKey: "email" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("identityKey \"domain\" is valid only when subjectType is \"account\"", () => {
  assert.throws(() =>
    ProviderObservationV1Schema.parse({
      ...identityObservation(),
      subjectType: "person",
      identityKey: "domain",
      identityValue: "acme.com",
    }),
  );
  const parsed = ProviderObservationV1Schema.parse({
    ...identityObservation(),
    subjectType: "account",
    identityKey: "domain",
  });
  assert.equal(parsed.observationClass, "identity");
});

test("identityKey \"external_id\" is valid for either subjectType", () => {
  const forAccount = ProviderObservationV1Schema.parse({
    ...identityObservation(),
    subjectType: "account",
    identityKey: "external_id",
    identityValue: "57634473634",
  });
  const forPerson = ProviderObservationV1Schema.parse({
    ...identityObservation(),
    subjectType: "person",
    identityKey: "external_id",
    identityValue: "contact-42",
  });
  assert.equal(forAccount.observationClass, "identity");
  assert.equal(forPerson.observationClass, "identity");
});

test("firmographic_fact cannot carry a behavioral field (eventType) — branches don't share unrelated keys", () => {
  const input = { ...firmographicFact(), eventType: "page_view" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("research_intelligence has no canonicalField at all (not merely null)", () => {
  const input = { ...researchIntelligence(), canonicalField: "company.industry" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("behavioral_signal has no canonicalField at all", () => {
  const input = { ...behavioralSignal(), canonicalField: "company.industry" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("an unknown observationClass is rejected", () => {
  const input = { ...firmographicFact(), observationClass: "made_up_class" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("provider is an open string — an unrecognized provider name is accepted", () => {
  const parsed = ProviderObservationV1Schema.parse({
    ...behavioralSignal(),
    provider: "rb2b",
  });
  assert.equal(parsed.provider, "rb2b");
});

test("unrestricted arbitrary top-level fields are rejected", () => {
  const input = { ...firmographicFact(), extraField: "not allowed" };
  assert.throws(() => ProviderObservationV1Schema.parse(input));
});

test("providerMetadata is a free-form, nullable escape hatch", () => {
  const parsed = ProviderObservationV1Schema.parse({
    ...firmographicFact(),
    providerMetadata: { hubspotPropertySource: "CALCULATED" },
  });
  assert.deepEqual(parsed.providerMetadata, {
    hubspotPropertySource: "CALCULATED",
  });
});
