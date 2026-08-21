// M3.5 real-data defect fix — regression coverage for the double
// JSON-parse defect this package's ./pgJsonTypeParsers.ts fixes (see
// that file's comment for the full root-cause explanation).
//
// Without the fix, node-postgres's own default jsonb type parser
// already turns raw column text into a JS value, and drizzle-orm's
// PgJsonb.mapFromDriverValue then re-parses any string result via
// JSON.parse a second time — silently turning a numeric-looking
// *string* raw_value (e.g. a HubSpot owner id, "999") into a *number*.
// This directly reproduces that failure mode against a real Postgres
// instance (not a mock), because the defect only exists in the
// driver/ORM interaction, not in any pure in-process code path.
//
// This file requires DATABASE_URL to point at a Postgres instance with
// migrations already applied. It SKIPS (not fails) when DATABASE_URL is
// absent, same convention as ./schema/integrity.integration.test.ts.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/pgJsonTypeParsers.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function crmStateRow(overrides: Partial<schema.InsertObservation> = {}) {
  return {
    provider: "hubspot",
    sourceRecordId: crypto.randomUUID(),
    observationClass: "crm_state" as const,
    semanticKey: "crm.owner",
    importedAt: new Date(),
    evidenceRefs: [],
    ...overrides,
  };
}

test(
  "a numeric-looking identifier string (crm.owner rawValue) survives a real jsonb round trip as a string, never a number",
  { skip },
  async () => {
    const [inserted] = await db!
      .insert(schema.observations)
      .values(crmStateRow({ rawValue: "999" }))
      .returning();
    assert.ok(inserted);

    const [persisted] = await db!
      .select()
      .from(schema.observations)
      .where(eq(schema.observations.id, inserted!.id))
      .limit(1);

    assert.equal(typeof persisted?.rawValue, "string");
    assert.equal(persisted?.rawValue, "999");
  },
);

test(
  "a plain quantity (company.employeeRange rawValue) survives a real jsonb round trip as the string it was written as",
  { skip },
  async () => {
    const [inserted] = await db!
      .insert(schema.observations)
      .values(
        crmStateRow({
          observationClass: "firmographic_fact",
          semanticKey: "company.employeeRange",
          rawValue: "161",
        }),
      )
      .returning();
    assert.ok(inserted);

    const [persisted] = await db!
      .select()
      .from(schema.observations)
      .where(eq(schema.observations.id, inserted!.id))
      .limit(1);

    // The mapping layer (hubSpotObservationMapping.ts) always emits
    // rawValue as a string for this branch — the jsonb round trip must
    // not silently change that type either way.
    assert.equal(typeof persisted?.rawValue, "string");
    assert.equal(persisted?.rawValue, "161");
  },
);

test(
  "an object (providerMetadata.displayName) survives a real jsonb round trip as an object, unaffected by the string-targeted fix",
  { skip },
  async () => {
    const [inserted] = await db!
      .insert(schema.observations)
      .values(
        crmStateRow({
          rawValue: "999",
          providerMetadata: { displayName: "Mark van der Ree" },
        }),
      )
      .returning();
    assert.ok(inserted);

    const [persisted] = await db!
      .select()
      .from(schema.observations)
      .where(eq(schema.observations.id, inserted!.id))
      .limit(1);

    assert.deepEqual(persisted?.providerMetadata, { displayName: "Mark van der Ree" });
  },
);

test(
  "a real JSON number written as rawValue still round-trips as a number — the fix does not force everything to a string",
  { skip },
  async () => {
    const [inserted] = await db!
      .insert(schema.observations)
      .values(
        crmStateRow({
          observationClass: "research_intelligence",
          semanticKey: "some-finding-type",
          rawValue: 42,
        }),
      )
      .returning();
    assert.ok(inserted);

    const [persisted] = await db!
      .select()
      .from(schema.observations)
      .where(eq(schema.observations.id, inserted!.id))
      .limit(1);

    assert.equal(typeof persisted?.rawValue, "number");
    assert.equal(persisted?.rawValue, 42);
  },
);

test.after(async () => {
  await pool?.end();
});
