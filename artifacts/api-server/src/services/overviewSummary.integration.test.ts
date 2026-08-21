// LS6 -- integration tests for ./overviewSummary.ts against a real,
// migrated Postgres instance: real getOverviewMetrics/getOverviewCharts/
// getGlobalRecentActivity reads feeding real fact assembly. The model
// call itself is ALWAYS mocked via requestChatCompletionFn -- this file
// never makes a live DeepSeek API call and never requires
// DEEPSEEK_API_KEY, per this task's own "do not make live paid model
// calls in automated tests" instruction. The one exception (by
// necessity) is the "not configured" test, which intentionally leaves
// DEEPSEEK_API_KEY unset and asserts the real client's own
// not-configured short-circuit fires before any network attempt.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/overviewSummary.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getOverviewSummary, OverviewSummaryUnavailableError } from "./overviewSummary.js";
import type { DeepSeekChatCompletionArgs } from "../lib/deepseekClient.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function addObservation(args: { provider: string; importedAt: Date }): Promise<void> {
  await db!.insert(schema.observations).values({
    provider: args.provider,
    sourceRecordId: crypto.randomUUID(),
    observationClass: "behavioral_signal",
    semanticKey: "page_view",
    identitySubjectType: null,
    identityValue: null,
    rawValue: { page_visited: "/pricing" },
    normalizedValue: null,
    observedAt: null,
    importedAt: args.importedAt,
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
  });
}

function mockChatCompletion(summaryJson: unknown): (args: DeepSeekChatCompletionArgs) => Promise<string> {
  return async () => JSON.stringify(summaryJson);
}

const FIXED_NOW = new Date("2026-08-21T12:00:00Z");

test("getOverviewSummary throws OverviewSummaryUnavailableError with reason not_configured when DEEPSEEK_API_KEY is unset -- no network attempt needed", { skip }, async () => {
  const original = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(
      () => getOverviewSummary({ db: db!, now: FIXED_NOW }),
      (err: unknown) =>
        err instanceof OverviewSummaryUnavailableError && err.reason === "not_configured",
    );
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = original;
  }
});

test("getOverviewSummary returns a grounded summary built from real canonical data, via a mocked model call", { skip }, async () => {
  const provider = `test-summary-${crypto.randomUUID()}`;
  await addObservation({ provider, importedAt: FIXED_NOW });

  const requestChatCompletionFn = mockChatCompletion({
    summary: "Observations were captured in the last 7 calendar days.",
    factsUsed: ["observationsCaptured"],
  });

  const result = await getOverviewSummary({
    db: db!,
    now: FIXED_NOW,
    requestChatCompletionFn,
  });

  assert.equal(result.summary, "Observations were captured in the last 7 calendar days.");
  assert.deepEqual(result.factsUsed, ["observationsCaptured"]);
  assert.equal(result.timeframe.days, 7);
  assert.equal(result.generatedAt, FIXED_NOW.toISOString());
});

test("getOverviewSummary rejects (throws OverviewSummaryUnavailableError) when the mocked model returns an ungrounded number, even against real data", { skip }, async () => {
  const requestChatCompletionFn = mockChatCompletion({
    summary: "999999 observations were captured this week.",
    factsUsed: ["observationsCaptured"],
  });

  await assert.rejects(
    () => getOverviewSummary({ db: db!, now: FIXED_NOW, requestChatCompletionFn }),
    (err: unknown) => err instanceof OverviewSummaryUnavailableError && err.reason === "ungrounded",
  );
});

test("getOverviewSummary rejects when the mocked model returns forbidden interpretive language, even against real data", { skip }, async () => {
  const requestChatCompletionFn = mockChatCompletion({
    summary: "This account is showing strong buying intent.",
    factsUsed: [],
  });

  await assert.rejects(
    () => getOverviewSummary({ db: db!, now: FIXED_NOW, requestChatCompletionFn }),
    (err: unknown) =>
      err instanceof OverviewSummaryUnavailableError && err.reason === "forbidden_language",
  );
});

test("getOverviewSummary handles a genuinely zero-data window truthfully end to end", { skip }, async () => {
  // A window far enough in the past/future from every other test's fixed
  // "now" in this shared-DB suite that no other test's rows land inside
  // it -- mirrors ./overviewCharts.integration.test.ts's own delta-based
  // isolation discipline, just via a distinct time window instead of a
  // distinct provider tag (metrics/charts aggregates are global, not
  // taggable per-test the way a provider string is).
  const isolatedNow = new Date("2019-01-07T00:00:00Z");
  const requestChatCompletionFn = mockChatCompletion({
    summary: "No observations were captured in the last 7 calendar days.",
    factsUsed: ["observationsCaptured"],
  });

  const result = await getOverviewSummary({
    db: db!,
    now: isolatedNow,
    requestChatCompletionFn,
  });

  assert.equal(result.summary, "No observations were captured in the last 7 calendar days.");
});

test.after(async () => {
  await pool?.end();
});
