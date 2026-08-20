// Integration tests for the Client Radar observation mapping +
// recordObservation() end to end — real, migrated Postgres instance: real
// db, real triggers/constraints, real recordObservation() (Milestone 3D).
// Mirrors ./hubSpotObservationMapping.integration.test.ts's exact
// structure.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/clientRadarObservationMapping.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import type { ClientRadarEvidenceItem } from "../lib/clientRadarClient.js";
import { recordObservation } from "./observations.js";
import {
  mapClientRadarEvidenceItemsToObservations,
  type ClientRadarEvidenceContext,
} from "./clientRadarObservationMapping.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function evidenceItem(overrides: Partial<ClientRadarEvidenceItem> = {}): ClientRadarEvidenceItem {
  return {
    id: crypto.randomUUID(),
    source_type: "news_article",
    title: "Acme announces AI initiative",
    url: "https://news.example.com/acme-ai",
    content: "Acme Corp today announced...",
    created_at: "2026-08-15T09:30:00Z",
    ...overrides,
  };
}

const context: ClientRadarEvidenceContext = {
  clientRadarAccountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  company: "Acme Corp",
  domain: "acme.com",
};

async function recordAll(observations: ReturnType<typeof mapClientRadarEvidenceItemsToObservations>) {
  const results = [];
  for (const observation of observations) {
    results.push(await recordObservation({ db: db!, observation }));
  }
  return results;
}

test("each distinct evidence item persists as a separate created research_intelligence observation", { skip }, async () => {
  const items = [evidenceItem(), evidenceItem(), evidenceItem()];
  const observations = mapClientRadarEvidenceItemsToObservations({
    evidenceItems: items,
    context,
    importedAt: new Date().toISOString(),
  });
  const results = await recordAll(observations);
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.outcome === "created"));
});

test("exact retry with the same importedAt returns duplicate, no extra row", { skip }, async () => {
  const item = evidenceItem();
  const importedAt = new Date().toISOString();
  const observations = mapClientRadarEvidenceItemsToObservations({
    evidenceItems: [item],
    context,
    importedAt,
  });

  const first = await recordAll(observations);
  const second = await recordAll(observations);
  assert.equal(first[0]?.outcome, "created");
  assert.equal(second[0]?.outcome, "duplicate");
});

test("a later import attempt (new importedAt) of the same evidence item creates a new immutable occurrence", { skip }, async () => {
  const item = evidenceItem();
  const first = await recordAll(
    mapClientRadarEvidenceItemsToObservations({
      evidenceItems: [item],
      context,
      importedAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  );
  const second = await recordAll(
    mapClientRadarEvidenceItemsToObservations({
      evidenceItems: [item],
      context,
      importedAt: new Date().toISOString(),
    }),
  );

  assert.equal(first[0]?.outcome, "created");
  assert.equal(second[0]?.outcome, "created");
  if (first[0]?.outcome === "created" && second[0]?.outcome === "created") {
    assert.notEqual(first[0].observation.id, second[0].observation.id);
  }
});

test.after(async () => {
  await pool?.end();
});
