// M3.5 — integration tests for ./rb2bIdentity.ts against a real, migrated
// Postgres instance: real accounts/account_aliases/people/account_people,
// real unique constraints. Proves the RB2B identity bridge reuses the
// exact same provider-neutral tables every other identity path already
// writes to, and — critically — never touches signals or
// identity_resolution_events (this module's whole point: no second
// account/person truth system).
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/rb2bIdentity.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { resolveRb2bPersonAccount } from "./rb2bIdentity.js";
import type { Rb2bSignalBridgeRequest } from "./rb2bObservationMapping.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function uniqueDomain(marker: string): string {
  return `${marker}-${crypto.randomUUID()}.example`;
}

function rb2bEvent(overrides: Partial<Rb2bSignalBridgeRequest> = {}): Rb2bSignalBridgeRequest {
  return {
    source: "rb2b",
    signal_type: "page_view",
    source_record_id: crypto.randomUUID(),
    ingestion_attempt_at: new Date().toISOString(),
    ...overrides,
  };
}

async function tableCount(
  table: typeof schema.signals | typeof schema.identityResolutionEvents,
): Promise<number> {
  const [row] = await db!.select({ value: count() }).from(table);
  return Number(row?.value ?? 0);
}

async function aliasesFor(accountId: string) {
  return db!
    .select()
    .from(schema.accountAliases)
    .where(eq(schema.accountAliases.accountId, accountId));
}

test(
  "a company-level event (no contact fields) resolves/creates the account by domain and never creates a person",
  { skip },
  async () => {
    const domain = uniqueDomain("rb2b-company-only");
    const before = {
      signals: await tableCount(schema.signals),
      events: await tableCount(schema.identityResolutionEvents),
    };

    const binding = await resolveRb2bPersonAccount({
      db: db!,
      event: rb2bEvent({ company_domain: domain, company_name: "RB2B Company Co" }),
    });

    assert.equal(binding.accountResolution.outcome, "resolved");
    if (binding.accountResolution.outcome !== "resolved") return;
    assert.equal(binding.accountResolution.matchAction, "created");
    assert.deepEqual(binding.personResolution, { attempted: false });

    const aliases = await aliasesFor(binding.accountResolution.accountId);
    assert.ok(aliases.some((a) => a.aliasType === "domain" && a.normalizedValue === domain));

    // The whole point of this bridge: no second truth system.
    assert.equal(await tableCount(schema.signals), before.signals);
    assert.equal(await tableCount(schema.identityResolutionEvents), before.events);
  },
);

test(
  "a contact-level event resolves the account AND creates/links a person via account_people",
  { skip },
  async () => {
    const domain = uniqueDomain("rb2b-contact");
    const email = `jane-${crypto.randomUUID()}@${domain}`;

    const binding = await resolveRb2bPersonAccount({
      db: db!,
      event: rb2bEvent({
        company_domain: domain,
        company_name: "RB2B Contact Co",
        contact_email: email,
        contact_name: "Jane Doe",
        contact_title: "VP Sales",
      }),
    });

    assert.equal(binding.accountResolution.outcome, "resolved");
    assert.equal(binding.personResolution.attempted, true);
    if (!binding.personResolution.attempted || binding.personResolution.outcome !== "resolved") {
      throw new Error("expected a resolved person");
    }
    assert.equal(binding.personResolution.matchAction, "created");

    const [personRow] = await db!
      .select()
      .from(schema.people)
      .where(eq(schema.people.id, binding.personResolution.personId));
    assert.equal(personRow?.workEmail, email.toLowerCase());

    if (binding.accountResolution.outcome !== "resolved") return;
    const [link] = await db!
      .select()
      .from(schema.accountPeople)
      .where(eq(schema.accountPeople.personId, binding.personResolution.personId));
    assert.equal(link?.accountId, binding.accountResolution.accountId);
    assert.equal(link?.title, "VP Sales");
    assert.equal(link?.source, "rb2b");
  },
);

test(
  "the identical contact event resolved twice matches the same account and person — idempotent, no duplicates",
  { skip },
  async () => {
    const domain = uniqueDomain("rb2b-idempotent");
    const email = `mark-${crypto.randomUUID()}@${domain}`;
    const event = rb2bEvent({ company_domain: domain, contact_email: email });

    const first = await resolveRb2bPersonAccount({ db: db!, event });
    const second = await resolveRb2bPersonAccount({ db: db!, event });

    assert.equal(first.accountResolution.outcome, "resolved");
    assert.equal(second.accountResolution.outcome, "resolved");
    if (first.accountResolution.outcome !== "resolved" || second.accountResolution.outcome !== "resolved") {
      return;
    }
    assert.equal(first.accountResolution.accountId, second.accountResolution.accountId);
    assert.equal(second.accountResolution.matchAction, "matched");

    if (!first.personResolution.attempted || !second.personResolution.attempted) {
      throw new Error("expected both attempts to resolve a person");
    }
    if (first.personResolution.outcome !== "resolved" || second.personResolution.outcome !== "resolved") {
      throw new Error("expected both attempts to resolve a person");
    }
    assert.equal(first.personResolution.personId, second.personResolution.personId);
    assert.equal(second.personResolution.matchAction, "matched");
  },
);

test(
  "a company-level event with no domain at all is unresolved — never guessed — and creates nothing",
  { skip },
  async () => {
    const binding = await resolveRb2bPersonAccount({
      db: db!,
      event: rb2bEvent({ company_domain: null }),
    });

    assert.equal(binding.accountResolution.outcome, "unresolved");
    if (binding.accountResolution.outcome !== "unresolved") return;
    assert.equal(binding.accountResolution.reasonToken, "no_strong_company_identity");
    assert.deepEqual(binding.personResolution, { attempted: false });
  },
);

test(
  "an account already created (e.g. by another provider) with a matching domain is matched, not duplicated, by an RB2B event",
  { skip },
  async () => {
    const domain = uniqueDomain("rb2b-cross-provider");
    const [existingAccount] = await db!
      .insert(schema.accounts)
      .values({ accountKey: `dom:${domain}`, companyDomain: domain, companyName: "Existing Co" })
      .returning();
    await db!.insert(schema.accountAliases).values({
      accountId: existingAccount!.id,
      aliasType: "domain",
      rawValue: domain,
      normalizedValue: domain,
      normalizationStrategy: "domain",
      isStrong: true,
      source: "hubspot",
    });

    const binding = await resolveRb2bPersonAccount({
      db: db!,
      event: rb2bEvent({ company_domain: domain }),
    });

    assert.equal(binding.accountResolution.outcome, "resolved");
    if (binding.accountResolution.outcome !== "resolved") return;
    assert.equal(binding.accountResolution.matchAction, "matched");
    assert.equal(binding.accountResolution.accountId, existingAccount!.id);
  },
);

test.after(async () => {
  await pool?.end();
});
