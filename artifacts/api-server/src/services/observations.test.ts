// Unit tests for ./observations.ts's pure helpers — toInsertObservation's
// contract-to-column mapping and structurallyEqual. No database.
//
// Run with: tsx --test src/services/observations.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type {
  FirmographicFactObservationV1,
  IdentityObservationV1,
} from "@workspace/observation";
import { structurallyEqual, toInsertObservation } from "./observations.js";

function firmographicObservation(): FirmographicFactObservationV1 {
  return {
    schemaVersion: "v1",
    provider: "HubSpot",
    sourceRecordId: "57634473634",
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    rawValue: "CAPITAL_MARKETS",
    normalizedValue: null,
    observedAt: null,
    importedAt: "2026-08-20T10:00:00Z",
    confidence: "high",
    evidenceRefs: [],
    providerMetadata: null,
  };
}

function identityObservation(): IdentityObservationV1 {
  return {
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
}

test("toInsertObservation canonicalizes provider to lowercase/trimmed", () => {
  const values = toInsertObservation(firmographicObservation());
  assert.equal(values.provider, "hubspot");
});

test("toInsertObservation derives semanticKey via lib/observation's getObservationSemanticKey, not a local switch", () => {
  const values = toInsertObservation(firmographicObservation());
  assert.equal(values.semanticKey, "company.industry");
});

test("toInsertObservation maps a non-identity observation to rawValue/normalizedValue, with both identity columns null", () => {
  const values = toInsertObservation(firmographicObservation());
  assert.equal(values.rawValue, "CAPITAL_MARKETS");
  assert.equal(values.normalizedValue, null);
  assert.equal(values.identitySubjectType, null);
  assert.equal(values.identityValue, null);
});

test("toInsertObservation maps an identity observation to identitySubjectType/identityValue, with both raw/normalized columns null", () => {
  const values = toInsertObservation(identityObservation());
  assert.equal(values.identitySubjectType, "account");
  assert.equal(values.identityValue, "acme.com");
  assert.equal(values.rawValue, null);
  assert.equal(values.normalizedValue, null);
});

test("toInsertObservation passes importedAt through unchanged (never regenerated)", () => {
  const values = toInsertObservation(firmographicObservation());
  assert.equal(values.importedAt.toISOString(), "2026-08-20T10:00:00.000Z");
});

test("structurallyEqual: object key order does not affect equality", () => {
  assert.equal(
    structurallyEqual({ a: 1, b: 2 }, { b: 2, a: 1 }),
    true,
  );
});

test("structurallyEqual: arrays remain order-sensitive", () => {
  assert.equal(structurallyEqual([1, 2], [2, 1]), false);
});

test("structurallyEqual: null and JSON literal null are equal, null and absent are not the concern of this function alone", () => {
  assert.equal(structurallyEqual(null, null), true);
  assert.equal(structurallyEqual("CAPITAL_MARKETS", "TECHNOLOGY"), false);
});
