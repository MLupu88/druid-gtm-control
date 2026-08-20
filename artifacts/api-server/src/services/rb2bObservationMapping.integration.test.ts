// Integration tests for the RB2B bridge mapping + recordObservation() end
// to end — exercised against a real, migrated Postgres instance: real db,
// real triggers/constraints, real recordObservation() (Milestone 3D).
// Mirrors ./observations.integration.test.ts's exact structure and
// conventions.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset.
//
// This deliberately does not go through the HTTP route — the route's own
// request-parsing/auth wiring is covered by rb2bObservationMapping.test.ts
// (pure) and by inspection against the already-tested requireServiceAuth
// middleware (see ../routes/signals.route.test.ts). What only a real
// database can prove is the duplicate/new-occurrence classification this
// bridge's mapping produces once persisted — that is this file's sole
// purpose.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/rb2bObservationMapping.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { recordObservation } from "./observations.js";
import {
  Rb2bSignalBridgeRequestSchema,
  mapRb2bSignalToObservation,
} from "./rb2bObservationMapping.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    source: "rb2b",
    signal_type: "visitor_identified",
    source_record_id: crypto.randomUUID(),
    ingestion_attempt_at: new Date().toISOString(),
    ...overrides,
  };
}

async function ingest(body: Record<string, unknown>) {
  const parsedRequest = Rb2bSignalBridgeRequestSchema.parse(body);
  const observation = mapRb2bSignalToObservation(parsedRequest);
  return recordObservation({ db: db!, observation });
}

test("a valid RB2B signal persists as a created behavioral_signal observation", { skip }, async () => {
  const result = await ingest(requestBody());
  assert.equal(result.outcome, "created");
  if (result.outcome === "created") {
    assert.equal(result.observation.observationClass, "behavioral_signal");
    assert.equal(result.observation.provider, "rb2b");
  }
});

test(
  "same source_record_id + same ingestion_attempt_at => duplicate, no second row",
  { skip },
  async () => {
    const body = requestBody();
    const first = await ingest(body);
    const second = await ingest(body);

    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "duplicate");
    if (first.outcome === "created" && second.outcome === "duplicate") {
      assert.equal(second.observation.id, first.observation.id);
    }
  },
);

test(
  "same source_record_id + NEW ingestion_attempt_at => a new immutable occurrence",
  { skip },
  async () => {
    const sourceRecordId = crypto.randomUUID();
    const first = await ingest(
      requestBody({
        source_record_id: sourceRecordId,
        ingestion_attempt_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    const second = await ingest(
      requestBody({
        source_record_id: sourceRecordId,
        ingestion_attempt_at: new Date().toISOString(),
      }),
    );

    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "created");
    if (first.outcome === "created" && second.outcome === "created") {
      assert.notEqual(first.observation.id, second.observation.id);
      assert.equal(first.observation.sourceRecordId, second.observation.sourceRecordId);
    }
  },
);

test("a different source_record_id produces a new occurrence", { skip }, async () => {
  const first = await ingest(requestBody());
  const second = await ingest(requestBody());

  assert.equal(first.outcome, "created");
  assert.equal(second.outcome, "created");
  if (first.outcome === "created" && second.outcome === "created") {
    assert.notEqual(first.observation.sourceRecordId, second.observation.sourceRecordId);
    assert.notEqual(first.observation.id, second.observation.id);
  }
});

test(
  "a signal with no identity/company context at all (unresolved identity) still persists",
  { skip },
  async () => {
    // No company_domain, contact_email, resolution_level, etc. — deliberately
    // proves persistence is never gated on identity resolution.
    const result = await ingest(requestBody());
    assert.equal(result.outcome, "created");
  },
);

test.after(async () => {
  await pool?.end();
});
