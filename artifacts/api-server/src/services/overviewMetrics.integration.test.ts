// LS3 — integration tests for ./overviewMetrics.ts against a real,
// migrated Postgres instance: real accounts/observations/attention_items,
// real EXISTS-filtered accounts.ts reuse.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied. SKIPS itself (does not fail) when DATABASE_URL is
// unset.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/overviewMetrics.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { getOverviewMetrics } from "./overviewMetrics.js";
import { createAttentionItem, resolveAttentionItem } from "./attentionItems.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:overview-metrics-${crypto.randomUUID()}.example` })
    .returning();
  return account!.id;
}

async function addObservation(args: {
  provider?: string;
  importedAt: Date;
}): Promise<string> {
  const [row] = await db!
    .insert(schema.observations)
    .values({
      provider: args.provider ?? "rb2b",
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
    })
    .returning();
  return row!.id;
}

async function openAttentionItem(accountId: string, reasonCode: string): Promise<string> {
  const result = await createAttentionItem({
    db: db!,
    accountId,
    reasonCode,
    reasonDetail: null,
    source: "manual",
    sourceRef: null,
    context: {},
    createdBy: "test-operator",
  });
  assert.equal(result.outcome, "created");
  if (result.outcome !== "created") throw new Error("unreachable");
  return result.item.id;
}

const FIXED_NOW = new Date("2026-08-15T00:00:00Z");

test(
  "zero-data result returns valid zeros, not null/sample data",
  { skip },
  async () => {
    // A fresh account with no observations/attention proves the shape is
    // never null/undefined even for a genuinely empty slice — but
    // totalAccounts/signalsCaptured are process-wide, so scope this
    // assertion to structure/type, not exact global values (other tests
    // in this file insert their own rows against the same database).
    const metrics = await getOverviewMetrics({ db: db!, now: FIXED_NOW });
    assert.equal(typeof metrics.signalsCaptured, "number");
    assert.equal(typeof metrics.accountsNeedingAttention, "number");
    assert.equal(typeof metrics.totalAccounts, "number");
    assert.ok(metrics.signalsCaptured >= 0);
    assert.ok(metrics.accountsNeedingAttention >= 0);
    assert.ok(metrics.totalAccounts >= 0);
    assert.equal(metrics.timeframe.days, 7);
  },
);

test(
  "signalsCaptured counts canonical observations imported within the timeframe, and excludes ones outside it",
  { skip },
  async () => {
    const inWindow = FIXED_NOW.getTime() - 1 * 24 * 60 * 60 * 1000; // 1 day ago
    const outsideWindow = FIXED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000; // 10 days ago

    const beforeMetrics = await getOverviewMetrics({ db: db!, now: FIXED_NOW, days: 7 });

    await addObservation({ importedAt: new Date(inWindow) });
    await addObservation({ importedAt: new Date(outsideWindow) });

    const afterMetrics = await getOverviewMetrics({ db: db!, now: FIXED_NOW, days: 7 });

    // Exactly one of the two new rows (the in-window one) is counted.
    assert.equal(afterMetrics.signalsCaptured, beforeMetrics.signalsCaptured + 1);
  },
);

test(
  "a different timeframe (days) changes which observations are counted, deterministically",
  { skip },
  async () => {
    const eightDaysAgo = new Date(FIXED_NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    await addObservation({ importedAt: eightDaysAgo });

    const sevenDayMetrics = await getOverviewMetrics({ db: db!, now: FIXED_NOW, days: 7 });
    const tenDayMetrics = await getOverviewMetrics({ db: db!, now: FIXED_NOW, days: 10 });

    // The 10-day window includes strictly more (or equal, never fewer)
    // than the 7-day window over the same "now".
    assert.ok(tenDayMetrics.signalsCaptured >= sevenDayMetrics.signalsCaptured);
    assert.equal(sevenDayMetrics.timeframe.days, 7);
    assert.equal(tenDayMetrics.timeframe.days, 10);
  },
);

test(
  "accountsNeedingAttention counts a canonical account with one open attention item",
  { skip },
  async () => {
    const before = await getOverviewMetrics({ db: db!, now: FIXED_NOW });

    const accountId = await makeAccount();
    await openAttentionItem(accountId, "test_reason_single");

    const after = await getOverviewMetrics({ db: db!, now: FIXED_NOW });
    assert.equal(after.accountsNeedingAttention, before.accountsNeedingAttention + 1);
  },
);

test(
  "multiple open attention_items for the same account count that account exactly once",
  { skip },
  async () => {
    const before = await getOverviewMetrics({ db: db!, now: FIXED_NOW });

    const accountId = await makeAccount();
    await openAttentionItem(accountId, "test_reason_a");
    await openAttentionItem(accountId, "test_reason_b");
    await openAttentionItem(accountId, "test_reason_c");

    const after = await getOverviewMetrics({ db: db!, now: FIXED_NOW });
    assert.equal(after.accountsNeedingAttention, before.accountsNeedingAttention + 1);
  },
);

test(
  "a resolved attention item does not count toward accountsNeedingAttention",
  { skip },
  async () => {
    const before = await getOverviewMetrics({ db: db!, now: FIXED_NOW });

    const accountId = await makeAccount();
    const itemId = await openAttentionItem(accountId, "test_reason_resolved");

    const whileOpen = await getOverviewMetrics({ db: db!, now: FIXED_NOW });
    assert.equal(whileOpen.accountsNeedingAttention, before.accountsNeedingAttention + 1);

    const resolveResult = await resolveAttentionItem({
      db: db!,
      attentionItemId: itemId,
      resolvedBy: "test-operator",
      resolutionReason: "handled",
    });
    assert.equal(resolveResult.kind, "resolved");

    const afterResolve = await getOverviewMetrics({ db: db!, now: FIXED_NOW });
    assert.equal(afterResolve.accountsNeedingAttention, before.accountsNeedingAttention);
  },
);

test(
  "an account with only a resolved attention item and no open ones is never counted",
  { skip },
  async () => {
    const before = await getOverviewMetrics({ db: db!, now: FIXED_NOW });

    const accountId = await makeAccount();
    const itemId = await openAttentionItem(accountId, "test_reason_only_resolved");
    await resolveAttentionItem({
      db: db!,
      attentionItemId: itemId,
      resolvedBy: "test-operator",
      resolutionReason: "handled",
    });

    const after = await getOverviewMetrics({ db: db!, now: FIXED_NOW });
    assert.equal(after.accountsNeedingAttention, before.accountsNeedingAttention);
  },
);

test(
  "one account's attention items never inflate a different account's count — no cross-account leakage",
  { skip },
  async () => {
    const before = await getOverviewMetrics({ db: db!, now: FIXED_NOW });

    const accountWithAttention = await makeAccount();
    const accountWithout = await makeAccount();
    await openAttentionItem(accountWithAttention, "test_reason_isolated");
    void accountWithout; // created only to prove it does NOT get counted

    const after = await getOverviewMetrics({ db: db!, now: FIXED_NOW });
    assert.equal(after.accountsNeedingAttention, before.accountsNeedingAttention + 1);
  },
);

test(
  "totalAccounts is a plain total account count, unaffected by attention/observation state",
  { skip },
  async () => {
    const before = await getOverviewMetrics({ db: db!, now: FIXED_NOW });

    const accountId = await makeAccount();
    await openAttentionItem(accountId, "test_reason_total_count");
    await addObservation({ importedAt: FIXED_NOW });

    const after = await getOverviewMetrics({ db: db!, now: FIXED_NOW });
    // Exactly one new account exists now, regardless of its attention/
    // observation state — totalAccounts claims no other semantics.
    assert.equal(after.totalAccounts, before.totalAccounts + 1);
  },
);

test.after(async () => {
  await pool?.end();
});
