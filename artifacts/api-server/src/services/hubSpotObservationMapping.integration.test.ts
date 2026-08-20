// Integration tests for the HubSpot observation mapping + recordObservation()
// end to end — real, migrated Postgres instance: real db, real
// triggers/constraints, real recordObservation() (Milestone 3D). Mirrors
// ./rb2bObservationMapping.integration.test.ts's exact structure.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/hubSpotObservationMapping.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import type { HubSpotCompany } from "../lib/hubSpotClient.js";
import { recordObservation } from "./observations.js";
import { mapHubSpotCompanyToObservations } from "./hubSpotObservationMapping.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function company(overrides: Partial<HubSpotCompany> = {}): HubSpotCompany {
  return {
    id: crypto.randomUUID(),
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

async function recordAll(observations: ReturnType<typeof mapHubSpotCompanyToObservations>) {
  const results = [];
  for (const observation of observations) {
    results.push(await recordObservation({ db: db!, observation }));
  }
  return results;
}

test(
  "every mapped observation for a fully-populated company persists as created",
  { skip },
  async () => {
    const c = company({
      industry: "CAPITAL_MARKETS",
      country: "United States",
      numberOfEmployees: "125",
      annualRevenue: "50000000",
      lifecycleStage: "customer",
      hubspotOwnerId: "999",
    });
    const observations = mapHubSpotCompanyToObservations({
      company: c,
      importedAt: new Date().toISOString(),
    });
    const results = await recordAll(observations);
    assert.equal(results.length, observations.length);
    assert.ok(results.every((r) => r.outcome === "created"));
  },
);

test(
  "re-recording the identical set (same importedAt) returns duplicate for every observation, no extra rows",
  { skip },
  async () => {
    const c = company({ industry: "CAPITAL_MARKETS" });
    const importedAt = new Date().toISOString();
    const observations = mapHubSpotCompanyToObservations({ company: c, importedAt });

    const first = await recordAll(observations);
    const second = await recordAll(observations);

    assert.ok(first.every((r) => r.outcome === "created"));
    assert.ok(second.every((r) => r.outcome === "duplicate"));
  },
);

test(
  "a later sync (new importedAt) of the same company creates new occurrence rows, not duplicates",
  { skip },
  async () => {
    const c = company({ industry: "CAPITAL_MARKETS" });
    const first = await recordAll(
      mapHubSpotCompanyToObservations({
        company: c,
        importedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const second = await recordAll(
      mapHubSpotCompanyToObservations({ company: c, importedAt: new Date().toISOString() }),
    );

    assert.ok(first.every((r) => r.outcome === "created"));
    assert.ok(second.every((r) => r.outcome === "created"));
    if (first[0]?.outcome === "created" && second[0]?.outcome === "created") {
      assert.notEqual(first[0].observation.id, second[0].observation.id);
    }
  },
);

test.after(async () => {
  await pool?.end();
});
