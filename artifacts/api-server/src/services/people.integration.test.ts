// LS8 — integration tests for ./people.ts against a real, migrated
// Postgres instance: real accounts/people/account_people rows, real
// unique constraints. Proves the People API/read-model reads exclusively
// from the canonical people/account_people tables, never from raw
// observation JSON.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/people.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getAccountPeople, AccountNotFoundError } from "./people.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const RUN_ID = crypto.randomUUID();

async function makeAccount() {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:people-test-${RUN_ID}-${crypto.randomUUID()}.example` })
    .returning();
  return account!;
}

async function makePerson(overrides: Partial<typeof schema.people.$inferInsert> = {}) {
  const [person] = await db!
    .insert(schema.people)
    .values({ fullName: `Test Person ${crypto.randomUUID()}`, ...overrides })
    .returning();
  return person!;
}

test(
  "getAccountPeople throws AccountNotFoundError for an unknown account",
  { skip },
  async () => {
    await assert.rejects(
      () => getAccountPeople(db!, crypto.randomUUID()),
      AccountNotFoundError,
    );
  },
);

test(
  "getAccountPeople returns an empty array (never a placeholder) for an account with no associated people",
  { skip },
  async () => {
    const account = await makeAccount();
    const result = await getAccountPeople(db!, account.id);
    assert.deepEqual(result, []);
  },
);

test(
  "getAccountPeople returns the person's own fields plus this account's relationship-specific title/source, never raw observation JSON",
  { skip },
  async () => {
    const account = await makeAccount();
    const email = `laura-${crypto.randomUUID()}@example.test`;
    const person = await makePerson({ fullName: "Laura Berkey", workEmail: email });
    await db!.insert(schema.accountPeople).values({
      accountId: account.id,
      personId: person.id,
      title: "Associate Software Engineer",
      source: "rb2b",
    });

    const result = await getAccountPeople(db!, account.id);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, person.id);
    assert.equal(result[0]?.fullName, "Laura Berkey");
    assert.equal(result[0]?.workEmail, email);
    assert.equal(result[0]?.title, "Associate Software Engineer");
    assert.equal(result[0]?.source, "rb2b");
    assert.ok(result[0]?.firstSeenAt);
    assert.ok(result[0]?.lastSeenAt);
  },
);

test(
  "getAccountPeople orders multiple people by lastSeenAt descending",
  { skip },
  async () => {
    const account = await makeAccount();
    const older = await makePerson();
    const newer = await makePerson();

    await db!.insert(schema.accountPeople).values({
      accountId: account.id,
      personId: older.id,
      source: "rb2b",
      firstSeenAt: new Date("2026-01-01T00:00:00Z"),
      lastSeenAt: new Date("2026-01-01T00:00:00Z"),
    });
    await db!.insert(schema.accountPeople).values({
      accountId: account.id,
      personId: newer.id,
      source: "rb2b",
      firstSeenAt: new Date("2026-02-01T00:00:00Z"),
      lastSeenAt: new Date("2026-02-01T00:00:00Z"),
    });

    const result = await getAccountPeople(db!, account.id);
    assert.deepEqual(
      result.map((r) => r.id),
      [newer.id, older.id],
    );
  },
);

test.after(async () => {
  await pool?.end();
});
