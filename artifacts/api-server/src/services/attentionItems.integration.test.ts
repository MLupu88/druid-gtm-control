// Integration tests for ./attentionItems.ts's createAttentionItem —
// specifically its GTM V2 Stage 4, Unit 1 nested-transaction/savepoint
// safety: the function must behave identically whether called with the
// plain pool or with a caller's already-open transaction, and a
// dedup-conflict encountered while nested must never poison that outer
// transaction. See ../services/accountFacts.ts's recordAccountFact for
// the real caller this protects (the account-fact write and an
// evaluation_stale attention item must commit atomically).
//
// Exercised against a real, migrated Postgres instance — real db, the
// real partial unique indexes from lib/db/drizzle/0010_perpetual_wrecker.sql
// and the lifecycle trigger from
// lib/db/drizzle/0011_attention_items_lifecycle.sql. A fake queue-based db
// (see ./attentionItems.test.ts) cannot prove this: it has no real
// SAVEPOINT/ROLLBACK semantics to poison or recover from.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed against a real Postgres instance as part of this change (no
// database connection was made).
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/attentionItems.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { createAttentionItem } from "./attentionItems.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({
      accountKey: `dom:attention-items-svc-integration-${crypto.randomUUID()}.example`,
    })
    .returning();
  return account!.id;
}

function uniqueReasonCode(marker: string): string {
  return `${marker}_${crypto.randomUUID().replace(/-/g, "_")}`;
}

// ---------------------------------------------------------------------
// Top-level (plain pool) — regression: unchanged observable behavior
// after wrapping the INSERT in its own nested db.transaction(). Mirrors
// the exact scenarios already proven end-to-end via HTTP in
// ../routes/attentionItems.integration.test.ts, exercised here directly
// against the service function.
// ---------------------------------------------------------------------

test(
  "top-level: first create returns created, an exact replay returns duplicate, a conflicting retry returns conflict",
  { skip },
  async () => {
    const accountId = await makeAccount();
    const reasonCode = uniqueReasonCode("top_level");
    const args = {
      db: db!,
      accountId,
      reasonCode,
      reasonDetail: "original detail",
      source: "manual" as const,
      sourceRef: null,
      context: { a: 1 },
      createdBy: "operator@example.test",
    };

    const first = await createAttentionItem(args);
    assert.equal(first.outcome, "created");
    const firstId = first.outcome === "created" ? first.item.id : undefined;

    const replay = await createAttentionItem(args);
    assert.equal(replay.outcome, "duplicate");
    if (replay.outcome === "duplicate") {
      assert.equal(replay.item.id, firstId);
    }

    const conflicting = await createAttentionItem({
      ...args,
      reasonDetail: "different detail",
    });
    assert.equal(conflicting.outcome, "conflict");

    const rows = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.reasonCode, reasonCode));
    assert.equal(rows.length, 1, "exactly one row must exist — no overwrite, no second row");
  },
);

// ---------------------------------------------------------------------
// Nested inside a caller's transaction — recordAccountFact's real shape.
// ---------------------------------------------------------------------

test(
  "nested: createAttentionItem succeeds inside a caller's open transaction, committed together with the caller's own write",
  { skip },
  async () => {
    const accountId = await makeAccount();
    const reasonCode = uniqueReasonCode("nested_success");

    await db!.transaction(async (tx) => {
      // The caller's own write, standing in for recordAccountFact's
      // account_facts insert — proves the WHOLE transaction (not just the
      // attention item) commits together, atomically.
      await tx.insert(schema.accountFacts).values({
        accountId,
        field: "company.industry",
        value: "Banking",
        source: "manual-operator-v1",
        recordedBy: "operator@example.test",
      });

      const result = await createAttentionItem({
        db: tx,
        accountId,
        reasonCode,
        reasonDetail: "nested create",
        source: "evaluation",
        sourceRef: "eval-1",
        context: {},
        createdBy: "system:evaluation",
      });
      assert.equal(result.outcome, "created");
    });

    const items = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.reasonCode, reasonCode));
    assert.equal(items.length, 1);
    const facts = await db!
      .select()
      .from(schema.accountFacts)
      .where(eq(schema.accountFacts.accountId, accountId));
    assert.equal(facts.length, 1, "the caller's own write must have committed alongside the attention item");
  },
);

test(
  "nested: a duplicate encountered inside a caller's transaction returns duplicate without poisoning that transaction — the caller's other write still commits",
  { skip },
  async () => {
    const accountId = await makeAccount();
    const reasonCode = uniqueReasonCode("nested_duplicate");
    const payload = {
      accountId,
      reasonCode,
      reasonDetail: "stable detail",
      source: "evaluation" as const,
      sourceRef: "eval-1",
      context: { trigger: "account_fact_changed" },
      createdBy: "system:evaluation",
    };

    // Pre-existing open item — the thing the nested call below collides with.
    const pre = await createAttentionItem({ db: db!, ...payload });
    assert.equal(pre.outcome, "created");

    let nestedResult: Awaited<ReturnType<typeof createAttentionItem>> | undefined;
    await db!.transaction(async (tx) => {
      nestedResult = await createAttentionItem({ db: tx, ...payload });

      // Proof the outer transaction is still healthy after the nested
      // savepoint rolled back: a second, unrelated write in the SAME
      // transaction must still succeed and commit.
      await tx.insert(schema.accountFacts).values({
        accountId,
        field: "company.country",
        value: "Germany",
        source: "manual-operator-v1",
        recordedBy: "operator@example.test",
      });
    });

    assert.equal(nestedResult?.outcome, "duplicate");
    const items = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.reasonCode, reasonCode));
    assert.equal(items.length, 1, "no second row was created");
    const facts = await db!
      .select()
      .from(schema.accountFacts)
      .where(eq(schema.accountFacts.accountId, accountId));
    assert.equal(
      facts.length,
      1,
      "the outer transaction's other write must have committed — it was never poisoned by the nested dedup conflict",
    );
  },
);

test(
  "nested: a conflict encountered inside a caller's transaction returns conflict without poisoning that transaction — the caller's other write still commits",
  { skip },
  async () => {
    const accountId = await makeAccount();
    const reasonCode = uniqueReasonCode("nested_conflict");
    const basePayload = {
      accountId,
      reasonCode,
      source: "evaluation" as const,
      sourceRef: "eval-1",
      context: {},
      createdBy: "system:evaluation",
    };

    const pre = await createAttentionItem({ db: db!, ...basePayload, reasonDetail: "original" });
    assert.equal(pre.outcome, "created");

    let nestedResult: Awaited<ReturnType<typeof createAttentionItem>> | undefined;
    await db!.transaction(async (tx) => {
      nestedResult = await createAttentionItem({
        db: tx,
        ...basePayload,
        reasonDetail: "different",
      });

      await tx.insert(schema.accountFacts).values({
        accountId,
        field: "company.country",
        value: "Germany",
        source: "manual-operator-v1",
        recordedBy: "operator@example.test",
      });
    });

    assert.equal(nestedResult?.outcome, "conflict");
    const [row] = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.reasonCode, reasonCode));
    assert.equal(row?.reasonDetail, "original", "the original item must remain untouched, no overwrite");
    const facts = await db!
      .select()
      .from(schema.accountFacts)
      .where(eq(schema.accountFacts.accountId, accountId));
    assert.equal(
      facts.length,
      1,
      "the outer transaction's other write must have committed — it was never poisoned by the nested conflict",
    );
  },
);

test.after(async () => {
  await pool?.end();
});
