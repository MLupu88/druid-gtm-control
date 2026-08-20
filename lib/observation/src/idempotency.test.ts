// Unit tests for computeObservationIdentityKey — the documented,
// not-yet-persisted derivation of "the same observation, ingested again."
//
// Run with: tsx --test lib/observation/src/idempotency.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeObservationIdentityKey,
  getObservationSemanticKey,
} from "./idempotency.js";
import type {
  FirmographicFactObservationV1,
  CrmStateObservationV1,
  BehavioralSignalObservationV1,
  IdentityObservationV1,
  ResearchIntelligenceObservationV1,
} from "./types.js";

function hubspotCompanyIndustry(): FirmographicFactObservationV1 {
  return {
    schemaVersion: "v1",
    provider: "hubspot",
    sourceRecordId: "57634473634",
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    rawValue: "CAPITAL_MARKETS",
    normalizedValue: null,
    observedAt: null,
    importedAt: "2026-08-20T10:00:00Z",
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
}

test("getObservationSemanticKey returns the right per-class component (Milestone 3D persistence needs this as its own column)", () => {
  const identity: IdentityObservationV1 = {
    schemaVersion: "v1",
    provider: "hubspot",
    sourceRecordId: "57634473634",
    observationClass: "identity",
    subjectType: "account",
    identityKey: "domain",
    identityValue: "acme.com",
    observedAt: null,
    importedAt: "2026-08-20T10:00:00Z",
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
  const research: ResearchIntelligenceObservationV1 = {
    schemaVersion: "v1",
    provider: "client_radar",
    sourceRecordId: "run-1",
    observationClass: "research_intelligence",
    findingType: "company_summary",
    rawValue: { summary: "..." },
    normalizedValue: null,
    observedAt: null,
    importedAt: "2026-08-20T10:00:00Z",
    confidence: null,
    evidenceRefs: [{ type: "client_radar_evidence_item", ref: "ev-1" }],
    providerMetadata: null,
  };

  assert.equal(getObservationSemanticKey(identity), "domain");
  assert.equal(getObservationSemanticKey(hubspotCompanyIndustry()), "company.industry");
  assert.equal(getObservationSemanticKey(research), "company_summary");
});

test("two firmographic observations from the SAME HubSpot company record but different fields get different identity keys", () => {
  const industry = hubspotCompanyIndustry();
  const country: FirmographicFactObservationV1 = {
    ...industry,
    canonicalField: "company.country",
    rawValue: "United States",
  };

  assert.notEqual(
    computeObservationIdentityKey(industry),
    computeObservationIdentityKey(country),
  );
});

test("re-ingesting the identical observation produces the identical identity key", () => {
  const first = hubspotCompanyIndustry();
  const second = { ...hubspotCompanyIndustry(), importedAt: "2026-08-21T00:00:00Z" };

  // importedAt is deliberately excluded from the identity key — re-ingestion
  // at a later time is still "the same observation," not a new one.
  assert.equal(
    computeObservationIdentityKey(first),
    computeObservationIdentityKey(second),
  );
});

test("the same sourceRecordId under a different observationClass (crm_state vs firmographic_fact) gets a different key", () => {
  const firmographic = hubspotCompanyIndustry();
  const crm: CrmStateObservationV1 = {
    ...firmographic,
    observationClass: "crm_state",
    canonicalField: "crm.lifecycleStage",
    rawValue: "lead",
  };

  assert.notEqual(
    computeObservationIdentityKey(firmographic),
    computeObservationIdentityKey(crm),
  );
});

test("the same field name from two different providers gets a different key", () => {
  const hubspotIndustry = hubspotCompanyIndustry();
  const otherProviderIndustry: FirmographicFactObservationV1 = {
    ...hubspotIndustry,
    provider: "dealfront",
    sourceRecordId: "df-9001",
  };

  assert.notEqual(
    computeObservationIdentityKey(hubspotIndustry),
    computeObservationIdentityKey(otherProviderIndustry),
  );
});

test("two page_view events from the SAME subject get different keys when sourceRecordId is the per-event id, not the subject id (correct adapter usage)", () => {
  const base: BehavioralSignalObservationV1 = {
    schemaVersion: "v1",
    provider: "hubspot",
    // sourceRecordId is the individual event record — NOT the contact id
    // both events actually belong to. This is the required, correct
    // pattern (see types.ts's sourceRecordId invariant).
    sourceRecordId: "hs-page-view-evt-0001",
    observationClass: "behavioral_signal",
    eventType: "page_view",
    rawValue: { pageUrl: "https://druidai.com/pricing", contactId: "contact-42" },
    normalizedValue: null,
    observedAt: "2026-08-20T09:00:00Z",
    importedAt: "2026-08-20T09:01:00Z",
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
  const secondPageView: BehavioralSignalObservationV1 = {
    ...base,
    sourceRecordId: "hs-page-view-evt-0002",
    rawValue: { pageUrl: "https://druidai.com/product", contactId: "contact-42" },
    observedAt: "2026-08-20T09:05:00Z",
  };

  assert.notEqual(
    computeObservationIdentityKey(base),
    computeObservationIdentityKey(secondPageView),
  );
});

test("misuse warning: reusing a SUBJECT id (e.g. a contact id) as sourceRecordId for two distinct same-eventType events incorrectly collapses them to one key", () => {
  // This test documents a known limitation, not a guarantee: the contract
  // cannot detect this misuse structurally (see idempotency.ts's module
  // comment and types.ts's sourceRecordId invariant). It exists so a
  // future reader/adapter author sees the failure mode demonstrated, not
  // just asserted in a comment.
  const contactId = "contact-42";
  const firstPageView: BehavioralSignalObservationV1 = {
    schemaVersion: "v1",
    provider: "hubspot",
    sourceRecordId: contactId, // MISUSE: subject id, not an event id
    observationClass: "behavioral_signal",
    eventType: "page_view",
    rawValue: { pageUrl: "https://druidai.com/pricing" },
    normalizedValue: null,
    observedAt: "2026-08-20T09:00:00Z",
    importedAt: "2026-08-20T09:01:00Z",
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
  const secondPageView: BehavioralSignalObservationV1 = {
    ...firstPageView,
    rawValue: { pageUrl: "https://druidai.com/product" },
    observedAt: "2026-08-20T09:05:00Z",
  };

  assert.equal(
    computeObservationIdentityKey(firstPageView),
    computeObservationIdentityKey(secondPageView),
  );
});

test("two distinct RB2B behavioral events (same provider) key on eventType, not just sourceRecordId", () => {
  const pageView: BehavioralSignalObservationV1 = {
    schemaVersion: "v1",
    provider: "rb2b",
    sourceRecordId: "rb2b-visit-8891",
    observationClass: "behavioral_signal",
    eventType: "page_view",
    rawValue: { pageUrl: "https://druidai.com/pricing" },
    normalizedValue: null,
    observedAt: "2026-08-20T09:00:00Z",
    importedAt: "2026-08-20T09:01:00Z",
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  };
  const companyIdentified: BehavioralSignalObservationV1 = {
    ...pageView,
    eventType: "company_identified",
  };

  assert.notEqual(
    computeObservationIdentityKey(pageView),
    computeObservationIdentityKey(companyIdentified),
  );
});
