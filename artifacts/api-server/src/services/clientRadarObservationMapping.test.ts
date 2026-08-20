// Unit tests for ./clientRadarObservationMapping.ts — pure mapping only.
// No database, no HTTP.
//
// Run with: tsx --test src/services/clientRadarObservationMapping.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { ProviderObservationV1Schema } from "@workspace/observation";
import type { ClientRadarEvidenceItem } from "../lib/clientRadarClient.js";
import {
  mapClientRadarEvidenceToObservation,
  mapClientRadarEvidenceItemsToObservations,
  type ClientRadarEvidenceContext,
} from "./clientRadarObservationMapping.js";

function evidenceItem(
  overrides: Partial<ClientRadarEvidenceItem> = {},
): ClientRadarEvidenceItem {
  return {
    id: "ev-001",
    source_type: "news_article",
    title: "Acme announces AI initiative",
    url: "https://news.example.com/acme-ai",
    content: "Acme Corp today announced...",
    created_at: "2026-08-15T09:30:00Z",
    ...overrides,
  };
}

function context(overrides: Partial<ClientRadarEvidenceContext> = {}): ClientRadarEvidenceContext {
  return {
    clientRadarAccountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    company: "Acme Corp",
    domain: "acme.com",
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 1/2. Real finding -> research_intelligence, provider always client_radar
// ---------------------------------------------------------------------

test("maps a real evidence item to a research_intelligence observation with provider client_radar", () => {
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem(),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observation.provider, "client_radar");
  assert.equal(observation.observationClass, "research_intelligence");
});

// ---------------------------------------------------------------------
// 3. findingType derived from actual supported source_type
// ---------------------------------------------------------------------

test("findingType is the evidence item's source_type verbatim when present", () => {
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ source_type: "job_posting" }),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observation.findingType, "job_posting");
});

test("findingType falls back to a neutral placeholder when source_type is null or blank — never a fabricated business category", () => {
  const withNull = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ source_type: null }),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  const withBlank = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ source_type: "   " }),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(withNull.findingType, "evidence_item");
  assert.equal(withBlank.findingType, "evidence_item");
});

// ---------------------------------------------------------------------
// 4. Stable sourceRecordId behavior
// ---------------------------------------------------------------------

test("sourceRecordId is always the evidence item's own id, never a Mission Control or Client Radar account id", () => {
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ id: "ev-999" }),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observation.sourceRecordId, "ev-999");
});

test("two different evidence items get two different sourceRecordIds and remain independently addressable", () => {
  const observations = mapClientRadarEvidenceItemsToObservations({
    evidenceItems: [evidenceItem({ id: "ev-001" }), evidenceItem({ id: "ev-002" })],
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observations.length, 2);
  assert.notEqual(observations[0]?.sourceRecordId, observations[1]?.sourceRecordId);
});

// ---------------------------------------------------------------------
// 5. Evidence URL/reference preservation
// ---------------------------------------------------------------------

test("evidenceRefs always includes the item's own id; adds the url ref only when a real url is present", () => {
  const withUrl = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ id: "ev-001", url: "https://example.com/a" }),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.deepEqual(withUrl.evidenceRefs, [
    { type: "client_radar_evidence_item", ref: "ev-001" },
    { type: "client_radar_evidence_url", ref: "https://example.com/a" },
  ]);

  const withoutUrl = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ id: "ev-002", url: null }),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.deepEqual(withoutUrl.evidenceRefs, [
    { type: "client_radar_evidence_item", ref: "ev-002" },
  ]);
});

// ---------------------------------------------------------------------
// 6. Absent optional fields do not create fabricated data
// ---------------------------------------------------------------------

test("a minimal evidence item with every optional field null still maps to a valid observation with no invented URLs/content", () => {
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: {
      id: "ev-003",
      source_type: null,
      title: null,
      url: null,
      content: null,
      created_at: "2026-08-15T09:30:00Z",
    },
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observation.evidenceRefs.length, 1);
  assert.equal(ProviderObservationV1Schema.safeParse(observation).success, true);
});

// ---------------------------------------------------------------------
// 7. observedAt null when no defensible provider timestamp exists
// ---------------------------------------------------------------------

test("observedAt is the parsed created_at when valid", () => {
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ created_at: "2026-08-15T09:30:00.000Z" }),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observation.observedAt, "2026-08-15T09:30:00.000Z");
});

test("observedAt is null when created_at cannot be safely parsed — never fabricates current time", () => {
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ created_at: "not-a-real-date" }),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observation.observedAt, null);
});

// ---------------------------------------------------------------------
// 8. One importedAt reused across all findings in one import attempt
// ---------------------------------------------------------------------

test("every observation from one call shares the exact same importedAt", () => {
  const importedAt = "2026-08-20T10:00:00Z";
  const observations = mapClientRadarEvidenceItemsToObservations({
    evidenceItems: [evidenceItem({ id: "ev-001" }), evidenceItem({ id: "ev-002" }), evidenceItem({ id: "ev-003" })],
    context: context(),
    importedAt,
  });
  assert.equal(observations.length, 3);
  assert.ok(observations.every((o) => o.importedAt === importedAt));
});

// ---------------------------------------------------------------------
// 9. Multiple findings remain separate observations
// ---------------------------------------------------------------------

test("mapping N evidence items produces exactly N observations", () => {
  const observations = mapClientRadarEvidenceItemsToObservations({
    evidenceItems: [evidenceItem({ id: "ev-001" }), evidenceItem({ id: "ev-002" }), evidenceItem({ id: "ev-003" })],
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observations.length, 3);
});

// ---------------------------------------------------------------------
// 10. No Mission Control accountId used as sourceRecordId
// ---------------------------------------------------------------------

test("no Mission Control account id ever appears as sourceRecordId — only Client Radar's own evidence item id", () => {
  const missionControlAccountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem({ id: "ev-001" }),
    context: context({ clientRadarAccountId: "cr-acct-1" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.notEqual(observation.sourceRecordId, missionControlAccountId);
  assert.equal(observation.sourceRecordId, "ev-001");
});

// ---------------------------------------------------------------------
// Context/provenance and full-contract validation
// ---------------------------------------------------------------------

test("providerMetadata carries company/domain/clientRadarAccountId context not present in rawValue", () => {
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem(),
    context: context({ company: "Acme Corp", domain: "acme.com" }),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.deepEqual(observation.providerMetadata, {
    clientRadarAccountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    company: "Acme Corp",
    domain: "acme.com",
  });
});

test("rawValue preserves the complete original evidence item", () => {
  const item = evidenceItem();
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: item,
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.deepEqual(observation.rawValue, item);
});

test("confidence and normalizedValue are null — no fabricated confidence or normalization", () => {
  const observation = mapClientRadarEvidenceToObservation({
    evidenceItem: evidenceItem(),
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  assert.equal(observation.confidence, null);
  assert.equal(observation.normalizedValue, null);
});

test("every observation this module produces satisfies ProviderObservationV1Schema", () => {
  const observations = mapClientRadarEvidenceItemsToObservations({
    evidenceItems: [
      evidenceItem({ id: "ev-001", source_type: "job_posting" }),
      evidenceItem({ id: "ev-002", source_type: null, url: null }),
    ],
    context: context(),
    importedAt: "2026-08-20T10:00:00Z",
  });
  for (const observation of observations) {
    const parsed = ProviderObservationV1Schema.safeParse(observation);
    assert.equal(parsed.success, true, JSON.stringify(parsed.success ? null : parsed.error));
  }
});
