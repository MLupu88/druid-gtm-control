// Integration tests for POST /internal/accounts/:accountId/attention-items
// and POST /internal/attention-items/:attentionItemId/resolve, exercised
// end-to-end against a real, migrated Postgres instance: real db, the
// real service layer (../services/attentionItems.ts), the real HTTP
// layer (requireServiceAuth + an ephemeral express server + real
// fetch()), and the real partial unique indexes / lifecycle trigger from
// lib/db/drizzle/0011_attention_items_lifecycle.sql — no fakes anywhere in
// this file. One combined suite (not split create/resolve, unlike
// ../routes/signals.integration.test.ts vs.
// ../routes/signalResolution.integration.test.ts) since every scenario
// below shares the same table and several resolve-path tests need a
// create call first to set up their fixture.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed against a real Postgres instance as part of this change (no
// database connection was made) — CI provisions an ephemeral instance and
// runs it there (see .github/workflows/pr-checks.yml).
//
// No truncation or row deletion anywhere except the explicit
// direct-DELETE-is-rejected test below, which asserts the delete fails.
// Isolation comes from crypto.randomUUID()-suffixed accountKey/reasonCode/
// sourceRef values, and attention_items is otherwise immutable-after-
// resolution by trigger regardless.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/routes/attentionItems.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { requireServiceAuth } from "../middlewares/requireServiceAuth.js";
import { createAttentionItemsRouter } from "./attentionItems.js";
import { createAttentionItemResolutionRouter } from "./attentionItemResolution.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const TEST_SECRET = "attention-items-integration-test-secret";
process.env.GTM_SIGNAL_INGESTION_SECRET = TEST_SECRET;

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "x-gtm-ingestion-secret": TEST_SECRET,
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function assertIsRecord(value: unknown, context: string): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${context} must be a JSON object`);
}

async function readJson(res: Response, context: string): Promise<Record<string, unknown>> {
  const value: unknown = await res.json();
  assertIsRecord(value, context);
  return value;
}

// Drizzle wraps the underlying pg driver error in its own "Failed
// query..." Error, linked via Error.cause — the trigger's own message is
// not necessarily on the outermost Error. Mirrors
// ../routes/signals.integration.test.ts's own helper.
function errorChainMessageIncludes(err: unknown, needle: string): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    if (current.message.includes(needle)) return true;
    current = current.cause;
  }
  return false;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/internal/accounts/:accountId/attention-items",
    requireServiceAuth,
    createAttentionItemsRouter({ db: db! }),
  );
  app.use(
    "/internal/attention-items",
    requireServiceAuth,
    createAttentionItemResolutionRouter({ db: db! }),
  );
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

function uniqueReasonCode(marker: string): string {
  return `${marker}_${crypto.randomUUID().replace(/-/g, "_")}`;
}

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:attention-items-integration-${crypto.randomUUID()}.example` })
    .returning();
  return account!.id;
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    reasonCode: uniqueReasonCode("no_recent_activity"),
    source: "manual",
    createdBy: "operator@example.com",
    ...overrides,
  };
}

async function postCreate(baseUrl: string, accountId: string, body: unknown): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/internal/accounts/${accountId}/attention-items`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify(body),
  });
}

async function postResolve(baseUrl: string, attentionItemId: string, body: unknown): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/internal/attention-items/${attentionItemId}/resolve`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------

test("first create returns 201 with the new item", { skip }, async () => {
  const accountId = await makeAccount();
  await withServer(async (baseUrl) => {
    const res = await postCreate(baseUrl, accountId, createBody());
    const body = await readJson(res, "create response");
    assert.equal(res.status, 201);
    assert.equal(body.status, "created");
    assertIsRecord(body.item, "body.item");
    assert.equal(body.item.accountId, accountId);
    assert.equal(body.item.status, "open");
  });
});

test("an exact replay returns 200/duplicate with the same item id and adds no new row", { skip }, async () => {
  const accountId = await makeAccount();
  const body = createBody({ reasonDetail: "needs review", context: { signalId: "sig_1" } });

  await withServer(async (baseUrl) => {
    const first = await postCreate(baseUrl, accountId, body);
    const firstBody = await readJson(first, "first response");
    assert.equal(first.status, 201);

    const second = await postCreate(baseUrl, accountId, body);
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 200);
    assert.equal(secondBody.status, "duplicate");
    assertIsRecord(secondBody.item, "secondBody.item");
    assert.equal(secondBody.item.id, (firstBody.item as Record<string, unknown>).id);

    const rows = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.reasonCode, body.reasonCode));
    assert.equal(rows.length, 1, "exactly one row must exist for this reasonCode");
  });
});

test("duplicate object key order in context is treated as equal (200, not 409)", { skip }, async () => {
  const accountId = await makeAccount();
  const reasonCode = uniqueReasonCode("key_order");

  await withServer(async (baseUrl) => {
    const first = await postCreate(
      baseUrl,
      accountId,
      createBody({ reasonCode, context: { a: 1, b: 2 } }),
    );
    assert.equal(first.status, 201);

    const second = await postCreate(
      baseUrl,
      accountId,
      createBody({ reasonCode, context: { b: 2, a: 1 } }),
    );
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 200);
    assert.equal(secondBody.status, "duplicate");
  });
});

test("a conflicting reasonDetail for the same deduplication key returns 409, no overwrite", { skip }, async () => {
  const accountId = await makeAccount();
  const reasonCode = uniqueReasonCode("reason_detail_conflict");

  await withServer(async (baseUrl) => {
    const first = await postCreate(baseUrl, accountId, createBody({ reasonCode, reasonDetail: "original" }));
    const firstBody = await readJson(first, "first response");
    assert.equal(first.status, 201);
    const itemId = (firstBody.item as Record<string, unknown>).id as string;

    const second = await postCreate(baseUrl, accountId, createBody({ reasonCode, reasonDetail: "changed" }));
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 409);
    assert.equal(secondBody.code, "attention_item_conflict");
    assert.equal(secondBody.existingItemId, itemId);

    const [row] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    assert.equal(row?.reasonDetail, "original", "the original reasonDetail must remain untouched");
  });
});

test("a conflicting context for the same deduplication key returns 409, no overwrite", { skip }, async () => {
  const accountId = await makeAccount();
  const reasonCode = uniqueReasonCode("context_conflict");

  await withServer(async (baseUrl) => {
    const first = await postCreate(baseUrl, accountId, createBody({ reasonCode, context: { signalId: "sig_1" } }));
    const firstBody = await readJson(first, "first response");
    assert.equal(first.status, 201);
    const itemId = (firstBody.item as Record<string, unknown>).id as string;

    const second = await postCreate(baseUrl, accountId, createBody({ reasonCode, context: { signalId: "sig_2" } }));
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 409);
    assert.equal(secondBody.existingItemId, itemId);

    const [row] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    assert.deepEqual(row?.context, { signalId: "sig_1" }, "the original context must remain untouched");
  });
});

test("a conflicting createdBy for the same deduplication key returns 409, no overwrite", { skip }, async () => {
  const accountId = await makeAccount();
  const reasonCode = uniqueReasonCode("created_by_conflict");

  await withServer(async (baseUrl) => {
    const first = await postCreate(baseUrl, accountId, createBody({ reasonCode, createdBy: "operator-a@example.com" }));
    const firstBody = await readJson(first, "first response");
    assert.equal(first.status, 201);
    const itemId = (firstBody.item as Record<string, unknown>).id as string;

    const second = await postCreate(baseUrl, accountId, createBody({ reasonCode, createdBy: "operator-b@example.com" }));
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 409);
    assert.equal(secondBody.existingItemId, itemId);

    const [row] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    assert.equal(row?.createdBy, "operator-a@example.com", "the original createdBy must remain untouched");
  });
});

test("sourceRef-present deduplication: same sourceRef replays, different sourceRef creates a second open item", { skip }, async () => {
  const accountId = await makeAccount();
  const reasonCode = uniqueReasonCode("with_ref");
  const sourceRef = `sig_${crypto.randomUUID()}`;

  await withServer(async (baseUrl) => {
    const first = await postCreate(baseUrl, accountId, createBody({ reasonCode, sourceRef }));
    assert.equal(first.status, 201);

    const replay = await postCreate(baseUrl, accountId, createBody({ reasonCode, sourceRef }));
    const replayBody = await readJson(replay, "replay response");
    assert.equal(replay.status, 200);
    assert.equal(replayBody.status, "duplicate");

    const differentRef = await postCreate(
      baseUrl,
      accountId,
      createBody({ reasonCode, sourceRef: `sig_${crypto.randomUUID()}` }),
    );
    assert.equal(differentRef.status, 201, "a different sourceRef under the same reasonCode must create a distinct open item");

    const rows = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.reasonCode, reasonCode));
    assert.equal(rows.length, 2);
  });
});

test("sourceRef-absent deduplication: two null-sourceRef creates for the same key replay against each other", { skip }, async () => {
  const accountId = await makeAccount();
  const reasonCode = uniqueReasonCode("without_ref");

  await withServer(async (baseUrl) => {
    const first = await postCreate(baseUrl, accountId, createBody({ reasonCode }));
    assert.equal(first.status, 201);

    const second = await postCreate(baseUrl, accountId, createBody({ reasonCode }));
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 200);
    assert.equal(secondBody.status, "duplicate");

    const rows = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.reasonCode, reasonCode));
    assert.equal(rows.length, 1);
  });
});

test("creating for a missing account returns 404 and creates no row", { skip }, async () => {
  const missingAccountId = crypto.randomUUID();
  const reasonCode = uniqueReasonCode("missing_account");

  await withServer(async (baseUrl) => {
    const res = await postCreate(baseUrl, missingAccountId, createBody({ reasonCode }));
    const body = await readJson(res, "response");
    assert.equal(res.status, 404);
    assert.equal(body.code, "account_not_found");
  });

  const rows = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.reasonCode, reasonCode));
  assert.equal(rows.length, 0);
});

test("concurrent identical creation produces exactly one row, one created result, and one duplicate result", { skip }, async () => {
  const accountId = await makeAccount();
  const body = createBody({ reasonCode: uniqueReasonCode("concurrent_create") });

  await withServer(async (baseUrl) => {
    const [resA, resB] = await Promise.all([postCreate(baseUrl, accountId, body), postCreate(baseUrl, accountId, body)]);
    const [bodyA, bodyB] = await Promise.all([
      readJson(resA, "concurrent response A"),
      readJson(resB, "concurrent response B"),
    ]);

    assert.deepEqual([resA.status, resB.status].sort(), [200, 201]);
    assert.deepEqual([bodyA.status, bodyB.status].sort(), ["created", "duplicate"]);
    assert.equal((bodyA.item as Record<string, unknown>).id, (bodyB.item as Record<string, unknown>).id);

    const rows = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.reasonCode, body.reasonCode as string));
    assert.equal(rows.length, 1, "exactly one row must exist for this deduplication key");
  });
});

test(
  "concurrent conflicting creation (same dedup key, different reasonDetail) produces one created result, one conflict result, and no overwrite",
  { skip },
  async () => {
    const accountId = await makeAccount();
    const reasonCode = uniqueReasonCode("concurrent_conflict");
    // Same accountId/reasonCode/source/sourceRef (the full deduplication
    // key — source and sourceRef both default identically from
    // createBody()) with a differing reasonDetail, so exactly one of the
    // two concurrent requests must win the INSERT and the other must
    // observe a genuine content conflict, never a silent overwrite.
    const reasonDetailA = "reason A";
    const reasonDetailB = "reason B";
    const bodyA = createBody({ reasonCode, reasonDetail: reasonDetailA });
    const bodyB = createBody({ reasonCode, reasonDetail: reasonDetailB });

    await withServer(async (baseUrl) => {
      const [resA, resB] = await Promise.all([
        postCreate(baseUrl, accountId, bodyA),
        postCreate(baseUrl, accountId, bodyB),
      ]);
      const [respBodyA, respBodyB] = await Promise.all([
        readJson(resA, "concurrent response A"),
        readJson(resB, "concurrent response B"),
      ]);

      assert.deepEqual([resA.status, resB.status].sort(), [201, 409]);

      const aWon = resA.status === 201;
      const createdResponse = aWon ? respBodyA : respBodyB;
      const conflictResponse = aWon ? respBodyB : respBodyA;
      const winningReasonDetail = aWon ? reasonDetailA : reasonDetailB;
      const createdItem = createdResponse.item as Record<string, unknown>;

      assert.equal(conflictResponse.code, "attention_item_conflict");
      assert.equal(
        conflictResponse.existingItemId,
        createdItem.id,
        "the 409's existingItemId must point at the request that actually won creation",
      );

      const rows = await db!
        .select()
        .from(schema.attentionItems)
        .where(
          and(
            eq(schema.attentionItems.accountId, accountId),
            eq(schema.attentionItems.reasonCode, reasonCode),
            eq(schema.attentionItems.source, "manual"),
            isNull(schema.attentionItems.sourceRef),
            eq(schema.attentionItems.status, "open"),
          ),
        );
      assert.equal(rows.length, 1, "exactly one open row must exist for this deduplication key");
      assert.equal(
        rows[0]?.reasonDetail,
        winningReasonDetail,
        "the stored reasonDetail must match whichever request actually won creation, never a mix of both",
      );
    });
  },
);

// ---------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------

async function createOpenItem(baseUrl: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const accountId = await makeAccount();
  const res = await postCreate(baseUrl, accountId, createBody(overrides));
  const body = await readJson(res, "fixture create response");
  assert.equal(res.status, 201);
  return (body.item as Record<string, unknown>).id as string;
}

test("first resolution succeeds and transitions the row", { skip }, async () => {
  await withServer(async (baseUrl) => {
    const itemId = await createOpenItem(baseUrl);

    const res = await postResolve(baseUrl, itemId, { resolvedBy: "operator@example.com", resolutionReason: "handled" });
    const body = await readJson(res, "resolve response");
    assert.equal(res.status, 200);
    assert.equal(body.status, "resolved");
    assertIsRecord(body.item, "body.item");
    assert.equal(body.item.status, "resolved");

    const [row] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    assert.equal(row?.status, "resolved");
    assert.equal(row?.resolvedBy, "operator@example.com");
    assert.equal(row?.resolutionReason, "handled");
    assert.ok(row?.resolvedAt);
  });
});

test("an exact resolution replay returns 200/replayed and preserves the original resolvedAt", { skip }, async () => {
  await withServer(async (baseUrl) => {
    const itemId = await createOpenItem(baseUrl);
    const resolution = { resolvedBy: "operator@example.com", resolutionReason: "handled" };

    const first = await postResolve(baseUrl, itemId, resolution);
    assert.equal(first.status, 200);
    const [rowAfterFirst] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    const firstResolvedAt = rowAfterFirst!.resolvedAt!.getTime();

    // A small delay so a buggy re-resolve (one that re-runs now()) would
    // produce an observably different timestamp, not one that happens to
    // round to the same value.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await postResolve(baseUrl, itemId, resolution);
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 200);
    assert.equal(secondBody.status, "replayed");

    const [rowAfterSecond] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    assert.equal(rowAfterSecond!.resolvedAt!.getTime(), firstResolvedAt, "resolvedAt must not change on replay");
  });
});

test("a conflicting resolution returns 409 and does not change the stored resolution", { skip }, async () => {
  await withServer(async (baseUrl) => {
    const itemId = await createOpenItem(baseUrl);

    const first = await postResolve(baseUrl, itemId, { resolvedBy: "operator@example.com", resolutionReason: "handled" });
    assert.equal(first.status, 200);

    const second = await postResolve(baseUrl, itemId, { resolvedBy: "operator@example.com", resolutionReason: "different reason" });
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 409);
    assert.deepEqual(secondBody, {
      error: "The attention item was already resolved with different resolution data.",
      code: "attention_item_resolution_conflict",
      attentionItemId: itemId,
    });

    const [row] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    assert.equal(row?.resolutionReason, "handled", "the original resolution must remain untouched");
  });
});

test("resolving a missing item returns 404", { skip }, async () => {
  const missingId = crypto.randomUUID();
  await withServer(async (baseUrl) => {
    const res = await postResolve(baseUrl, missingId, { resolvedBy: "operator@example.com", resolutionReason: "handled" });
    const body = await readJson(res, "response");
    assert.equal(res.status, 404);
    assert.deepEqual(body, {
      error: "The attention item was not found.",
      code: "attention_item_not_found",
    });
  });
});

test("concurrent matching resolutions classify as one resolved plus one replayed", { skip }, async () => {
  await withServer(async (baseUrl) => {
    const itemId = await createOpenItem(baseUrl);
    const resolution = { resolvedBy: "operator@example.com", resolutionReason: "handled" };

    const [resA, resB] = await Promise.all([postResolve(baseUrl, itemId, resolution), postResolve(baseUrl, itemId, resolution)]);
    const [bodyA, bodyB] = await Promise.all([readJson(resA, "response A"), readJson(resB, "response B")]);

    assert.deepEqual([resA.status, resB.status].sort(), [200, 200]);
    assert.deepEqual([bodyA.status, bodyB.status].sort(), ["replayed", "resolved"]);

    const [row] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    assert.equal(row?.resolutionReason, "handled");
  });
});

test("concurrent differing resolutions classify as one resolved plus one conflict", { skip }, async () => {
  await withServer(async (baseUrl) => {
    const itemId = await createOpenItem(baseUrl);

    const [resA, resB] = await Promise.all([
      postResolve(baseUrl, itemId, { resolvedBy: "operator-a@example.com", resolutionReason: "reason A" }),
      postResolve(baseUrl, itemId, { resolvedBy: "operator-b@example.com", resolutionReason: "reason B" }),
    ]);
    const [bodyA, bodyB] = await Promise.all([readJson(resA, "response A"), readJson(resB, "response B")]);

    assert.deepEqual([resA.status, resB.status].sort(), [200, 409]);
    assert.deepEqual([bodyA.status ?? bodyA.code, bodyB.status ?? bodyB.code].sort(), [
      "attention_item_resolution_conflict",
      "resolved",
    ]);

    // Exactly one of the two candidate resolutions won — the stored row
    // must match whichever response reported "resolved", never a mix.
    const [row] = await db!.select().from(schema.attentionItems).where(eq(schema.attentionItems.id, itemId));
    const winnerBody = bodyA.status === "resolved" ? bodyA : bodyB;
    const winnerItem = winnerBody.item as Record<string, unknown>;
    assert.equal(row?.resolvedBy, winnerItem.resolvedBy);
    assert.equal(row?.resolutionReason, winnerItem.resolutionReason);
  });
});

// ---------------------------------------------------------------------
// Lifecycle trigger — final authority
// ---------------------------------------------------------------------

test("a direct UPDATE that is not a well-formed open -> resolved transition is rejected by the lifecycle trigger", { skip }, async () => {
  let itemId = "";
  await withServer(async (baseUrl) => {
    itemId = await createOpenItem(baseUrl);
  });

  await assert.rejects(
    () => db!.update(schema.attentionItems).set({ reasonDetail: "direct edit" }).where(eq(schema.attentionItems.id, itemId)),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        errorChainMessageIncludes(err, "the only permitted update is open -> resolved"),
        "expected the attention_items_lifecycle_guard trigger's rejection message",
      );
      return true;
    },
  );
});

test("a direct DELETE is rejected by the lifecycle trigger, even for an open item", { skip }, async () => {
  let itemId = "";
  await withServer(async (baseUrl) => {
    itemId = await createOpenItem(baseUrl);
  });

  await assert.rejects(
    () => db!.delete(schema.attentionItems).where(eq(schema.attentionItems.id, itemId)),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        errorChainMessageIncludes(err, "rows can never be deleted"),
        "expected the attention_items_lifecycle_guard trigger's rejection message",
      );
      return true;
    },
  );
});

test.after(async () => {
  await pool?.end();
});
