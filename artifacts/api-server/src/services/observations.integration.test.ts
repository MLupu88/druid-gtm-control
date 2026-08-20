// Integration tests for ./observations.ts's recordObservation() —
// exercised end-to-end against a real, migrated Postgres instance: real
// db, real triggers/constraints (lib/db/drizzle/0012_add_observations.sql,
// 0013_observations_immutability.sql), real service — no fakes.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset — mirrors this
// package's other *.integration.test.ts files (see
// ./accountFacts.integration.test.ts).
//
// Isolation comes from crypto.randomUUID()-suffixed sourceRecordId values
// per test, not truncation — observations is insert-only by trigger
// regardless.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/observations.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import type { FirmographicFactObservationV1 } from "@workspace/observation";
import { recordObservation } from "./observations.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function hubspotIndustryObservation(
  overrides: Partial<FirmographicFactObservationV1> = {},
): FirmographicFactObservationV1 {
  return {
    schemaVersion: "v1",
    provider: "hubspot",
    sourceRecordId: crypto.randomUUID(),
    observationClass: "firmographic_fact",
    canonicalField: "company.industry",
    rawValue: "CAPITAL_MARKETS",
    normalizedValue: null,
    observedAt: null,
    importedAt: new Date().toISOString(),
    confidence: "high",
    evidenceRefs: [],
    providerMetadata: null,
    ...overrides,
  };
}

test("recordObservation: first insert returns created", { skip }, async () => {
  const result = await recordObservation({
    db: db!,
    observation: hubspotIndustryObservation(),
  });
  assert.equal(result.outcome, "created");
});

test(
  "recordObservation: exact retry with the SAME importedAt and identical content returns duplicate, no second row",
  { skip },
  async () => {
    const observation = hubspotIndustryObservation();
    const first = await recordObservation({ db: db!, observation });
    assert.equal(first.outcome, "created");

    const second = await recordObservation({ db: db!, observation });
    assert.equal(second.outcome, "duplicate");
    if (second.outcome === "duplicate" && first.outcome === "created") {
      assert.equal(second.observation.id, first.observation.id);
    }
  },
);

test(
  "recordObservation: same occurrence tuple (same importedAt) but CHANGED content returns conflict, never silently accepted",
  { skip },
  async () => {
    const observation = hubspotIndustryObservation();
    const first = await recordObservation({ db: db!, observation });
    assert.equal(first.outcome, "created");

    const conflicting = await recordObservation({
      db: db!,
      observation: { ...observation, rawValue: "TECHNOLOGY" },
    });
    assert.equal(conflicting.outcome, "conflict");
  },
);

test(
  "recordObservation: same semantic identity, NEW importedAt, SAME value -> created (a new row, not a duplicate)",
  { skip },
  async () => {
    const sourceRecordId = crypto.randomUUID();
    const first = await recordObservation({
      db: db!,
      observation: hubspotIndustryObservation({
        sourceRecordId,
        importedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    });
    const second = await recordObservation({
      db: db!,
      observation: hubspotIndustryObservation({
        sourceRecordId,
        importedAt: new Date().toISOString(),
      }),
    });
    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "created");
    if (first.outcome === "created" && second.outcome === "created") {
      assert.notEqual(first.observation.id, second.observation.id);
      assert.equal(first.observation.rawValue, second.observation.rawValue);
    }
  },
);

test(
  "recordObservation: same semantic identity, NEW importedAt, CHANGED value -> created (a new row, not a conflict)",
  { skip },
  async () => {
    const sourceRecordId = crypto.randomUUID();
    const first = await recordObservation({
      db: db!,
      observation: hubspotIndustryObservation({
        sourceRecordId,
        importedAt: new Date(Date.now() - 60_000).toISOString(),
        rawValue: "CAPITAL_MARKETS",
      }),
    });
    const second = await recordObservation({
      db: db!,
      observation: hubspotIndustryObservation({
        sourceRecordId,
        importedAt: new Date().toISOString(),
        rawValue: "TECHNOLOGY",
      }),
    });
    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "created");
    if (first.outcome === "created" && second.outcome === "created") {
      assert.notEqual(first.observation.id, second.observation.id);
      assert.notEqual(first.observation.rawValue, second.observation.rawValue);
    }
  },
);

test(
  "recordObservation: a behavioral_signal occurrence discovered again later may create a new occurrence sharing the same semantic identity",
  { skip },
  async () => {
    const sourceRecordId = crypto.randomUUID();
    const first = await recordObservation({
      db: db!,
      observation: {
        schemaVersion: "v1",
        provider: "rb2b",
        sourceRecordId,
        observationClass: "behavioral_signal",
        eventType: "page_view",
        rawValue: { pageUrl: "https://druidai.com/pricing" },
        normalizedValue: null,
        observedAt: new Date(Date.now() - 60_000).toISOString(),
        importedAt: new Date(Date.now() - 60_000).toISOString(),
        confidence: null,
        evidenceRefs: [],
        providerMetadata: null,
      },
    });
    const second = await recordObservation({
      db: db!,
      observation: {
        schemaVersion: "v1",
        provider: "rb2b",
        sourceRecordId,
        observationClass: "behavioral_signal",
        eventType: "page_view",
        rawValue: { pageUrl: "https://druidai.com/pricing" },
        normalizedValue: null,
        observedAt: new Date().toISOString(),
        importedAt: new Date().toISOString(),
        confidence: null,
        evidenceRefs: [],
        providerMetadata: null,
      },
    });
    // 3D does not count/deduplicate these for business meaning — both are
    // legitimate, distinct occurrences of one semantic identity.
    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "created");
  },
);

test.after(async () => {
  await pool?.end();
});
