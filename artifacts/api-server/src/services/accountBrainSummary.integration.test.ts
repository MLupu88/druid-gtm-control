// Milestone 4B — integration tests for ./accountBrainSummary.ts against
// a real, migrated Postgres instance: real accountTruth/people/
// accountActivitySummary/accountClaims reads feeding real fact assembly.
// The model call itself is ALWAYS mocked via requestChatCompletionFn —
// this file never makes a live DeepSeek API call and never requires
// DEEPSEEK_API_KEY, mirroring ./overviewSummary.integration.test.ts's
// own discipline exactly. The one exception (by necessity) is the "not
// configured" test, which intentionally leaves DEEPSEEK_API_KEY unset.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/accountBrainSummary.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import {
  getAccountBrainSummary,
  analyzeAccountBrain,
  AccountNotFoundError,
} from "./accountBrainSummary.js";
import type { DeepSeekChatCompletionArgs } from "../lib/deepseekClient.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const RUN_ID = crypto.randomUUID();
const FIXED_NOW = new Date("2026-08-22T12:00:00Z");

async function makeAccount(overrides: Partial<typeof schema.accounts.$inferInsert> = {}) {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:brain-test-${RUN_ID}-${crypto.randomUUID()}.example`, ...overrides })
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

function mockChatCompletion(json: unknown): (args: DeepSeekChatCompletionArgs) => Promise<string> {
  return async () => JSON.stringify(json);
}

test("getAccountBrainSummary throws AccountNotFoundError for an unknown account", { skip }, async () => {
  await assert.rejects(() => getAccountBrainSummary(db!, crypto.randomUUID()), AccountNotFoundError);
});

test("getAccountBrainSummary composes real accountTruth/people/activitySummary/claims and never calls the model — narrative is always null", { skip }, async () => {
  const account = await makeAccount({ companyName: "Acme" });
  const person = await makePerson({ fullName: "Laura Berkey" });
  await db!.insert(schema.accountPeople).values({
    accountId: account.id,
    personId: person.id,
    title: "VP Sales",
    source: "rb2b",
  });

  const result = await getAccountBrainSummary(db!, account.id);
  // getAccountCanonicalTruth always returns all 11 canonical fields —
  // "unresolved" (no candidate evidence), never an empty array — see
  // ./accountTruth.ts's own module comment.
  assert.equal(result.accountTruth.length, 11);
  assert.ok(result.accountTruth.every((f) => f.resolutionState === "unresolved" && f.canonicalValue === null));
  assert.equal(result.people.length, 1);
  assert.equal(result.people[0]?.title, "VP Sales");
  assert.deepEqual(result.activitySummary, {
    totalEvents: 0,
    firstObservedAt: null,
    lastObservedAt: null,
    distinctDaysObserved: 0,
    providers: [],
  });
  assert.deepEqual(result.claims, []);
  assert.equal(result.narrative, null);
  assert.equal(result.narrativeUnavailableReason, null);
});

test("analyzeAccountBrain throws AccountBrainNarrativeUnavailableError-mapped reason not_configured when DEEPSEEK_API_KEY is unset, but still returns the rest of the summary", { skip }, async () => {
  const original = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const account = await makeAccount({ companyName: "Acme Unconfigured" });
    const result = await analyzeAccountBrain(db!, account.id, { now: FIXED_NOW });
    assert.equal(result.narrative, null);
    assert.equal(result.narrativeUnavailableReason, "not_configured");
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = original;
  }
});

test("analyzeAccountBrain returns a grounded narrative built from real canonical data, via a mocked model call", { skip }, async () => {
  const account = await makeAccount({ companyName: "Acme Grounded" });
  const person = await makePerson({ fullName: "Laura Berkey" });
  await db!.insert(schema.accountPeople).values({
    accountId: account.id,
    personId: person.id,
    title: "VP Sales",
    source: "rb2b",
  });

  const requestChatCompletionFn = mockChatCompletion({
    summary: "Acme Grounded has 1 person identified (VP Sales).",
    factsUsed: ["people"],
  });

  const result = await analyzeAccountBrain(db!, account.id, { now: FIXED_NOW, requestChatCompletionFn });
  assert.equal(result.narrative?.text, "Acme Grounded has 1 person identified (VP Sales).");
  assert.equal(result.narrative?.generatedAt, FIXED_NOW.toISOString());
  assert.equal(result.narrativeUnavailableReason, null);
  assert.equal(result.people.length, 1);
});

test("analyzeAccountBrain rejects (narrative: null, reason ungrounded) when the mocked model invents an unsupported fact, even against real data", { skip }, async () => {
  const account = await makeAccount({ companyName: "Acme Ungrounded" });

  const requestChatCompletionFn = mockChatCompletion({
    summary: "Acme Ungrounded is known to use Salesforce as its CRM.",
    factsUsed: [],
  });

  const result = await analyzeAccountBrain(db!, account.id, { now: FIXED_NOW, requestChatCompletionFn });
  assert.equal(result.narrative, null);
  assert.equal(result.narrativeUnavailableReason, "ungrounded");
});

test("analyzeAccountBrain rejects (narrative: null, reason forbidden_language) when the mocked model states DRUID relevance or Marketplace semantics, even against real data", { skip }, async () => {
  const account = await makeAccount({ companyName: "Acme Forbidden" });

  const requestChatCompletionFn = mockChatCompletion({
    summary: "Acme Forbidden is highly relevant to DRUID's Marketplace offering.",
    factsUsed: [],
  });

  const result = await analyzeAccountBrain(db!, account.id, { now: FIXED_NOW, requestChatCompletionFn });
  assert.equal(result.narrative, null);
  assert.equal(result.narrativeUnavailableReason, "forbidden_language");
});

test("analyzeAccountBrain never writes to account_claims — the 4B registry is empty, and the narrative itself is never persisted", { skip }, async () => {
  const account = await makeAccount({ companyName: "Acme No Writes" });
  const requestChatCompletionFn = mockChatCompletion({
    summary: "No activity has been observed for Acme No Writes.",
    factsUsed: ["activity"],
  });

  await analyzeAccountBrain(db!, account.id, { now: FIXED_NOW, requestChatCompletionFn });

  const claimRows = await db!
    .select()
    .from(schema.accountClaims)
    .where(eq(schema.accountClaims.accountId, account.id));
  assert.deepEqual(claimRows, []);
});

test.after(async () => {
  await pool?.end();
});
