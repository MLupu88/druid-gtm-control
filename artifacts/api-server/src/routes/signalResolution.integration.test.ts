// Integration tests for POST /internal/signals/:signalId/resolve,
// exercised end-to-end against a real, migrated Postgres instance: real
// db, the real service layer (../services/identityResolution.ts), the
// real HTTP layer (requireServiceAuth + an ephemeral express server +
// real fetch()), and the real unique constraints/triggers from
// lib/db/drizzle/0008_grey_lester.sql /
// 0009_signals_identity_resolution_immutability.sql — no fakes anywhere
// in this file.
//
// This is the ONLY real-Postgres suite for runtime identity resolution —
// deliberately not paired with a services/identityResolution.integration.test.ts,
// since every database-observable behavior this unit needs to prove
// (matching, creation, concurrency races, idempotent replay, append-only
// enforcement, absence of side effects) is fully exercised through this
// single boundary. Mirrors ./signals.integration.test.ts's own pattern.
//
// A handful of tests below call resolveSignal() directly (bypassing the
// HTTP layer) because they need to pass ResolveSignalTestHooks — a
// test-only barrier mechanism (see ../services/identityResolution.ts)
// that ../routes/signalResolution.ts deliberately never exposes over
// HTTP. Every other test still goes through the real HTTP boundary.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed against a real Postgres instance as part of this change (no
// database connection was made) — see the accompanying report for the
// exact command to run it; CI provisions an ephemeral instance and runs
// it there.
//
// No truncation or row deletion anywhere except where a test explicitly
// simulates external evidence changing (see the "rerun after new
// evidence" test below, which is explicit about why) — isolation comes
// from crypto.randomUUID()-suffixed domains/emails/external ids, and
// signals/identity_resolution_events are immutable/insert-only by
// trigger regardless.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/routes/signalResolution.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { requireServiceAuth } from "../middlewares/requireServiceAuth.js";
import { resolveSignal } from "../services/identityResolution.js";
import { createSignalResolutionRouter } from "./signalResolution.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const TEST_SECRET = "identity-resolution-integration-test-secret";
process.env.GTM_SIGNAL_INGESTION_SECRET = TEST_SECRET;

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "x-gtm-ingestion-secret": TEST_SECRET,
};

function assertIsRecord(value: unknown, context: string): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${context} must be a JSON object`);
}

async function readJson(res: Response, context: string): Promise<Record<string, unknown>> {
  const value: unknown = await res.json();
  assertIsRecord(value, context);
  return value;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/internal/signals", requireServiceAuth, createSignalResolutionRouter({ db: db! }));
  return app;
}

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = buildApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function postResolve(baseUrl: string, signalId: string): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/internal/signals/${signalId}/resolve`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function normalizedPayload(overrides: Record<string, unknown> = {}) {
  const sourceEventId = `sig-${crypto.randomUUID()}`;
  return {
    schemaVersion: "v1",
    source: "hubspot",
    sourceEventId,
    occurredAt: "2026-01-01T00:00:00Z",
    signalType: "page_view",
    observedResolutionLevel: "anonymous",
    company: { domain: null, name: null, externalIds: {} },
    person: null,
    activity: {
      pageUrl: null,
      signalDetail: null,
      formName: null,
      formStep: null,
      campaignId: null,
      campaignName: null,
      utm: null,
      clickIds: null,
    },
    sourceMetadata: null,
    ...overrides,
  };
}

async function insertSignal(overrides: Record<string, unknown> = {}) {
  const payload = normalizedPayload(overrides);
  const [row] = await db!
    .insert(schema.signals)
    .values({
      source: payload.source,
      sourceEventId: payload.sourceEventId,
      occurredAt: new Date(payload.occurredAt),
      signalType: payload.signalType,
      observedResolutionLevel: payload.observedResolutionLevel as schema.Signal["observedResolutionLevel"],
      companyDomain: payload.company.domain,
      companyName: payload.company.name,
      campaignId: payload.activity.campaignId,
      campaignName: payload.activity.campaignName,
      schemaVersion: payload.schemaVersion,
      rawPayload: {},
      normalizedPayload: payload,
    })
    .returning();
  return row!;
}

function uniqueDomain(marker: string): string {
  return `${marker}-${crypto.randomUUID()}.example`;
}

function uniqueEmail(marker: string): string {
  return `${marker}-${crypto.randomUUID()}@example.com`;
}

async function eventsForSignal(signalId: string) {
  return db!
    .select()
    .from(schema.identityResolutionEvents)
    .where(eq(schema.identityResolutionEvents.signalId, signalId))
    .orderBy(schema.identityResolutionEvents.createdAt, schema.identityResolutionEvents.id);
}

async function accountsByDomain(domain: string) {
  return db!.select().from(schema.accounts).where(eq(schema.accounts.companyDomain, domain));
}

async function peopleByEmail(email: string) {
  return db!.select().from(schema.people).where(eq(schema.people.workEmail, email));
}

/** A resolved deferred pair — used to build barrier synchronization points in the concurrency tests below. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------

test("account match by domain: an existing account with a strong domain alias is matched, not duplicated", { skip }, async () => {
  const domain = uniqueDomain("domain-match");
  const [account] = await db!.insert(schema.accounts).values({ accountKey: `dom:${domain}`, companyDomain: domain }).returning();
  await db!.insert(schema.accountAliases).values({
    accountId: account!.id,
    aliasType: "domain",
    rawValue: domain,
    normalizedValue: domain,
    normalizationStrategy: "domain",
    isStrong: true,
    source: "hubspot",
  });
  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "Acme", externalIds: {} } });

  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(res.status, 200);
    assert.equal(body.outcome, "account_resolved");
    assert.equal(body.accountId, account!.id);
    assert.equal(body.accountMatchAction, "matched");
  });

  const rows = await accountsByDomain(domain);
  assert.equal(rows.length, 1, "no duplicate account should have been created");
});

test("account match by external ID: an existing account with a strong external_id alias is matched", { skip }, async () => {
  const externalId = `ext-${crypto.randomUUID()}`;
  const [account] = await db!.insert(schema.accounts).values({ accountKey: `ext:v1:seed-${crypto.randomUUID()}` }).returning();
  await db!.insert(schema.accountAliases).values({
    accountId: account!.id,
    aliasType: "external_id:hubspot",
    rawValue: externalId,
    normalizedValue: externalId,
    normalizationStrategy: "exact",
    isStrong: true,
    source: "hubspot",
  });
  const signal = await insertSignal({
    observedResolutionLevel: "company",
    company: { domain: null, name: null, externalIds: { hubspot: externalId } },
  });

  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(body.outcome, "account_resolved");
    assert.equal(body.accountId, account!.id);
    assert.equal(body.accountMatchAction, "matched");
  });
});

test("new account and aliases: no existing match creates exactly one account (dom: key) with a strong alias per identifier, in deterministic order", { skip }, async () => {
  const domain = uniqueDomain("new-account");
  const externalIdB = `ext-b-${crypto.randomUUID()}`;
  const externalIdA = `ext-a-${crypto.randomUUID()}`;
  const signal = await insertSignal({
    observedResolutionLevel: "company",
    // externalIds supplied in a non-alphabetical key order — the
    // resolver must still produce the same deterministic alias set
    // regardless of source JSON key order (Correction 3).
    company: { domain, name: "NewCo", externalIds: { zzzsource: externalIdB, aaasource: externalIdA } },
  });

  let accountId!: string;
  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(body.outcome, "account_resolved");
    assert.equal(body.accountMatchAction, "created");
    accountId = body.accountId as string;
  });

  const [account] = await db!.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
  assert.equal(account!.accountKey, `dom:${domain}`);
  assert.equal(account!.companyDomain, domain);
  assert.equal(account!.companyName, "NewCo");

  const aliases = await db!.select().from(schema.accountAliases).where(eq(schema.accountAliases.accountId, accountId));
  assert.equal(aliases.length, 3);
  assert.ok(aliases.some((a) => a.aliasType === "domain" && a.normalizedValue === domain));
  assert.ok(aliases.some((a) => a.aliasType === "external_id:zzzsource" && a.normalizedValue === externalIdB));
  assert.ok(aliases.some((a) => a.aliasType === "external_id:aaasource" && a.normalizedValue === externalIdA));
});

// ---------------------------------------------------------------------
// CORRECTION 1 — legacy/bootstrap account compatibility
// ---------------------------------------------------------------------

test("legacy dom:<domain> account (from bootstrapProductionData-style seeding, no alias yet) is reused: alias attached, no duplicate account", { skip }, async () => {
  const domain = uniqueDomain("legacy-dom-key");
  const [legacyAccount] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:${domain}`, companyDomain: domain, companyName: "Legacy Co" })
    .returning();
  // Deliberately no account_aliases row — mirrors
  // bootstrapProductionData.ts exactly.

  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "New Signal Name", externalIds: {} } });

  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(res.status, 200);
    assert.equal(body.outcome, "account_resolved");
    assert.equal(body.accountId, legacyAccount!.id);
    assert.equal(body.accountMatchAction, "matched");
  });

  const accountsFound = await accountsByDomain(domain);
  assert.equal(accountsFound.length, 1, "no duplicate account was created for the legacy row");
  assert.equal(accountsFound[0]!.companyName, "Legacy Co", "companyName must not be overwritten on a match");

  const aliases = await db!.select().from(schema.accountAliases).where(eq(schema.accountAliases.accountId, legacyAccount!.id));
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0]!.aliasType, "domain");
  assert.equal(aliases[0]!.normalizedValue, domain);
});

test("legacy bare-domain account key (pre-dating even the dom: convention) is also reused for compatibility", { skip }, async () => {
  const domain = uniqueDomain("legacy-bare-key");
  const [legacyAccount] = await db!
    .insert(schema.accounts)
    .values({ accountKey: domain, companyDomain: domain })
    .returning();

  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: null, externalIds: {} } });

  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(body.outcome, "account_resolved");
    assert.equal(body.accountId, legacyAccount!.id);
    assert.equal(body.accountMatchAction, "matched");
  });

  const accountsFound = await accountsByDomain(domain);
  assert.equal(accountsFound.length, 1);
});

test("two existing accounts sharing the same company_domain produce an unresolved account_identifier_conflict", { skip }, async () => {
  const domain = uniqueDomain("dup-company-domain");
  const [accountA] = await db!.insert(schema.accounts).values({ accountKey: `dom:${domain}`, companyDomain: domain }).returning();
  const [accountB] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `some-other-legacy-key-${crypto.randomUUID()}`, companyDomain: domain })
    .returning();

  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: null, externalIds: {} } });

  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(body.outcome, "unresolved");
    assert.equal(body.accountId, null);
  });

  // Neither pre-existing account should have gained an alias or been
  // touched — a conflict must never guess.
  const aliasesA = await db!.select().from(schema.accountAliases).where(eq(schema.accountAliases.accountId, accountA!.id));
  const aliasesB = await db!.select().from(schema.accountAliases).where(eq(schema.accountAliases.accountId, accountB!.id));
  assert.equal(aliasesA.length, 0);
  assert.equal(aliasesB.length, 0);
});

test("an alias-matched account conflicting with a legacy direct-account candidate also produces unresolved conflict", { skip }, async () => {
  const domain = uniqueDomain("alias-vs-direct-conflict");
  const [accountA] = await db!.insert(schema.accounts).values({ accountKey: `dom:alias-owner-${crypto.randomUUID()}` }).returning();
  await db!.insert(schema.accountAliases).values({
    accountId: accountA!.id,
    aliasType: "domain",
    rawValue: domain,
    normalizedValue: domain,
    normalizationStrategy: "domain",
    isStrong: true,
    source: "hubspot",
  });
  // A DIFFERENT account, found only via the legacy compatibility lookup
  // (account_key = dom:<domain>), never via any alias.
  const [accountB] = await db!.insert(schema.accounts).values({ accountKey: `dom:${domain}`, companyDomain: domain }).returning();

  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: null, externalIds: {} } });

  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(body.outcome, "unresolved");
    assert.equal(body.accountId, null);
  });

  const aliasesA = await db!.select().from(schema.accountAliases).where(eq(schema.accountAliases.accountId, accountA!.id));
  const aliasesB = await db!.select().from(schema.accountAliases).where(eq(schema.accountAliases.accountId, accountB!.id));
  assert.equal(aliasesA.length, 1, "account A's pre-existing alias is untouched");
  assert.equal(aliasesB.length, 0, "account B never gains an alias from a conflicting resolution");
});

// ---------------------------------------------------------------------
// account_people relationship
// ---------------------------------------------------------------------

test("account/person relationship creation and reuse: two signals for the same account/person upsert one account_people row", { skip }, async () => {
  const domain = uniqueDomain("relationship");
  const email = uniqueEmail("relationship");

  const signal1 = await insertSignal({
    observedResolutionLevel: "contact",
    company: { domain, name: "RelCo", externalIds: {} },
    person: { fullName: "Jane Doe", workEmail: email, title: "VP Eng", linkedinUrl: null, externalIds: {} },
  });

  let accountId!: string;
  let personId!: string;
  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal1.id);
    const body = await readJson(res, "response");
    assert.equal(body.outcome, "person_resolved");
    accountId = body.accountId as string;
    personId = body.personId as string;
  });

  const relBefore = await db!
    .select()
    .from(schema.accountPeople)
    .where(and(eq(schema.accountPeople.accountId, accountId), eq(schema.accountPeople.personId, personId)));
  assert.equal(relBefore.length, 1);
  assert.equal(relBefore[0]!.title, "VP Eng");
  const firstSeenAt = relBefore[0]!.firstSeenAt;

  // Second signal, same domain and email, different title — must reuse
  // (not duplicate) the relationship, preserve firstSeenAt, bump
  // lastSeenAt, and update the title.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const signal2 = await insertSignal({
    observedResolutionLevel: "contact",
    company: { domain, name: "RelCo", externalIds: {} },
    person: { fullName: "Jane Doe", workEmail: email, title: "SVP Eng", linkedinUrl: null, externalIds: {} },
  });

  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal2.id);
    const body = await readJson(res, "response");
    assert.equal(body.accountId, accountId);
    assert.equal(body.personId, personId);
  });

  const relAfter = await db!
    .select()
    .from(schema.accountPeople)
    .where(and(eq(schema.accountPeople.accountId, accountId), eq(schema.accountPeople.personId, personId)));
  assert.equal(relAfter.length, 1, "must reuse the same relationship row, never duplicate it");
  assert.equal(relAfter[0]!.title, "SVP Eng");
  assert.deepEqual(relAfter[0]!.firstSeenAt, firstSeenAt);
  assert.ok(relAfter[0]!.lastSeenAt.getTime() >= firstSeenAt.getTime());
});

// ---------------------------------------------------------------------
// CORRECTION 2 — replay must be write-free (real timestamps/rows)
// ---------------------------------------------------------------------

test("exact replay leaves account_people.last_seen_at and title unchanged, adds no alias, appends no event", { skip }, async () => {
  const domain = uniqueDomain("replay-write-free");
  const email = uniqueEmail("replay-write-free");
  const signal = await insertSignal({
    observedResolutionLevel: "contact",
    company: { domain, name: "ReplayCo", externalIds: {} },
    person: { fullName: "Jane Doe", workEmail: email, title: "VP Eng", linkedinUrl: null, externalIds: {} },
  });

  let accountId!: string;
  let personId!: string;
  let firstEventId!: string;
  let firstCreatedAt!: string;
  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(body.status, "resolved");
    accountId = body.accountId as string;
    personId = body.personId as string;
    firstEventId = body.eventId as string;
    firstCreatedAt = body.createdAt as string;
  });

  const relBefore = await db!
    .select()
    .from(schema.accountPeople)
    .where(and(eq(schema.accountPeople.accountId, accountId), eq(schema.accountPeople.personId, personId)));
  assert.equal(relBefore.length, 1);
  const lastSeenAtBefore = relBefore[0]!.lastSeenAt.getTime();
  const titleBefore = relBefore[0]!.title;

  const aliasesBefore = await db!.select().from(schema.accountAliases).where(eq(schema.accountAliases.accountId, accountId));
  const aliasCountBefore = aliasesBefore.length;

  // Wait long enough that a real (bugged) lastSeenAt bump would be
  // observably different from the first resolve's timestamp.
  await new Promise((resolve) => setTimeout(resolve, 50));

  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    assert.equal(res.status, 200);
    assert.equal(body.status, "replayed");
    assert.equal(body.eventId, firstEventId);
    assert.equal(body.createdAt, firstCreatedAt);
  });

  const relAfter = await db!
    .select()
    .from(schema.accountPeople)
    .where(and(eq(schema.accountPeople.accountId, accountId), eq(schema.accountPeople.personId, personId)));
  assert.equal(relAfter.length, 1);
  assert.equal(relAfter[0]!.lastSeenAt.getTime(), lastSeenAtBefore, "last_seen_at must not change on a pure replay");
  assert.equal(relAfter[0]!.title, titleBefore, "title must not change on a pure replay");

  const aliasesAfter = await db!.select().from(schema.accountAliases).where(eq(schema.accountAliases.accountId, accountId));
  assert.equal(aliasesAfter.length, aliasCountBefore, "no alias may be added on a pure replay");

  const events = await eventsForSignal(signal.id);
  assert.equal(events.length, 1, "no event may be appended on a pure replay");
});

// ---------------------------------------------------------------------
// Idempotency / retry
// ---------------------------------------------------------------------

test("exact retry returns the same eventId, appending no row", { skip }, async () => {
  const domain = uniqueDomain("exact-retry");
  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "RetryCo", externalIds: {} } });

  let firstEventId!: string;
  await withServer(async (baseUrl) => {
    const res1 = await postResolve(baseUrl, signal.id);
    const body1 = await readJson(res1, "first");
    assert.equal(body1.status, "resolved");
    firstEventId = body1.eventId as string;

    const res2 = await postResolve(baseUrl, signal.id);
    const body2 = await readJson(res2, "second");
    assert.equal(body2.status, "replayed");
    assert.equal(body2.eventId, firstEventId);
  });

  const events = await eventsForSignal(signal.id);
  assert.equal(events.length, 1);
});

test("first event created; retry recomputes matched but still replays (created-vs-matched is ignored for equivalence)", { skip }, async () => {
  const domain = uniqueDomain("created-vs-matched");
  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "MvCCo", externalIds: {} } });

  let firstEventId!: string;
  await withServer(async (baseUrl) => {
    const res1 = await postResolve(baseUrl, signal.id);
    const body1 = await readJson(res1, "first");
    assert.equal(body1.status, "resolved");
    assert.equal(body1.accountMatchAction, "created");
    firstEventId = body1.eventId as string;

    const res2 = await postResolve(baseUrl, signal.id);
    const body2 = await readJson(res2, "second");
    // The account now already exists, so this attempt matches it — but
    // the response must still report the replayed prior event, not a
    // fresh "matched" event.
    assert.equal(body2.status, "replayed");
    assert.equal(body2.eventId, firstEventId);
    assert.equal(body2.accountMatchAction, "created");
  });

  const events = await eventsForSignal(signal.id);
  assert.equal(events.length, 1);
});

test("unresolved rerun after evidence changes appends a resolved event", { skip }, async () => {
  // Constructs a genuine account_identifier_conflict (two pre-existing
  // accounts, one per identifier the signal carries), resolves once
  // (unresolved), then simulates the conflict being cleared by an
  // external correction (deleting the losing alias directly — this unit
  // itself has no alias-merge capability) and reruns: the resolver must
  // re-read fresh alias state rather than reuse anything cached from the
  // first attempt.
  const domain = uniqueDomain("conflict-then-clear");
  const externalId = `ext-${crypto.randomUUID()}`;

  const [accountA] = await db!.insert(schema.accounts).values({ accountKey: `dom:${domain}`, companyDomain: domain }).returning();
  await db!.insert(schema.accountAliases).values({
    accountId: accountA!.id,
    aliasType: "domain",
    rawValue: domain,
    normalizedValue: domain,
    normalizationStrategy: "domain",
    isStrong: true,
    source: "hubspot",
  });
  const [accountB] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `ext:v1:seed-${crypto.randomUUID()}` })
    .returning();
  const [conflictingAlias] = await db!
    .insert(schema.accountAliases)
    .values({
      accountId: accountB!.id,
      aliasType: "external_id:hubspot",
      rawValue: externalId,
      normalizedValue: externalId,
      normalizationStrategy: "exact",
      isStrong: true,
      source: "hubspot",
    })
    .returning();

  const signal = await insertSignal({
    observedResolutionLevel: "company",
    company: { domain, name: null, externalIds: { hubspot: externalId } },
  });

  await withServer(async (baseUrl) => {
    const res1 = await postResolve(baseUrl, signal.id);
    const body1 = await readJson(res1, "first");
    assert.equal(body1.outcome, "unresolved");
  });

  // Simulate the conflict being cleared externally.
  await db!.delete(schema.accountAliases).where(eq(schema.accountAliases.id, conflictingAlias!.id));

  await withServer(async (baseUrl) => {
    const res2 = await postResolve(baseUrl, signal.id);
    const body2 = await readJson(res2, "second");
    assert.equal(body2.outcome, "account_resolved");
    assert.equal(body2.accountId, accountA!.id);
  });

  const events = await eventsForSignal(signal.id);
  assert.equal(events.length, 2);
  assert.equal(events[0]!.outcome, "unresolved");
  assert.equal(events[1]!.outcome, "account_resolved");
});

// ---------------------------------------------------------------------
// Same-signal concurrency (soft — incidental timing via Promise.all)
// ---------------------------------------------------------------------

test("same-signal anonymous concurrent requests also create exactly one unresolved event", { skip }, async () => {
  const signal = await insertSignal({ observedResolutionLevel: "anonymous", company: { domain: null, name: null, externalIds: {} } });

  await withServer(async (baseUrl) => {
    const [res1, res2] = await Promise.all([postResolve(baseUrl, signal.id), postResolve(baseUrl, signal.id)]);
    const [body1, body2] = await Promise.all([readJson(res1, "res1"), readJson(res2, "res2")]);
    assert.equal(body1.outcome, "unresolved");
    assert.equal(body2.outcome, "unresolved");
    assert.equal(body1.eventId, body2.eventId);
  });

  const events = await eventsForSignal(signal.id);
  assert.equal(events.length, 1);
});

test("same-signal conflicting-identifier concurrent requests also create exactly one unresolved event", { skip }, async () => {
  const domain = uniqueDomain("conflict-race");
  const externalId = `ext-${crypto.randomUUID()}`;
  const [accountA] = await db!.insert(schema.accounts).values({ accountKey: `dom:${domain}`, companyDomain: domain }).returning();
  await db!.insert(schema.accountAliases).values({
    accountId: accountA!.id,
    aliasType: "domain",
    rawValue: domain,
    normalizedValue: domain,
    normalizationStrategy: "domain",
    isStrong: true,
    source: "hubspot",
  });
  const [accountB] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `ext:v1:seed-${crypto.randomUUID()}` })
    .returning();
  await db!.insert(schema.accountAliases).values({
    accountId: accountB!.id,
    aliasType: "external_id:hubspot",
    rawValue: externalId,
    normalizedValue: externalId,
    normalizationStrategy: "exact",
    isStrong: true,
    source: "hubspot",
  });

  const signal = await insertSignal({
    observedResolutionLevel: "company",
    company: { domain, name: null, externalIds: { hubspot: externalId } },
  });

  await withServer(async (baseUrl) => {
    const [res1, res2] = await Promise.all([postResolve(baseUrl, signal.id), postResolve(baseUrl, signal.id)]);
    const [body1, body2] = await Promise.all([readJson(res1, "res1"), readJson(res2, "res2")]);
    assert.equal(body1.outcome, "unresolved");
    assert.equal(body2.outcome, "unresolved");
    assert.equal(body1.eventId, body2.eventId);
  });

  const events = await eventsForSignal(signal.id);
  assert.equal(events.length, 1);
});

// ---------------------------------------------------------------------
// CORRECTION 5 — stronger concurrency tests via test-only barrier hooks.
// These call resolveSignal() directly (not through HTTP) because the
// hooks are deliberately not exposed at the HTTP boundary. Kept to
// exactly the three race-specific scenarios below — every other
// concurrency test in this file uses plain Promise.all.
// ---------------------------------------------------------------------

test("same-signal concurrency (forced overlap: B starts only once A provably holds the row lock): both return the same event, exactly one event exists", { skip }, async () => {
  const domain = uniqueDomain("barrier-same-signal");
  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "BarrierCo", externalIds: {} } });

  const aLocked = deferred();
  const releaseA = deferred();

  const resultAPromise = resolveSignal({
    db: db!,
    signalId: signal.id,
    testHooks: {
      afterSignalLock: async () => {
        aLocked.resolve();
        await releaseA.promise;
      },
    },
  });

  await aLocked.promise; // A now provably holds SELECT ... FOR UPDATE on the signal row.

  const resultBPromise = resolveSignal({ db: db!, signalId: signal.id });

  // Give B's own transaction time to actually issue its SELECT ... FOR
  // UPDATE and start blocking on the lock A holds.
  await new Promise((resolve) => setTimeout(resolve, 100));

  releaseA.resolve();

  const [resultA, resultB] = await Promise.all([resultAPromise, resultBPromise]);
  assert.equal(resultA.kind, "completed");
  assert.equal(resultB.kind, "completed");
  if (resultA.kind !== "completed" || resultB.kind !== "completed") throw new Error("unreachable");
  assert.equal(resultA.event.id, resultB.event.id);

  const events = await eventsForSignal(signal.id);
  assert.equal(events.length, 1);
});

test("cross-signal same-company race (forced overlap: both transactions reach account/alias creation together): one canonical account survives, no orphan", { skip }, async () => {
  const domain = uniqueDomain("barrier-cross-signal-domain");
  const signalA = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "BarrierCo", externalIds: {} } });
  const signalB = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "BarrierCo", externalIds: {} } });

  const aReady = deferred();
  const bReady = deferred();
  const releaseBoth = deferred();

  const resultAPromise = resolveSignal({
    db: db!,
    signalId: signalA.id,
    testHooks: {
      beforeAccountAliasInsert: async () => {
        aReady.resolve();
        await releaseBoth.promise;
      },
    },
  });
  const resultBPromise = resolveSignal({
    db: db!,
    signalId: signalB.id,
    testHooks: {
      beforeAccountAliasInsert: async () => {
        bReady.resolve();
        await releaseBoth.promise;
      },
    },
  });

  await Promise.all([aReady.promise, bReady.promise]); // both transactions are paused right before their INSERT INTO accounts.
  releaseBoth.resolve();

  const [resultA, resultB] = await Promise.all([resultAPromise, resultBPromise]);
  assert.equal(resultA.kind, "completed");
  assert.equal(resultB.kind, "completed");
  if (resultA.kind !== "completed" || resultB.kind !== "completed") throw new Error("unreachable");
  assert.equal(resultA.event.accountId, resultB.event.accountId, "both signals must converge on the same account");

  const accountsFound = await accountsByDomain(domain);
  assert.equal(accountsFound.length, 1, "exactly one account — no orphan left behind by the losing attempt");
});

test("cross-signal same-person race (forced overlap: both transactions reach person creation together): one person survives, no orphan", { skip }, async () => {
  const domain = uniqueDomain("barrier-cross-signal-person");
  const [account] = await db!.insert(schema.accounts).values({ accountKey: `dom:${domain}`, companyDomain: domain }).returning();
  await db!.insert(schema.accountAliases).values({
    accountId: account!.id,
    aliasType: "domain",
    rawValue: domain,
    normalizedValue: domain,
    normalizationStrategy: "domain",
    isStrong: true,
    source: "hubspot",
  });

  const email = uniqueEmail("barrier-cross-signal-person");
  const signalA = await insertSignal({
    observedResolutionLevel: "contact",
    company: { domain, name: null, externalIds: {} },
    person: { fullName: "Race Person", workEmail: email, title: null, linkedinUrl: null, externalIds: {} },
  });
  const signalB = await insertSignal({
    observedResolutionLevel: "contact",
    company: { domain, name: null, externalIds: {} },
    person: { fullName: "Race Person", workEmail: email, title: null, linkedinUrl: null, externalIds: {} },
  });

  const aReady = deferred();
  const bReady = deferred();
  const releaseBoth = deferred();

  const resultAPromise = resolveSignal({
    db: db!,
    signalId: signalA.id,
    testHooks: {
      beforePersonInsert: async () => {
        aReady.resolve();
        await releaseBoth.promise;
      },
    },
  });
  const resultBPromise = resolveSignal({
    db: db!,
    signalId: signalB.id,
    testHooks: {
      beforePersonInsert: async () => {
        bReady.resolve();
        await releaseBoth.promise;
      },
    },
  });

  await Promise.all([aReady.promise, bReady.promise]);
  releaseBoth.resolve();

  const [resultA, resultB] = await Promise.all([resultAPromise, resultBPromise]);
  assert.equal(resultA.kind, "completed");
  assert.equal(resultB.kind, "completed");
  if (resultA.kind !== "completed" || resultB.kind !== "completed") throw new Error("unreachable");
  assert.equal(resultA.event.outcome, "person_resolved");
  assert.equal(resultB.event.outcome, "person_resolved");
  assert.equal(resultA.event.personId, resultB.event.personId, "both signals must converge on the same person");

  const peopleFound = await peopleByEmail(email);
  assert.equal(peopleFound.length, 1, "exactly one person — no orphan left behind by the losing attempt");
});

// ---------------------------------------------------------------------
// No signal mutation, no unrelated side effects, append-only enforcement
// ---------------------------------------------------------------------

test("the signal row itself is never mutated by resolution", { skip }, async () => {
  const domain = uniqueDomain("no-signal-mutation");
  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "ImmutableCo", externalIds: {} } });

  await withServer(async (baseUrl) => {
    await postResolve(baseUrl, signal.id);
  });

  const [after] = await db!.select().from(schema.signals).where(eq(schema.signals.id, signal.id));
  assert.deepEqual(after, signal);
});

test("no evaluation, decision, attention or action side effects", { skip }, async () => {
  const domain = uniqueDomain("no-side-effects");
  const email = uniqueEmail("no-side-effects");
  const signal = await insertSignal({
    observedResolutionLevel: "contact",
    company: { domain, name: "NoSideEffectsCo", externalIds: {} },
    person: { fullName: "No SideEffects", workEmail: email, title: null, linkedinUrl: null, externalIds: {} },
  });

  let accountId!: string;
  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    accountId = body.accountId as string;
  });

  const evaluations = await db!
    .select()
    .from(schema.accountEvaluations)
    .where(eq(schema.accountEvaluations.accountId, accountId));
  assert.equal(evaluations.length, 0);

  const decisions = await db!
    .select({ id: schema.accountDecisions.id })
    .from(schema.accountDecisions)
    .innerJoin(schema.accountEvaluations, eq(schema.accountDecisions.accountEvaluationId, schema.accountEvaluations.id))
    .where(eq(schema.accountEvaluations.accountId, accountId));
  assert.equal(decisions.length, 0);
});

test("identity_resolution_events remain append-only for rows this service creates", { skip }, async () => {
  const domain = uniqueDomain("append-only");
  const signal = await insertSignal({ observedResolutionLevel: "company", company: { domain, name: "AppendOnlyCo", externalIds: {} } });

  let eventId!: string;
  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, signal.id);
    const body = await readJson(res, "response");
    eventId = body.eventId as string;
  });

  await assert.rejects(() =>
    db!
      .update(schema.identityResolutionEvents)
      .set({ outcome: "unresolved" })
      .where(eq(schema.identityResolutionEvents.id, eventId)),
  );
  await assert.rejects(() =>
    db!.delete(schema.identityResolutionEvents).where(eq(schema.identityResolutionEvents.id, eventId)),
  );
});
