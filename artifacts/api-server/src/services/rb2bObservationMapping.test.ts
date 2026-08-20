// Unit tests for ./rb2bObservationMapping.ts — request-shape validation
// and the pure DTO-to-observation mapping. No database, no HTTP.
//
// Run with: tsx --test src/services/rb2bObservationMapping.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { ProviderObservationV1Schema } from "@workspace/observation";
import {
  Rb2bSignalBridgeRequestSchema,
  mapRb2bSignalToObservation,
  type Rb2bSignalBridgeRequest,
} from "./rb2bObservationMapping.js";

function minimalValidBody(): Record<string, unknown> {
  return {
    source: "rb2b",
    signal_type: "visitor_identified",
    source_record_id: "rb2b-evt-abc123",
    ingestion_attempt_at: "2026-08-20T10:00:00Z",
  };
}

test("a minimal valid request (only the four required fields) parses successfully", () => {
  const parsed = Rb2bSignalBridgeRequestSchema.parse(minimalValidBody());
  assert.equal(parsed.source, "rb2b");
  assert.equal(parsed.source_record_id, "rb2b-evt-abc123");
});

test("source must equal exactly \"rb2b\" — anything else is rejected", () => {
  assert.throws(() =>
    Rb2bSignalBridgeRequestSchema.parse({ ...minimalValidBody(), source: "hubspot" }),
  );
  assert.throws(() =>
    Rb2bSignalBridgeRequestSchema.parse({ ...minimalValidBody(), source: "RB2B" }),
  );
});

test("each required field's absence is rejected", () => {
  for (const key of [
    "source",
    "signal_type",
    "source_record_id",
    "ingestion_attempt_at",
  ] as const) {
    const body = minimalValidBody();
    delete body[key];
    assert.throws(
      () => Rb2bSignalBridgeRequestSchema.parse(body),
      `expected rejection when "${key}" is missing`,
    );
  }
});

test("additional, unenumerated normalized context fields are passed through, not rejected", () => {
  const parsed = Rb2bSignalBridgeRequestSchema.parse({
    ...minimalValidBody(),
    some_future_icp01_field: "not yet enumerated here",
  });
  assert.equal((parsed as Record<string, unknown>).some_future_icp01_field, "not yet enumerated here");
});

function validRequest(
  overrides: Partial<Rb2bSignalBridgeRequest> = {},
): Rb2bSignalBridgeRequest {
  return Rb2bSignalBridgeRequestSchema.parse({
    ...minimalValidBody(),
    ...overrides,
  });
}

test("mapRb2bSignalToObservation maps exactly per the approved contract", () => {
  const dto = validRequest({
    company_domain: "acme.com",
    contact_email: "jane@acme.com",
    page_visited: "https://druidai.com/pricing",
  });
  const observation = mapRb2bSignalToObservation(dto);

  assert.equal(observation.provider, "rb2b");
  assert.equal(observation.observationClass, "behavioral_signal");
  assert.equal(observation.eventType, "visitor_identified");
  assert.equal(observation.sourceRecordId, "rb2b-evt-abc123");
  assert.equal(observation.observedAt, null);
  assert.equal(observation.importedAt, "2026-08-20T10:00:00Z");
  assert.equal(observation.normalizedValue, null);
  assert.equal(observation.confidence, null);
  assert.deepEqual(observation.evidenceRefs, []);
  assert.equal(observation.providerMetadata, null);
  // rawValue is the COMPLETE validated inbound DTO — nothing stripped,
  // including the control fields themselves.
  assert.deepEqual(observation.rawValue, dto);
});

test("observedAt maps from provider_observed_at when present, null when omitted", () => {
  const withTimestamp = mapRb2bSignalToObservation(
    validRequest({ provider_observed_at: "2026-08-20T09:55:00Z" }),
  );
  assert.equal(withTimestamp.observedAt, "2026-08-20T09:55:00Z");

  const without = mapRb2bSignalToObservation(validRequest());
  assert.equal(without.observedAt, null);
});

test("the mapped candidate satisfies ProviderObservationV1Schema for a valid request", () => {
  const observation = mapRb2bSignalToObservation(validRequest());
  const parsed = ProviderObservationV1Schema.safeParse(observation);
  assert.equal(parsed.success, true);
});

test("an invalid ingestion_attempt_at (not a real timestamp) fails ProviderObservationV1Schema validation, not silently accepted", () => {
  const observation = mapRb2bSignalToObservation(
    validRequest({ ingestion_attempt_at: "not-a-timestamp" }),
  );
  const parsed = ProviderObservationV1Schema.safeParse(observation);
  assert.equal(parsed.success, false);
});

test("an invalid provider_observed_at (not a real timestamp) fails ProviderObservationV1Schema validation", () => {
  const observation = mapRb2bSignalToObservation(
    validRequest({ provider_observed_at: "not-a-timestamp" }),
  );
  const parsed = ProviderObservationV1Schema.safeParse(observation);
  assert.equal(parsed.success, false);
});

test("a request with no identity/context fields at all (unresolved identity) still maps to a valid observation", () => {
  const observation = mapRb2bSignalToObservation(validRequest());
  const parsed = ProviderObservationV1Schema.safeParse(observation);
  assert.equal(parsed.success, true);
});
