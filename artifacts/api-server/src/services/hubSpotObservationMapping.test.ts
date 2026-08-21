// Unit tests for ./hubSpotObservationMapping.ts — pure mapping only. No
// database, no HTTP.
//
// Run with: tsx --test src/services/hubSpotObservationMapping.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { ProviderObservationV1Schema } from "@workspace/observation";
import type { HubSpotCompany } from "../lib/hubSpotClient.js";
import { mapHubSpotCompanyToObservations } from "./hubSpotObservationMapping.js";

function minimalCompany(overrides: Partial<HubSpotCompany> = {}): HubSpotCompany {
  return {
    id: "57634473634",
    domain: "acme.com",
    name: "Acme",
    industry: null,
    country: null,
    numberOfEmployees: null,
    annualRevenue: null,
    lifecycleStage: null,
    hubspotOwnerId: null,
    ...overrides,
  };
}

function byClassAndKey(
  observations: ReturnType<typeof mapHubSpotCompanyToObservations>,
  observationClass: string,
  key: string,
) {
  return observations.find((o) => {
    if (o.observationClass !== observationClass) return false;
    if (o.observationClass === "identity") return o.identityKey === key;
    if (o.observationClass === "firmographic_fact" || o.observationClass === "crm_state") {
      return o.canonicalField === key;
    }
    return false;
  });
}

// ---------------------------------------------------------------------
// 1. Identity/domain mapping
// ---------------------------------------------------------------------

test("always emits domain and external_id identity observations, account-scoped", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany(),
    importedAt: "2026-08-20T10:00:00Z",
  });

  const domain = byClassAndKey(observations, "identity", "domain");
  assert.ok(domain);
  assert.equal(domain?.observationClass, "identity");
  if (domain?.observationClass === "identity") {
    assert.equal(domain.subjectType, "account");
    assert.equal(domain.identityValue, "acme.com");
  }

  const externalId = byClassAndKey(observations, "identity", "external_id");
  assert.ok(externalId);
  if (externalId?.observationClass === "identity") {
    assert.equal(externalId.subjectType, "account");
    assert.equal(externalId.identityValue, "57634473634");
  }
});

// ---------------------------------------------------------------------
// 2. Firmographic mapping
// ---------------------------------------------------------------------

test("maps industry/country/employeeRange/revenueRange when present", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({
      industry: "CAPITAL_MARKETS",
      country: "United States",
      numberOfEmployees: "125",
      annualRevenue: "50000000",
    }),
    importedAt: "2026-08-20T10:00:00Z",
  });

  const industry = byClassAndKey(observations, "firmographic_fact", "company.industry");
  const country = byClassAndKey(observations, "firmographic_fact", "company.country");
  const employeeRange = byClassAndKey(observations, "firmographic_fact", "company.employeeRange");
  const revenueRange = byClassAndKey(observations, "firmographic_fact", "company.revenueRange");

  assert.equal(industry?.observationClass === "firmographic_fact" && industry.rawValue, "CAPITAL_MARKETS");
  assert.equal(country?.observationClass === "firmographic_fact" && country.rawValue, "United States");
  assert.equal(employeeRange?.observationClass === "firmographic_fact" && employeeRange.rawValue, "125");
  assert.equal(revenueRange?.observationClass === "firmographic_fact" && revenueRange.rawValue, "50000000");
});

test("never emits company.region — no native HubSpot property for it", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ country: "United States" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(byClassAndKey(observations, "firmographic_fact", "company.region"), undefined);
});

// ---------------------------------------------------------------------
// 3. CRM lifecycle/owner mapping
// ---------------------------------------------------------------------

test("maps crm.owner from hubspotOwnerId when present", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ hubspotOwnerId: "999" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  const owner = byClassAndKey(observations, "crm_state", "crm.owner");
  assert.equal(owner?.observationClass === "crm_state" && owner.rawValue, "999");
});

// M3.5 real-data defect fix: canonical crm.owner stays the stable
// HubSpot owner id; a caller-resolved human display name (see
// ../services/hubSpotCompanySync.ts, the only real caller) rides along
// in providerMetadata only, never replacing rawValue.
test("crm.owner's rawValue stays the stable owner id even when a resolved ownerDisplayName is supplied; the name lands only in providerMetadata", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ hubspotOwnerId: "999" }),
    importedAt: "2026-08-20T10:00:00Z",
    ownerDisplayName: "Mark van der Ree",
  });
  const owner = byClassAndKey(observations, "crm_state", "crm.owner");
  assert.equal(owner?.observationClass === "crm_state" && owner.rawValue, "999");
  assert.deepEqual(
    owner?.observationClass === "crm_state" ? owner.providerMetadata : undefined,
    { displayName: "Mark van der Ree" },
  );
});

test("crm.owner's providerMetadata is null when no ownerDisplayName was resolved", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ hubspotOwnerId: "999" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  const owner = byClassAndKey(observations, "crm_state", "crm.owner");
  assert.equal(
    owner?.observationClass === "crm_state" ? owner.providerMetadata : undefined,
    null,
  );
});

test("an ownerDisplayName with no hubspotOwnerId never produces a crm.owner observation at all", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ hubspotOwnerId: null }),
    importedAt: "2026-08-20T10:00:00Z",
    ownerDisplayName: "Mark van der Ree",
  });
  assert.equal(byClassAndKey(observations, "crm_state", "crm.owner"), undefined);
});

test("lifecycleStage \"customer\" emits crm.lifecycleStage and crm.existingCustomer=true", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ lifecycleStage: "customer" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  const lifecycle = byClassAndKey(observations, "crm_state", "crm.lifecycleStage");
  const existingCustomer = byClassAndKey(observations, "crm_state", "crm.existingCustomer");
  assert.equal(lifecycle?.observationClass === "crm_state" && lifecycle.rawValue, "customer");
  assert.ok(existingCustomer);
  assert.equal(
    existingCustomer?.observationClass === "crm_state" && existingCustomer.rawValue,
    "customer",
  );
  assert.equal(
    existingCustomer?.observationClass === "crm_state" && existingCustomer.normalizedValue,
    true,
  );
});

test("lifecycleStage \"lead\" emits crm.lifecycleStage but does NOT emit crm.existingCustomer — never a guessed false", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ lifecycleStage: "lead" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  const lifecycle = byClassAndKey(observations, "crm_state", "crm.lifecycleStage");
  assert.equal(lifecycle?.observationClass === "crm_state" && lifecycle.rawValue, "lead");
  assert.equal(byClassAndKey(observations, "crm_state", "crm.existingCustomer"), undefined);
});

// ---------------------------------------------------------------------
// 4. Open opportunity — unsupported in this slice (no Deals API fetch)
// ---------------------------------------------------------------------

test("never emits crm.openOpportunity — the current client does not fetch HubSpot deals", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ lifecycleStage: "customer", hubspotOwnerId: "999" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(byClassAndKey(observations, "crm_state", "crm.openOpportunity"), undefined);
});

// ---------------------------------------------------------------------
// 5. Absent HubSpot value -> no fake observation
// ---------------------------------------------------------------------

test("a company with every optional field null emits only the two identity observations", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observations.length, 2);
  assert.ok(observations.every((o) => o.observationClass === "identity"));
});

// ---------------------------------------------------------------------
// 6. importedAt preserved across all observations from one call
// ---------------------------------------------------------------------

test("every observation from one call shares the exact same importedAt", () => {
  const importedAt = "2026-08-20T10:00:00Z";
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({
      industry: "CAPITAL_MARKETS",
      lifecycleStage: "lead",
      hubspotOwnerId: "999",
    }),
    importedAt,
  });
  assert.ok(observations.length > 2);
  assert.ok(observations.every((o) => o.importedAt === importedAt));
});

// ---------------------------------------------------------------------
// 7. Deterministic provider/sourceRecordId/semanticKey
// ---------------------------------------------------------------------

test("provider is always \"hubspot\" and sourceRecordId is always the HubSpot company id, never a Mission Control id", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ id: "57634473634", industry: "CAPITAL_MARKETS" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.ok(observations.every((o) => o.provider === "hubspot"));
  assert.ok(observations.every((o) => o.sourceRecordId === "57634473634"));
});

test("mapping the same company twice produces structurally identical observations (deterministic, no randomness)", () => {
  const args = {
    company: minimalCompany({ industry: "CAPITAL_MARKETS", hubspotOwnerId: "999" }),
    importedAt: "2026-08-20T10:00:00Z",
  };
  assert.deepEqual(mapHubSpotCompanyToObservations(args), mapHubSpotCompanyToObservations(args));
});

// ---------------------------------------------------------------------
// 8. Unsupported/ambiguous CRM states are never guessed
// ---------------------------------------------------------------------

test("never emits crm.competitorFlag or crm.partnerFlag — no verified trustworthy HubSpot property for this tenant", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({ lifecycleStage: "customer" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(byClassAndKey(observations, "crm_state", "crm.competitorFlag"), undefined);
  assert.equal(byClassAndKey(observations, "crm_state", "crm.partnerFlag"), undefined);
});

// ---------------------------------------------------------------------
// Every emitted observation satisfies the canonical contract
// ---------------------------------------------------------------------

test("every observation this module produces satisfies ProviderObservationV1Schema", () => {
  const observations = mapHubSpotCompanyToObservations({
    company: minimalCompany({
      industry: "CAPITAL_MARKETS",
      country: "United States",
      numberOfEmployees: "125",
      annualRevenue: "50000000",
      lifecycleStage: "customer",
      hubspotOwnerId: "999",
    }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  for (const observation of observations) {
    const parsed = ProviderObservationV1Schema.safeParse(observation);
    assert.equal(parsed.success, true, JSON.stringify(parsed.success ? null : parsed.error));
  }
});
