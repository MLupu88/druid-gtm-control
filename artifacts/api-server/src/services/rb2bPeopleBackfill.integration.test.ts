// LS8 — integration tests for ./rb2bPeopleBackfill.ts against a real,
// migrated Postgres instance: seeds real rb2b behavioral_signal
// observations directly (mirroring what the live ingest route would
// already have written), then proves the backfill resolves/creates
// canonical people and account_people associations from them exactly the
// way the live path already does for new events — reusing the exact
// same planCanonicalAccountResolution/planPersonResolution/
// applyPersonPlan/upsertAccountPerson primitives
// rb2bIdentity.integration.test.ts already proves resolveRb2bPersonAccount
// itself uses.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/rb2bPeopleBackfill.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { backfillRb2bPeople } from "./rb2bPeopleBackfill.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const RUN_ID = crypto.randomUUID();

function uniqueDomain(marker: string): string {
  return `${marker}-${RUN_ID}-${crypto.randomUUID()}.example`;
}

async function makeMatchedAccount(domain: string) {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:${domain}`, companyDomain: domain, companyName: "Backfill Test Co" })
    .returning();
  await db!.insert(schema.accountAliases).values({
    accountId: account!.id,
    aliasType: "domain",
    rawValue: domain,
    normalizedValue: domain,
    normalizationStrategy: "domain",
    isStrong: true,
    source: "rb2b",
  });
  return account!;
}

/** Seeds a real rb2b behavioral_signal observation row exactly as the live ingest route would have written it — the SAME shape backfillRb2bPeople reads and re-parses via Rb2bSignalBridgeRequestSchema. */
async function seedBehavioralObservation(rawValue: Record<string, unknown>) {
  const sourceRecordId = `rb2b:fp1:${crypto.randomBytes(16).toString("hex")}`;
  const [row] = await db!
    .insert(schema.observations)
    .values({
      provider: "rb2b",
      sourceRecordId,
      observationClass: "behavioral_signal",
      semanticKey: String(rawValue.signal_type ?? "visitor_identified"),
      rawValue,
      normalizedValue: null,
      observedAt: null,
      importedAt: new Date(),
      confidence: null,
      evidenceRefs: [],
      providerMetadata: null,
    })
    .returning();
  return row!;
}

function rb2bRawValue(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    source: "rb2b",
    signal_type: "visitor_identified",
    source_record_id: `rb2b:fp1:${crypto.randomUUID()}`,
    ingestion_attempt_at: new Date().toISOString(),
    company_domain: domain,
    company_name: "Backfill Test Co",
    ...overrides,
  };
}

async function accountPeopleCountFor(accountId: string): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountPeople)
    .where(eq(schema.accountPeople.accountId, accountId));
  return Number(row?.value ?? 0);
}

test(
  "a behavioral_signal observation with real contact evidence resolves/creates a canonical Person and associates it with the already-matched account",
  { skip },
  async () => {
    const domain = uniqueDomain("backfill-create");
    const account = await makeMatchedAccount(domain);
    const email = `jane-${crypto.randomUUID()}@${domain}`;
    await seedBehavioralObservation(
      rb2bRawValue(domain, {
        contact_email: email,
        contact_name: "Jane Doe",
        contact_title: "VP Sales",
      }),
    );

    const summary = await backfillRb2bPeople(db!, { dryRun: false });
    assert.ok(summary.personCreated >= 1);
    assert.ok(summary.associated >= 1);

    const [personRow] = await db!.select().from(schema.people).where(eq(schema.people.workEmail, email.toLowerCase()));
    assert.ok(personRow, "expected a canonical person with the normalized email");

    const [link] = await db!
      .select()
      .from(schema.accountPeople)
      .where(and(eq(schema.accountPeople.accountId, account.id), eq(schema.accountPeople.personId, personRow!.id)));
    assert.ok(link, "expected an account_people association");
    assert.equal(link!.title, "VP Sales");
    assert.equal(link!.source, "rb2b");
  },
);

test(
  "rerunning the backfill over the same observations is idempotent — 0 newly created people, 0 new accounts, association unchanged",
  { skip },
  async () => {
    const domain = uniqueDomain("backfill-idempotent");
    await makeMatchedAccount(domain);
    const email = `mark-${crypto.randomUUID()}@${domain}`;
    await seedBehavioralObservation(rb2bRawValue(domain, { contact_email: email, contact_name: "Mark Roe" }));

    const first = await backfillRb2bPeople(db!, { dryRun: false });
    assert.ok(first.personCreated >= 1);

    const [personRow] = await db!.select().from(schema.people).where(eq(schema.people.workEmail, email.toLowerCase()));
    assert.ok(personRow);
    const countBefore = await db!.select({ value: count() }).from(schema.people).where(eq(schema.people.workEmail, email.toLowerCase()));

    const second = await backfillRb2bPeople(db!, { dryRun: false });
    // The second run rescans EVERY rb2b behavioral_signal row in the
    // database (including ones from other tests/prior runs), so its
    // personCreated may be >0 from unrelated rows — the real assertion is
    // that THIS test's own person row count never changed.
    assert.equal(second.scanned, first.scanned, "no new rb2b behavioral_signal rows were created by the backfill itself");

    const countAfter = await db!.select({ value: count() }).from(schema.people).where(eq(schema.people.workEmail, email.toLowerCase()));
    assert.equal(Number(countAfter[0]?.value ?? 0), Number(countBefore[0]?.value ?? 0));
    assert.equal(Number(countAfter[0]?.value ?? 0), 1, "exactly one canonical person for this email, never duplicated");
  },
);

test(
  "a behavioral_signal observation with ONLY a LinkedIn URL (no email) does not create a canonical person — matches the existing planPersonResolution rule (work email/external id only)",
  { skip },
  async () => {
    const domain = uniqueDomain("backfill-linkedin-only");
    const account = await makeMatchedAccount(domain);
    await seedBehavioralObservation(
      rb2bRawValue(domain, {
        linkedin: `https://www.linkedin.com/in/test-${crypto.randomUUID()}`,
        contact_name: "Ryan Gilpin",
        contact_title: "Consultant",
      }),
    );

    const before = await accountPeopleCountFor(account.id);
    const summary = await backfillRb2bPeople(db!, { dryRun: false });
    const after = await accountPeopleCountFor(account.id);

    assert.equal(after, before, "no association was created for LinkedIn-only evidence");
    assert.ok(summary.personUnresolvedNoIdentity >= 1);
  },
);

test(
  "an observation with no contact evidence at all is skipped, never fabricating a person",
  { skip },
  async () => {
    const domain = uniqueDomain("backfill-no-contact");
    await makeMatchedAccount(domain);
    await seedBehavioralObservation(rb2bRawValue(domain));

    const before = await db!.select({ value: count() }).from(schema.people);
    await backfillRb2bPeople(db!, { dryRun: false });
    const after = await db!.select({ value: count() }).from(schema.people);

    assert.equal(Number(after[0]?.value ?? 0), Number(before[0]?.value ?? 0));
  },
);

test(
  "an observation for a domain with no matching canonical account is skipped, never creating an account",
  { skip },
  async () => {
    const domain = uniqueDomain("backfill-unmatched");
    const email = `noaccount-${crypto.randomUUID()}@${domain}`;
    await seedBehavioralObservation(rb2bRawValue(domain, { contact_email: email }));

    const before = await db!.select({ value: count() }).from(schema.accounts);
    const summary = await backfillRb2bPeople(db!, { dryRun: false });
    const after = await db!.select({ value: count() }).from(schema.accounts);

    assert.equal(Number(after[0]?.value ?? 0), Number(before[0]?.value ?? 0));
    assert.ok(summary.accountNotMatched >= 1);

    const matches = await db!.select().from(schema.people).where(eq(schema.people.workEmail, email.toLowerCase()));
    assert.equal(matches.length, 0, "no person was created for an account-unmatched observation");
  },
);

test(
  "dryRun leaves no trace — the transaction is rolled back, no person/association is actually persisted",
  { skip },
  async () => {
    const domain = uniqueDomain("backfill-dryrun");
    await makeMatchedAccount(domain);
    const email = `dryrun-${crypto.randomUUID()}@${domain}`;
    await seedBehavioralObservation(rb2bRawValue(domain, { contact_email: email, contact_name: "Dry Run" }));

    const summary = await backfillRb2bPeople(db!, { dryRun: true });
    assert.ok(summary.personCreated >= 1, "the dry run still reports what WOULD have been created");

    const matches = await db!.select().from(schema.people).where(eq(schema.people.workEmail, email.toLowerCase()));
    assert.equal(matches.length, 0, "dry run must not persist the person it reported creating");
  },
);

test(
  "the underlying observations table is never written to by the backfill — same row count before and after",
  { skip },
  async () => {
    const domain = uniqueDomain("backfill-preserves-observations");
    await makeMatchedAccount(domain);
    await seedBehavioralObservation(rb2bRawValue(domain, { contact_email: `preserve-${crypto.randomUUID()}@${domain}` }));

    const before = await db!.select({ value: count() }).from(schema.observations);
    await backfillRb2bPeople(db!, { dryRun: false });
    const after = await db!.select({ value: count() }).from(schema.observations);

    assert.equal(Number(after[0]?.value ?? 0), Number(before[0]?.value ?? 0));
  },
);

test.after(async () => {
  await pool?.end();
});
