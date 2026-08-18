import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { bootstrapHubSpotCompanyIdentity } from "./hubSpotCompanyIdentity.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function uniqueDomain(marker: string): string {
  return `${marker}-${crypto.randomUUID()}.example`;
}

function uniqueHubSpotId(marker: string): string {
  return `${marker}-${crypto.randomUUID()}`;
}

async function aliasesFor(accountId: string) {
  return db!
    .select()
    .from(schema.accountAliases)
    .where(eq(schema.accountAliases.accountId, accountId));
}

async function tableCount(table: typeof schema.signals | typeof schema.identityResolutionEvents | typeof schema.people | typeof schema.accountPeople) {
  const [row] = await db!.select({ value: count() }).from(table);
  return Number(row?.value ?? 0);
}

test("creates one account with domain and HubSpot aliases, then replays without identity side effects", { skip }, async () => {
  const domain = uniqueDomain("hubspot-create");
  const hubspotCompanyId = uniqueHubSpotId("hubspot-create");
  const before = {
    signals: await tableCount(schema.signals),
    events: await tableCount(schema.identityResolutionEvents),
    people: await tableCount(schema.people),
    accountPeople: await tableCount(schema.accountPeople),
  };

  const created = await bootstrapHubSpotCompanyIdentity({
    db: db!,
    hubspotCompanyId,
    companyDomain: `https://www.${domain}/about`,
    companyName: "HubSpot Bootstrap Co",
  });
  assert.equal(created.outcome, "created");
  assert.deepEqual(created.attachedAliasTypes, ["domain", "external_id:hubspot"]);

  const replay = await bootstrapHubSpotCompanyIdentity({
    db: db!,
    hubspotCompanyId,
    companyDomain: domain,
    companyName: "HubSpot Bootstrap Co",
  });
  assert.equal(replay.outcome, "matched");
  assert.equal(replay.accountId, created.accountId);
  assert.deepEqual(replay.attachedAliasTypes, []);

  const accountRows = await db!
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.companyDomain, domain));
  assert.equal(accountRows.length, 1);
  assert.equal(accountRows[0]!.id, created.accountId);

  const aliases = await aliasesFor(created.accountId);
  assert.deepEqual(
    aliases
      .map((alias) => [alias.aliasType, alias.normalizedValue, alias.source])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      ["domain", domain, "hubspot"],
      ["external_id:hubspot", hubspotCompanyId, "hubspot"],
    ],
  );

  assert.deepEqual(
    {
      signals: await tableCount(schema.signals),
      events: await tableCount(schema.identityResolutionEvents),
      people: await tableCount(schema.people),
      accountPeople: await tableCount(schema.accountPeople),
    },
    before,
  );
});

test("reuses a legacy domain account and backfills both aliases", { skip }, async () => {
  const domain = uniqueDomain("hubspot-legacy");
  const hubspotCompanyId = uniqueHubSpotId("hubspot-legacy");
  const [existing] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:${domain}`, companyDomain: domain, companyName: "Legacy Co" })
    .returning();

  const result = await bootstrapHubSpotCompanyIdentity({
    db: db!,
    hubspotCompanyId,
    companyDomain: domain,
  });
  assert.equal(result.outcome, "matched");
  assert.equal(result.accountId, existing!.id);
  assert.deepEqual(result.attachedAliasTypes, ["domain", "external_id:hubspot"]);

  const accountRows = await db!
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.companyDomain, domain));
  assert.equal(accountRows.length, 1);
});

test("reuses a HubSpot-alias account and backfills the domain alias", { skip }, async () => {
  const domain = uniqueDomain("hubspot-alias");
  const hubspotCompanyId = uniqueHubSpotId("hubspot-alias");
  const [existing] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `seed:${crypto.randomUUID()}`, companyName: "Alias Co" })
    .returning();
  await db!.insert(schema.accountAliases).values({
    accountId: existing!.id,
    aliasType: "external_id:hubspot",
    rawValue: hubspotCompanyId,
    normalizedValue: hubspotCompanyId,
    normalizationStrategy: "exact",
    isStrong: true,
    source: "hubspot",
  });

  const result = await bootstrapHubSpotCompanyIdentity({
    db: db!,
    hubspotCompanyId,
    companyDomain: domain,
  });
  assert.equal(result.outcome, "matched");
  assert.equal(result.accountId, existing!.id);
  assert.deepEqual(result.attachedAliasTypes, ["domain"]);
});

test("returns an explicit conflict without remapping when domain and HubSpot id point to different accounts", { skip }, async () => {
  const domain = uniqueDomain("hubspot-conflict");
  const hubspotCompanyId = uniqueHubSpotId("hubspot-conflict");
  const [domainAccount] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:${domain}`, companyDomain: domain })
    .returning();
  const [hubspotAccount] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `seed:${crypto.randomUUID()}` })
    .returning();
  await db!.insert(schema.accountAliases).values({
    accountId: hubspotAccount!.id,
    aliasType: "external_id:hubspot",
    rawValue: hubspotCompanyId,
    normalizedValue: hubspotCompanyId,
    normalizationStrategy: "exact",
    isStrong: true,
    source: "hubspot",
  });

  const result = await bootstrapHubSpotCompanyIdentity({
    db: db!,
    hubspotCompanyId,
    companyDomain: domain,
  });
  assert.equal(result.outcome, "conflict");
  assert.deepEqual(
    result.candidateMatches.map((candidate) => candidate.matchedId).sort(),
    [domainAccount!.id, hubspotAccount!.id].sort(),
  );

  const domainAliases = await db!
    .select()
    .from(schema.accountAliases)
    .where(
      and(
        eq(schema.accountAliases.aliasType, "domain"),
        eq(schema.accountAliases.normalizedValue, domain),
      ),
    );
  assert.equal(domainAliases.length, 0);
});

test("concurrent identical calls converge on one account and one alias of each type", { skip }, async () => {
  const domain = uniqueDomain("hubspot-concurrent");
  const hubspotCompanyId = uniqueHubSpotId("hubspot-concurrent");
  const [first, second] = await Promise.all([
    bootstrapHubSpotCompanyIdentity({ db: db!, hubspotCompanyId, companyDomain: domain }),
    bootstrapHubSpotCompanyIdentity({ db: db!, hubspotCompanyId, companyDomain: domain }),
  ]);
  if (first.outcome === "conflict" || second.outcome === "conflict") {
    assert.fail("identical concurrent bootstrap calls must not conflict");
  }
  assert.equal(first.accountId, second.accountId);

  const accountRows = await db!
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.companyDomain, domain));
  assert.equal(accountRows.length, 1);
  const aliases = await aliasesFor(first.accountId);
  assert.equal(
    aliases.filter(
      (alias) =>
        (alias.aliasType === "domain" && alias.normalizedValue === domain) ||
        (alias.aliasType === "external_id:hubspot" &&
          alias.normalizedValue === hubspotCompanyId),
    ).length,
    2,
  );
});

test.after(async () => {
  await pool?.end();
});
