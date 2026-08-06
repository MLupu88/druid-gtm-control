// Integration tests for GET /api/internal/accounts and
// GET /api/internal/accounts/:accountId, exercised end-to-end against a
// real, migrated Postgres instance: real db, real service layer
// (../services/accounts.ts), real HTTP layer (an ephemeral express server
// + real fetch()), and the real integrity triggers/constraints from
// lib/db/drizzle/0001_integrity_triggers.sql — no fakes anywhere in this
// file.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset.
//
// Deliberately builds its own pg.Pool/drizzle instance rather than
// importing @workspace/db's exported singleton — that singleton throws at
// import time if DATABASE_URL is unset, which would break this file's
// ability to skip itself. Mirrors ./accountEvaluations.integration.test.ts
// and ./icpProfiles.integration.test.ts.
//
// Response bodies are parsed as `unknown` and narrowed with runtime
// assertion helpers (assertIsRecord/assertIsArray/assertIsString/
// assertIsNumber) rather than cast.
//
// This route has no delete/update path, and account_snapshots /
// account_evaluations are append-only (rejected by trigger) besides — so
// no cleanup of inserted rows is attempted here. This database may
// already contain rows from earlier runs of this same file, and it will
// keep accumulating them. Every assertion below either targets a fixture
// by its own freshly-generated id, or filters a full response down to
// just this run's known fixture ids before checking relative order.
// makeOrderedIdPair/runTimestamp below keep fixture ids and ordering
// timestamps both unique and deterministically orderable across reruns.
//
// Run with: tsx --test src/routes/accounts.integration.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { createAccountsRouter } from "./accounts.js";
import { resolveAttentionItem } from "../services/attentionItems.js";
import { deriveMqlDecisionReadiness } from "../services/mqlDecisionReadiness.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

// Embedded in accountKey/profile name strings below, purely for human
// traceability in a shared, never-cleaned-up disposable database. No
// assertion depends on it.
const RUN_ID = crypto.randomUUID();

// ---------------------------------------------------------------------
// Runtime response-shape assertions (no `as` casts).
// ---------------------------------------------------------------------

function assertIsRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${context} must be a JSON object`,
  );
}

function assertIsArray(
  value: unknown,
  context: string,
): asserts value is unknown[] {
  assert.ok(Array.isArray(value), `${context} must be a JSON array`);
}

function assertIsString(
  value: unknown,
  context: string,
): asserts value is string {
  assert.ok(typeof value === "string", `${context} must be a string`);
}

function assertIsNumber(
  value: unknown,
  context: string,
): asserts value is number {
  assert.ok(typeof value === "number", `${context} must be a number`);
}

async function readRecord(
  res: Response,
  context: string,
): Promise<Record<string, unknown>> {
  const json: unknown = await res.json();
  assertIsRecord(json, context);
  return json;
}

function extractListItemAccountId(item: unknown, context: string): string {
  assertIsRecord(item, context);
  assertIsRecord(item.account, `${context}.account`);
  assertIsString(item.account.id, `${context}.account.id`);
  return item.account.id;
}

// Scans `items` (an already-narrowed `body.items` array) for the single
// entry whose account.id matches, re-asserting the record shape along the
// way rather than trusting extractListItemAccountId's return value alone —
// callers need the full item (to inspect .attention), not just its id.
function findListItemByAccountId(
  items: unknown[],
  accountId: string,
  context: string,
): Record<string, unknown> | undefined {
  for (const item of items) {
    assertIsRecord(item, context);
    assertIsRecord(item.account, `${context}.account`);
    if (item.account.id === accountId) return item;
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Ordering helpers
// ---------------------------------------------------------------------

// Anchored to real wall-clock time so fixtures from a later rerun always
// sort strictly ahead of fixtures left behind by an earlier rerun, and
// offset far into the future so this run's fixtures always sort ahead of
// any realistic pre-existing row. offsetMs orders several of one test's
// own fixtures relative to each other (equal offsets = an intentional
// tie).
const RUN_EPOCH_MS = Date.now();
const FAR_FUTURE_BASE_MS = Date.UTC(2100, 0, 1);
function runTimestamp(offsetMs = 0): Date {
  return new Date(FAR_FUTURE_BASE_MS + RUN_EPOCH_MS + offsetMs);
}

// attention_items.createdAt needs the opposite anchor from runTimestamp
// above: resolveOpenAttentionItem resolves through the real service, which
// sets resolved_at to Postgres's real now() — and
// attention_items_resolved_at_after_created_at requires resolved_at >=
// created_at. A createdAt anchored to runTimestamp's year-2100 future would
// always sort ahead of that real now(), tripping the constraint on every
// resolution. Anchored safely in the past instead, with the same
// offsetMs-orders-fixtures-relative-to-each-other contract as runTimestamp.
const PAST_ATTENTION_ITEM_BASE_MS = Date.UTC(2020, 0, 1);
function attentionItemCreatedAt(offsetMs = 0): Date {
  return new Date(PAST_ATTENTION_ITEM_BASE_MS + offsetMs);
}

// Derives two distinct, format-valid UUIDs from one fresh random UUID by
// overwriting only its leading hex digit — the most significant byte in
// Postgres's byte-wise uuid comparison — so higherId always sorts after
// lowerId. Every other character, including the v4 version/variant
// nibbles crypto.randomUUID() already placed, is untouched. Called fresh
// per tie-break fixture, never reused or fixed, so fixtures never collide
// across tests or reruns.
function makeOrderedIdPair(): { lowerId: string; higherId: string } {
  const base = crypto.randomUUID();
  return {
    lowerId: `0${base.slice(1)}`,
    higherId: `f${base.slice(1)}`,
  };
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

async function makeAccount(
  overrides: Partial<typeof schema.accounts.$inferInsert> = {},
) {
  const [account] = await db!
    .insert(schema.accounts)
    .values({
      accountKey: `dom:accounts-route-test-${RUN_ID}-${crypto.randomUUID()}.example`,
      updatedAt: runTimestamp(),
      ...overrides,
    })
    .returning();
  return account!;
}

async function makeSnapshot(accountId: string) {
  const [snapshot] = await db!
    .insert(schema.accountSnapshots)
    .values({
      accountId,
      source: "accounts-route-integration-test",
      rawInput: { raw: true },
      normalizedInput: {
        schemaVersion: "v1",
        company: {
          domain: "accounts-route-test.example",
          name: "Accounts Route Test Co",
          industry: null,
          employeeRange: null,
          revenueRange: null,
          region: "unknown",
          country: null,
        },
        engagement: {
          sources: [],
          pagesVisited: [],
          distinctSourceCount: 0,
          repeatVisit: false,
          lastSeenAt: null,
        },
        contact: {
          name: null,
          email: "accounts-route-test@example.test",
          phone: null,
          title: null,
          linkedinUrl: null,
          origin: "form_submit",
        },
        crm: {
          hubspotCompanyId: null,
          hubspotContactId: null,
          hubspotOwner: null,
          openOpportunity: false,
          existingCustomer: false,
          competitorFlag: false,
          partnerFlag: false,
        },
        doNotContact: false,
        consent: {
          email: "unknown",
          call: "unknown",
          liBasisCleared: "unknown",
          dpoVoiceCleared: "unknown",
        },
        source: "accounts-route-integration-test",
      },
      schemaVersion: "v1",
    })
    .returning();
  return snapshot!;
}

async function makeAccountWithSnapshot(
  overrides: Partial<typeof schema.accounts.$inferInsert> = {},
) {
  const account = await makeAccount(overrides);
  const snapshot = await makeSnapshot(account.id);
  return { account, snapshot };
}

function syntheticProfileConfig() {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "has_domain",
          description: "Has a domain",
          points: 10,
          condition: { op: "exists", field: "company.domain" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

async function makeProfile() {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `accounts-route-test-profile-${RUN_ID}` })
    .returning();
  return profile!;
}

// Publishing is insert-then-update: insert as a draft, then UPDATE
// status -> 'published' with published_at set in the same statement —
// the one mutation icp_profile_versions ever permits (the
// immutable-after-publish trigger only rejects mutations once
// OLD.status is already 'published').
async function makePublishedVersion(profileId: string) {
  const [draft] = await db!
    .insert(schema.icpProfileVersions)
    .values({ profileId, versionNumber: 1, config: syntheticProfileConfig() })
    .returning();
  const [published] = await db!
    .update(schema.icpProfileVersions)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(schema.icpProfileVersions.id, draft!.id))
    .returning();
  return published!;
}

// evaluator_versions.version is UNIQUE — get-or-create so repeated test
// runs against the same database don't collide.
async function getOrCreateCanonicalEvaluatorVersion() {
  const [inserted] = await db!
    .insert(schema.evaluatorVersions)
    .values({ version: "canonical-v1" })
    .onConflictDoNothing({ target: schema.evaluatorVersions.version })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db!
    .select()
    .from(schema.evaluatorVersions)
    .where(eq(schema.evaluatorVersions.version, "canonical-v1"))
    .limit(1);
  if (!existing)
    throw new Error(
      "getOrCreateCanonicalEvaluatorVersion: insert conflicted but no existing row was found",
    );
  return existing;
}

// The evaluator version and published profile version are incidental to
// every test below — created once, lazily, and reused by every
// evaluation fixture instead of re-created per test.
interface SharedEvaluationContext {
  evaluatorVersionId: string;
  profileVersionId: string;
}
let sharedContextPromise: Promise<SharedEvaluationContext> | undefined;
function getSharedEvaluationContext(): Promise<SharedEvaluationContext> {
  if (!sharedContextPromise) {
    sharedContextPromise = (async () => {
      const evaluatorVersion = await getOrCreateCanonicalEvaluatorVersion();
      const profile = await makeProfile();
      const publishedVersion = await makePublishedVersion(profile.id);
      return {
        evaluatorVersionId: evaluatorVersion.id,
        profileVersionId: publishedVersion.id,
      };
    })();
  }
  return sharedContextPromise;
}

// A full "completed" row by default. 'production' is legal here because
// profileVersionId always points at the shared *published* version above
// (preview evaluations may also legally reference a published version,
// so sharing it across both modes is fine).
async function makeEvaluation(
  args: {
    accountId: string;
    snapshotId: string;
    evaluationMode: "preview" | "production";
  },
  overrides: Partial<typeof schema.accountEvaluations.$inferInsert> = {},
) {
  const { evaluatorVersionId, profileVersionId } =
    await getSharedEvaluationContext();
  const [evaluation] = await db!
    .insert(schema.accountEvaluations)
    .values({
      accountId: args.accountId,
      snapshotId: args.snapshotId,
      profileVersionId,
      evaluatorVersionId,
      evaluationMode: args.evaluationMode,
      status: "completed",
      fitScore: "10",
      fitTier: "high",
      intentScore: "5",
      intentTier: "warm",
      identityResolutionLevel: "contact",
      identityConfidence: "high",
      actionabilityScore: "3",
      eligibilityOutcome: "eligible",
      eligibilityRestrictions: [],
      hardDisqualifiers: [],
      scoreComponents: [],
      matchedRules: [],
      missingInputs: [],
      profileConfigSnapshot: syntheticProfileConfig(),
      ...overrides,
    })
    .returning();
  return evaluation!;
}

// Inserted directly (not via ../services/attentionItems.ts's
// createAttentionItem) so createdAt is controllable per fixture — the same
// reasoning makeEvaluation above already applies to its own createdAt
// overrides. reasonCode defaults to a fresh, already-canonical-form
// (lowercase, no whitespace) value per call so unrelated fixtures never
// collide against attention_items_open_dedup_without_ref_uq.
async function makeOpenAttentionItem(
  accountId: string,
  overrides: Partial<typeof schema.attentionItems.$inferInsert> = {},
) {
  const [item] = await db!
    .insert(schema.attentionItems)
    .values({
      accountId,
      reasonCode: `accounts-route-test-reason-${crypto.randomUUID()}`,
      source: "manual",
      createdBy: `accounts-route-test-${RUN_ID}`,
      createdAt: attentionItemCreatedAt(),
      ...overrides,
    })
    .returning();
  return item!;
}

// Resolution DOES go through the real service (unlike creation above) —
// the lifecycle trigger only permits one exact UPDATE shape, and
// resolveAttentionItem already performs it correctly; there's no fixture
// value worth hand-controlling here the way createdAt is above.
async function resolveOpenAttentionItem(attentionItemId: string) {
  const result = await resolveAttentionItem({
    db: db!,
    attentionItemId,
    resolvedBy: `accounts-route-test-${RUN_ID}`,
    resolutionReason: "resolved by accounts-route integration test",
  });
  if (result.kind !== "resolved") {
    throw new Error(
      `resolveOpenAttentionItem: expected kind "resolved", got "${result.kind}"`,
    );
  }
  return result.item;
}

// ---------------------------------------------------------------------
// Scoped counts — never a bare `count(*) FROM table`, since this
// database is shared and never cleaned up. Every count is scoped to this
// test's own fixture id(s).
// ---------------------------------------------------------------------

async function countAccountsById(accountId: string): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId));
  return Number(row?.value ?? 0);
}

async function countAccountSnapshotsByAccountId(
  accountId: string,
): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountSnapshots)
    .where(eq(schema.accountSnapshots.accountId, accountId));
  return Number(row?.value ?? 0);
}

async function countAccountEvaluationsByAccountId(
  accountId: string,
): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountEvaluations)
    .where(eq(schema.accountEvaluations.accountId, accountId));
  return Number(row?.value ?? 0);
}

async function countAccountDecisionsByEvaluationId(
  evaluationId: string,
): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountDecisions)
    .where(eq(schema.accountDecisions.accountEvaluationId, evaluationId));
  return Number(row?.value ?? 0);
}

async function countAttentionItemsByAccountId(
  accountId: string,
): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.attentionItems)
    .where(eq(schema.attentionItems.accountId, accountId));
  return Number(row?.value ?? 0);
}

function buildApp(): Express {
  const app = express();
  app.use("/", createAccountsRouter({ db: db! }));
  return app;
}

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = buildApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

// ---------------------------------------------------------------------
// GET / — list
// ---------------------------------------------------------------------

test(
  "GET / returns an inserted canonical account with a correctly shaped pagination block",
  { skip },
  async () => {
    const { account } = await makeAccountWithSnapshot();

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?limit=100&offset=0`);
      const body = await readRecord(
        res,
        "GET /?limit=100&offset=0 response body",
      );

      assert.equal(res.status, 200);
      assertIsArray(body.items, "response body.items");
      assertIsRecord(body.pagination, "response body.pagination");
      assert.equal(body.pagination.limit, 100);
      assert.equal(body.pagination.offset, 0);
      assertIsNumber(body.pagination.total, "response body.pagination.total");
      assert.ok(body.pagination.total >= 1);

      const match = body.items.find(
        (item) =>
          extractListItemAccountId(item, "response body.items[]") ===
          account.id,
      );
      assert.ok(match, "the inserted account must appear in the list");
      assertIsRecord(match, "matching list item");
      assert.deepEqual(match.account, JSON.parse(JSON.stringify(account)));
    });
  },
);

test(
  "GET / orders accounts by updatedAt desc, breaking ties by id desc",
  { skip },
  async () => {
    const older = await makeAccount({ updatedAt: runTimestamp(0) });
    const { lowerId, higherId } = makeOrderedIdPair();
    const tieLow = await makeAccount({
      id: lowerId,
      updatedAt: runTimestamp(60_000),
    });
    const tieHigh = await makeAccount({
      id: higherId,
      updatedAt: runTimestamp(60_000),
    });
    const fixtureIds = new Set([older.id, tieLow.id, tieHigh.id]);

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?limit=100&offset=0`);
      assert.equal(res.status, 200);
      const body = await readRecord(
        res,
        "GET /?limit=100&offset=0 response body",
      );
      assertIsArray(body.items, "response body.items");

      const relevantIds = body.items
        .map((item, idx) =>
          extractListItemAccountId(item, `response body.items[${idx}]`),
        )
        .filter((id) => fixtureIds.has(id));

      assert.deepEqual(relevantIds, [tieHigh.id, tieLow.id, older.id]);
    });
  },
);

test(
  "GET / latestEvaluation picks the single newest evaluation, breaking createdAt ties by id desc",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "preview",
      },
      { createdAt: new Date("2031-01-01T00:00:00Z") },
    );
    const { lowerId, higherId } = makeOrderedIdPair();
    await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "preview",
      },
      { id: lowerId, createdAt: new Date("2031-02-01T00:00:00Z") },
    );
    const tieWinner = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "preview",
      },
      { id: higherId, createdAt: new Date("2031-02-01T00:00:00Z") },
    );

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?limit=100&offset=0`);
      const body = await readRecord(
        res,
        "GET /?limit=100&offset=0 response body",
      );
      assertIsArray(body.items, "response body.items");

      const match = body.items.find(
        (item) =>
          extractListItemAccountId(item, "response body.items[]") ===
          account.id,
      );
      assert.ok(match, "the fixture account must appear in the list");
      assertIsRecord(match, "matching list item");
      assertIsRecord(
        match.latestEvaluation,
        "matching list item.latestEvaluation",
      );
      assert.equal(match.latestEvaluation.id, tieWinner.id);
    });
  },
);

test(
  "GET / latestProductionEvaluation independently tracks the newest production evaluation, even when a newer preview evaluation becomes latestEvaluation",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "production",
      },
      { createdAt: new Date("2031-01-01T00:00:00Z") },
    );
    const newestProduction = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "production",
      },
      { createdAt: new Date("2031-02-01T00:00:00Z") },
    );
    const newestOverall = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "preview",
      },
      { createdAt: new Date("2031-03-01T00:00:00Z") },
    );

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?limit=100&offset=0`);
      const body = await readRecord(
        res,
        "GET /?limit=100&offset=0 response body",
      );
      assertIsArray(body.items, "response body.items");

      const match = body.items.find(
        (item) =>
          extractListItemAccountId(item, "response body.items[]") ===
          account.id,
      );
      assert.ok(match, "the fixture account must appear in the list");
      assertIsRecord(match, "matching list item");
      assertIsRecord(
        match.latestEvaluation,
        "matching list item.latestEvaluation",
      );
      assertIsRecord(
        match.latestProductionEvaluation,
        "matching list item.latestProductionEvaluation",
      );
      assert.equal(match.latestEvaluation.id, newestOverall.id);
      assert.equal(match.latestProductionEvaluation.id, newestProduction.id);
    });
  },
);

test(
  "GET / when the newest evaluation is production, latestEvaluation and latestProductionEvaluation are the same row, and list summaries omit every JSONB payload field from both",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/?limit=100&offset=0`);
      const body = await readRecord(
        res,
        "GET /?limit=100&offset=0 response body",
      );
      assertIsArray(body.items, "response body.items");

      const match = body.items.find(
        (item) =>
          extractListItemAccountId(item, "response body.items[]") ===
          account.id,
      );
      assert.ok(match, "the fixture account must appear in the list");
      assertIsRecord(match, "matching list item");
      assertIsRecord(
        match.latestEvaluation,
        "matching list item.latestEvaluation",
      );
      assertIsRecord(
        match.latestProductionEvaluation,
        "matching list item.latestProductionEvaluation",
      );
      assert.equal(match.latestEvaluation.id, evaluation.id);
      assert.equal(match.latestProductionEvaluation.id, evaluation.id);

      const forbiddenKeys = [
        "profileConfigSnapshot",
        "eligibilityRestrictions",
        "hardDisqualifiers",
        "scoreComponents",
        "matchedRules",
        "missingInputs",
      ];
      const summaries: Array<[string, Record<string, unknown>]> = [
        ["latestEvaluation", match.latestEvaluation],
        ["latestProductionEvaluation", match.latestProductionEvaluation],
      ];
      for (const [fieldName, summary] of summaries) {
        for (const forbiddenKey of forbiddenKeys) {
          assert.equal(
            forbiddenKey in summary,
            false,
            `list summary ${fieldName} must not include ${forbiddenKey}`,
          );
        }
      }
    });
  },
);

// ---------------------------------------------------------------------
// GET / — needsAttention
// ---------------------------------------------------------------------

test(
  "GET / with no open attention items: the account appears in the default list with attention: null, and is excluded from needsAttention=true",
  { skip },
  async () => {
    const { account } = await makeAccountWithSnapshot();

    await withServer(async (baseUrl) => {
      const defaultRes = await fetch(`${baseUrl}/?limit=100&offset=0`);
      assert.equal(defaultRes.status, 200);
      const defaultBody = await readRecord(
        defaultRes,
        "GET /?limit=100&offset=0 response body",
      );
      assertIsArray(defaultBody.items, "response body.items");
      const defaultMatch = findListItemByAccountId(
        defaultBody.items,
        account.id,
        "response body.items[]",
      );
      assert.ok(defaultMatch, "the account must appear in the default list");
      assert.equal(defaultMatch.attention, null);

      const attentionRes = await fetch(
        `${baseUrl}/?needsAttention=true&limit=100&offset=0`,
      );
      assert.equal(attentionRes.status, 200);
      const attentionBody = await readRecord(
        attentionRes,
        "GET /?needsAttention=true&limit=100&offset=0 response body",
      );
      assertIsArray(attentionBody.items, "response body.items");
      const attentionMatch = findListItemByAccountId(
        attentionBody.items,
        account.id,
        "response body.items[]",
      );
      assert.equal(
        attentionMatch,
        undefined,
        "an account with no open attention items must not appear in needsAttention=true",
      );
    });
  },
);

test(
  "GET / with only a resolved attention item: the account still appears in the default list with attention: null, and is excluded from needsAttention=true",
  { skip },
  async () => {
    const { account } = await makeAccountWithSnapshot();
    const item = await makeOpenAttentionItem(account.id);
    await resolveOpenAttentionItem(item.id);

    await withServer(async (baseUrl) => {
      const defaultRes = await fetch(`${baseUrl}/?limit=100&offset=0`);
      const defaultBody = await readRecord(
        defaultRes,
        "GET /?limit=100&offset=0 response body",
      );
      assertIsArray(defaultBody.items, "response body.items");
      const defaultMatch = findListItemByAccountId(
        defaultBody.items,
        account.id,
        "response body.items[]",
      );
      assert.ok(defaultMatch, "the account must appear in the default list");
      assert.equal(defaultMatch.attention, null);

      const attentionRes = await fetch(
        `${baseUrl}/?needsAttention=true&limit=100&offset=0`,
      );
      const attentionBody = await readRecord(
        attentionRes,
        "GET /?needsAttention=true&limit=100&offset=0 response body",
      );
      assertIsArray(attentionBody.items, "response body.items");
      const attentionMatch = findListItemByAccountId(
        attentionBody.items,
        account.id,
        "response body.items[]",
      );
      assert.equal(
        attentionMatch,
        undefined,
        "an account whose only attention item is resolved must not appear in needsAttention=true",
      );
    });
  },
);

test(
  "GET / needsAttention=true returns exactly one row for an account with multiple open attention items, with a correct openCount/oldestOpenAttentionAt/reasonCodes summary",
  { skip },
  async () => {
    const { account } = await makeAccountWithSnapshot();
    // Inserted deliberately out of alphabetical order — the oldest
    // (lowest createdAt) item sorts last alphabetically, so a correct
    // response can only match if reasonCodes is genuinely sorted
    // ascending rather than incidentally returned in insertion or
    // createdAt order.
    const oldest = await makeOpenAttentionItem(account.id, {
      reasonCode: `zzz-late-alpha-${crypto.randomUUID()}`,
      createdAt: attentionItemCreatedAt(1_000),
    });
    const second = await makeOpenAttentionItem(account.id, {
      reasonCode: `aaa-early-alpha-${crypto.randomUUID()}`,
      createdAt: attentionItemCreatedAt(2_000),
    });
    const third = await makeOpenAttentionItem(account.id, {
      reasonCode: `mmm-mid-alpha-${crypto.randomUUID()}`,
      createdAt: attentionItemCreatedAt(3_000),
    });
    const expectedReasonCodes = [
      second.reasonCode,
      third.reasonCode,
      oldest.reasonCode,
    ].sort();

    await withServer(async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/?needsAttention=true&limit=100&offset=0`,
      );
      const body = await readRecord(
        res,
        "GET /?needsAttention=true&limit=100&offset=0 response body",
      );
      assertIsArray(body.items, "response body.items");

      const matches = body.items.filter(
        (item) =>
          extractListItemAccountId(item, "response body.items[]") ===
          account.id,
      );
      assert.equal(
        matches.length,
        1,
        "an account with multiple open items must appear exactly once",
      );

      const match = matches[0];
      assertIsRecord(match, "matching list item");
      assertIsRecord(match.attention, "matching list item.attention");
      assert.equal(match.attention.openCount, 3);
      assertIsString(
        match.attention.oldestOpenAttentionAt,
        "matching list item.attention.oldestOpenAttentionAt",
      );
      assert.equal(
        match.attention.oldestOpenAttentionAt,
        oldest.createdAt.toISOString(),
      );
      assert.deepEqual(match.attention.reasonCodes, expectedReasonCodes);
    });
  },
);

test(
  "GET / needsAttention=true collapses two open items that share the same reasonCode (but differ in source) into one distinct entry",
  { skip },
  async () => {
    const { account } = await makeAccountWithSnapshot();
    // Same reasonCode on purpose — this is what array_agg(DISTINCT ...)
    // in ./accounts.ts's listAccounts must collapse. Different `source`
    // values keep both rows legal under both partial dedup unique
    // indexes (attention_items_open_dedup_with_ref_uq /
    // _without_ref_uq are scoped to (account, reasonCode, source[,
    // sourceRef]) — differing source means neither index's key
    // collides), so both open items coexist for real, rather than one
    // insert failing.
    const sharedReasonCode = `shared-reason-${crypto.randomUUID()}`;
    const oldest = await makeOpenAttentionItem(account.id, {
      reasonCode: sharedReasonCode,
      source: "manual",
      createdAt: attentionItemCreatedAt(1_000),
    });
    await makeOpenAttentionItem(account.id, {
      reasonCode: sharedReasonCode,
      source: "identity_resolution",
      createdAt: attentionItemCreatedAt(2_000),
    });

    await withServer(async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/?needsAttention=true&limit=100&offset=0`,
      );
      const body = await readRecord(
        res,
        "GET /?needsAttention=true&limit=100&offset=0 response body",
      );
      assertIsArray(body.items, "response body.items");

      const matches = body.items.filter(
        (item) =>
          extractListItemAccountId(item, "response body.items[]") ===
          account.id,
      );
      assert.equal(
        matches.length,
        1,
        "an account with two same-reasonCode open items must still appear exactly once",
      );

      const match = matches[0];
      assertIsRecord(match, "matching list item");
      assertIsRecord(match.attention, "matching list item.attention");
      assert.equal(match.attention.openCount, 2);
      assertIsString(
        match.attention.oldestOpenAttentionAt,
        "matching list item.attention.oldestOpenAttentionAt",
      );
      assert.equal(
        match.attention.oldestOpenAttentionAt,
        oldest.createdAt.toISOString(),
      );
      assert.deepEqual(match.attention.reasonCodes, [sharedReasonCode]);
    });
  },
);

test(
  "GET / resolving one of multiple open attention items updates the summary but keeps the account in needsAttention=true",
  { skip },
  async () => {
    const { account } = await makeAccountWithSnapshot();
    const toResolve = await makeOpenAttentionItem(account.id, {
      reasonCode: `resolve-me-${crypto.randomUUID()}`,
      createdAt: attentionItemCreatedAt(1_000),
    });
    const remaining = await makeOpenAttentionItem(account.id, {
      reasonCode: `stay-open-${crypto.randomUUID()}`,
      createdAt: attentionItemCreatedAt(2_000),
    });
    await resolveOpenAttentionItem(toResolve.id);

    await withServer(async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/?needsAttention=true&limit=100&offset=0`,
      );
      const body = await readRecord(
        res,
        "GET /?needsAttention=true&limit=100&offset=0 response body",
      );
      assertIsArray(body.items, "response body.items");
      const match = findListItemByAccountId(
        body.items,
        account.id,
        "response body.items[]",
      );
      assert.ok(
        match,
        "the account must still appear in needsAttention=true — one item remains open",
      );
      assertIsRecord(match.attention, "matching list item.attention");
      assert.equal(match.attention.openCount, 1);
      assert.deepEqual(match.attention.reasonCodes, [remaining.reasonCode]);
      assert.equal(
        match.attention.oldestOpenAttentionAt,
        remaining.createdAt.toISOString(),
      );
    });

    // Both rows — one resolved, one still open — remain: resolving never
    // deletes attention_items history.
    assert.equal(await countAttentionItemsByAccountId(account.id), 2);
  },
);

test(
  "GET / resolving the final open attention item removes the account from needsAttention=true only, and preserves the canonical account and every historical attention row",
  { skip },
  async () => {
    const { account } = await makeAccountWithSnapshot();
    const item = await makeOpenAttentionItem(account.id);
    await resolveOpenAttentionItem(item.id);

    await withServer(async (baseUrl) => {
      const attentionRes = await fetch(
        `${baseUrl}/?needsAttention=true&limit=100&offset=0`,
      );
      const attentionBody = await readRecord(
        attentionRes,
        "GET /?needsAttention=true&limit=100&offset=0 response body",
      );
      assertIsArray(attentionBody.items, "response body.items");
      assert.equal(
        findListItemByAccountId(
          attentionBody.items,
          account.id,
          "response body.items[]",
        ),
        undefined,
        "resolving the only open item must remove the account from needsAttention=true",
      );

      const defaultRes = await fetch(`${baseUrl}/?limit=100&offset=0`);
      const defaultBody = await readRecord(
        defaultRes,
        "GET /?limit=100&offset=0 response body",
      );
      assertIsArray(defaultBody.items, "response body.items");
      const defaultMatch = findListItemByAccountId(
        defaultBody.items,
        account.id,
        "response body.items[]",
      );
      assert.ok(
        defaultMatch,
        "the account must still appear in the default (All Accounts) list",
      );
      assert.equal(defaultMatch.attention, null);
    });

    assert.equal(await countAccountsById(account.id), 1);
    assert.equal(await countAttentionItemsByAccountId(account.id), 1);
  },
);

test(
  "GET / needsAttention=true pagination.total reflects only accounts with at least one open attention item",
  { skip },
  async () => {
    async function fetchNeedsAttentionTotal(baseUrl: string): Promise<number> {
      const res = await fetch(
        `${baseUrl}/?needsAttention=true&limit=1&offset=0`,
      );
      assert.equal(res.status, 200);
      const body = await readRecord(
        res,
        "GET /?needsAttention=true&limit=1&offset=0 response body",
      );
      assertIsRecord(body.pagination, "response body.pagination");
      assertIsNumber(body.pagination.total, "response body.pagination.total");
      return body.pagination.total;
    }

    await withServer(async (baseUrl) => {
      const totalBefore = await fetchNeedsAttentionTotal(baseUrl);

      // An account with no open attention item must not move the total.
      await makeAccountWithSnapshot();
      const totalAfterNonMatching = await fetchNeedsAttentionTotal(baseUrl);
      assert.equal(totalAfterNonMatching, totalBefore);

      // An account with one open attention item must move the total by
      // exactly one — proving the count query applies the same EXISTS
      // filter the page query does, not an unfiltered accounts count.
      const { account: matchingAccount } = await makeAccountWithSnapshot();
      await makeOpenAttentionItem(matchingAccount.id);
      const totalAfterMatching = await fetchNeedsAttentionTotal(baseUrl);
      assert.equal(totalAfterMatching, totalBefore + 1);
    });
  },
);

test(
  "GET / needsAttention=true preserves updatedAt desc, id desc ordering",
  { skip },
  async () => {
    const older = await makeAccount({ updatedAt: runTimestamp(0) });
    await makeOpenAttentionItem(older.id);
    const { lowerId, higherId } = makeOrderedIdPair();
    const tieLow = await makeAccount({
      id: lowerId,
      updatedAt: runTimestamp(60_000),
    });
    await makeOpenAttentionItem(tieLow.id);
    const tieHigh = await makeAccount({
      id: higherId,
      updatedAt: runTimestamp(60_000),
    });
    await makeOpenAttentionItem(tieHigh.id);
    const fixtureIds = new Set([older.id, tieLow.id, tieHigh.id]);

    await withServer(async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/?needsAttention=true&limit=100&offset=0`,
      );
      assert.equal(res.status, 200);
      const body = await readRecord(
        res,
        "GET /?needsAttention=true&limit=100&offset=0 response body",
      );
      assertIsArray(body.items, "response body.items");

      const relevantIds = body.items
        .map((item, idx) =>
          extractListItemAccountId(item, `response body.items[${idx}]`),
        )
        .filter((id) => fixtureIds.has(id));

      assert.deepEqual(relevantIds, [tieHigh.id, tieLow.id, older.id]);
    });
  },
);

// ---------------------------------------------------------------------
// GET /:accountId — detail
// ---------------------------------------------------------------------

test(
  "GET /:accountId returns the exact persisted account row",
  { skip },
  async () => {
    const { account } = await makeAccountWithSnapshot({
      companyDomain: "detail-test.example",
      companyName: "Detail Test Co",
    });

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/${account.id}`);
      const body = await readRecord(res, "GET /:accountId response body");

      assert.equal(res.status, 200);
      assert.deepEqual(body.account, JSON.parse(JSON.stringify(account)));
    });
  },
);

test(
  "GET /:accountId returns the exact persisted evaluation rows, ordered createdAt desc then id desc (with a genuine tie), and preserves JSONB fields",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const older = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "preview",
      },
      {
        createdAt: new Date("2031-01-01T00:00:00Z"),
        scoreComponents: [{ rule: "older", points: 1 }],
        matchedRules: ["older-rule"],
        missingInputs: ["older-missing"],
        profileConfigSnapshot: { configSchemaVersion: "v1", marker: "older" },
      },
    );
    const { lowerId, higherId } = makeOrderedIdPair();
    const tieLow = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "preview",
      },
      {
        id: lowerId,
        createdAt: new Date("2031-02-01T00:00:00Z"),
        scoreComponents: [{ rule: "tie-low", points: 3 }],
        matchedRules: ["tie-low-rule"],
        missingInputs: ["tie-low-missing"],
        profileConfigSnapshot: {
          configSchemaVersion: "v1",
          marker: "tie-low",
        },
      },
    );
    const tieHigh = await makeEvaluation(
      {
        accountId: account.id,
        snapshotId: snapshot.id,
        evaluationMode: "preview",
      },
      {
        id: higherId,
        createdAt: new Date("2031-02-01T00:00:00Z"),
        scoreComponents: [{ rule: "tie-high", points: 5 }],
        matchedRules: ["tie-high-rule"],
        missingInputs: ["tie-high-missing"],
        profileConfigSnapshot: {
          configSchemaVersion: "v1",
          marker: "tie-high",
        },
      },
    );

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/${account.id}`);
      const body = await readRecord(res, "GET /:accountId response body");

      assert.equal(res.status, 200);
      // mqlDecisionReadiness is getAccountById's one derived addition on
      // top of the exact persisted row (see services/accounts.ts's
      // AccountEvaluationDetail) — computed here via the real
      // deriveMqlDecisionReadiness, the same function and inputs
      // getAccountById itself uses, rather than a hand-guessed literal.
      const expectedEvaluations = [tieHigh, tieLow, older].map((row) => ({
        ...row,
        mqlDecisionReadiness: deriveMqlDecisionReadiness(row, snapshot),
      }));
      assert.deepEqual(
        body.evaluations,
        JSON.parse(JSON.stringify(expectedEvaluations)),
      );
    });
  },
);

test(
  "GET /:accountId returns 404 account_not_found for a well-formed UUID with no matching account",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/${crypto.randomUUID()}`);
      const body = await readRecord(res, "GET /:accountId 404 response body");

      assert.equal(res.status, 404);
      assert.equal(body.code, "account_not_found");
    });
  },
);

// ---------------------------------------------------------------------
// Read-only guarantee
// ---------------------------------------------------------------------

test(
  "GET / and GET /:accountId never modify this fixture's accounts, account_snapshots, account_evaluations, or account_decisions rows",
  { skip },
  async () => {
    const { account, snapshot } = await makeAccountWithSnapshot();
    const evaluation = await makeEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      evaluationMode: "production",
    });

    const accountsBefore = await countAccountsById(account.id);
    const snapshotsBefore = await countAccountSnapshotsByAccountId(account.id);
    const evaluationsBefore = await countAccountEvaluationsByAccountId(
      account.id,
    );
    const decisionsBefore = await countAccountDecisionsByEvaluationId(
      evaluation.id,
    );

    await withServer(async (baseUrl) => {
      const listRes = await fetch(`${baseUrl}/?limit=100&offset=0`);
      assert.equal(listRes.status, 200);
      const detailRes = await fetch(`${baseUrl}/${account.id}`);
      assert.equal(detailRes.status, 200);
      const notFoundRes = await fetch(`${baseUrl}/${crypto.randomUUID()}`);
      assert.equal(notFoundRes.status, 404);
      const invalidRes = await fetch(`${baseUrl}/not-a-uuid`);
      assert.equal(invalidRes.status, 400);
    });

    assert.equal(await countAccountsById(account.id), accountsBefore);
    assert.equal(
      await countAccountSnapshotsByAccountId(account.id),
      snapshotsBefore,
    );
    assert.equal(
      await countAccountEvaluationsByAccountId(account.id),
      evaluationsBefore,
    );
    assert.equal(
      await countAccountDecisionsByEvaluationId(evaluation.id),
      decisionsBefore,
    );

    const [evaluationRow] = await db!
      .select()
      .from(schema.accountEvaluations)
      .where(eq(schema.accountEvaluations.id, evaluation.id))
      .limit(1);
    assert.deepEqual(evaluationRow, evaluation);
  },
);

test.after(async () => {
  await pool?.end();
});
