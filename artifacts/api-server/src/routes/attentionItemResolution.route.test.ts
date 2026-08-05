// Route-level tests for POST /internal/attention-items/:attentionItemId/resolve.
// No database of any kind — real or fake — is ever constructed here:
// createAttentionItemResolutionRouter accepts a dependency shape with no
// `db` field at all once resolveAttentionItemFn is supplied directly (see
// AttentionItemResolutionRouterDeps in ./attentionItemResolution.ts), so
// these tests inject a fully-typed fake instead of a real service/
// database. Mounts requireServiceAuth in front of the router exactly as
// production wiring does (see ./index.ts). Runs a real ephemeral HTTP
// server (app.listen(0)) and issues real fetch() requests, mirroring
// ./attentionItems.route.test.ts.
//
// Run with: tsx --test src/routes/attentionItemResolution.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { AttentionItem } from "@workspace/db/schema";
import { requireServiceAuth } from "../middlewares/requireServiceAuth.js";
import type { ResolveAttentionItemResult } from "../services/attentionItems.js";
import {
  createAttentionItemResolutionRouter,
  type ResolveAttentionItemFn,
} from "./attentionItemResolution.js";

const VALID_ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEST_SECRET = "test-ingestion-secret-value";

function syntheticItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: VALID_ITEM_ID,
    accountId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    reasonCode: "no_recent_activity",
    reasonDetail: null,
    source: "manual",
    sourceRef: null,
    context: {},
    status: "resolved",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: "operator@example.com",
    resolvedAt: new Date("2026-01-02T00:00:00Z"),
    resolvedBy: "operator@example.com",
    resolutionReason: "false positive",
    ...overrides,
  } as AttentionItem;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { resolvedBy: "operator@example.com", resolutionReason: "false positive", ...overrides };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function buildTestApp(resolveAttentionItemFn: ResolveAttentionItemFn): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info: () => {}, warn: () => {}, error: () => {} } as never;
    next();
  });
  app.use(
    "/internal/attention-items",
    requireServiceAuth,
    createAttentionItemResolutionRouter({ resolveAttentionItemFn }),
  );
  return app;
}

async function withServer(app: Express, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function withEnvSecret<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const original = process.env.GTM_SIGNAL_INGESTION_SECRET;
  if (value === undefined) {
    delete process.env.GTM_SIGNAL_INGESTION_SECRET;
  } else {
    process.env.GTM_SIGNAL_INGESTION_SECRET = value;
  }
  try {
    return await fn();
  } finally {
    if (original === undefined) {
      delete process.env.GTM_SIGNAL_INGESTION_SECRET;
    } else {
      process.env.GTM_SIGNAL_INGESTION_SECRET = original;
    }
  }
}

const unusedResolveAttentionItemFn: ResolveAttentionItemFn = async () => {
  throw new Error("resolveAttentionItemFn should not have been called");
};

function postResolve(
  baseUrl: string,
  attentionItemId: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/internal/attention-items/${attentionItemId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------

test("POST .../resolve: correct secret is accepted and reaches the service", async () => {
  const item = syntheticItem();
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(async () => ({ kind: "resolved", item }));
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 200);
      assert.equal(resolveAttentionItemFn.mock.calls.length, 1);
    }),
  );
});

test("POST .../resolve: missing secret header is rejected with 401 and the service is never called", async () => {
  const app = buildTestApp(unusedResolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody());
      const body = await readJson(res);
      assert.equal(res.status, 401);
      assert.deepEqual(body, { error: "Unauthorized.", code: "unauthorized" });
    }),
  );
});

test("POST .../resolve: an unconfigured secret fails closed with 503 and the service is never called", async () => {
  const app = buildTestApp(unusedResolveAttentionItemFn);

  await withEnvSecret(undefined, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody(), {
        "x-gtm-ingestion-secret": "anything",
      });
      assert.equal(res.status, 503);
    }),
  );
});

// ---------------------------------------------------------------------
// Request contract validation
// ---------------------------------------------------------------------

test("POST .../resolve: an invalid attentionItemId (non-UUID) returns 400 and the service is never called", async () => {
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(unusedResolveAttentionItemFn);
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, "not-a-uuid", validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(resolveAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

test("POST .../resolve: an unknown top-level key returns 400 and the service is never called", async () => {
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(unusedResolveAttentionItemFn);
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody({ unexpectedField: true }), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(resolveAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

test("POST .../resolve: a missing resolvedBy returns 400 and the service is never called", async () => {
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(unusedResolveAttentionItemFn);
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const { resolvedBy: _omit, ...body } = validBody();
      const res = await postResolve(baseUrl, VALID_ITEM_ID, body, {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(resolveAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

test("POST .../resolve: a missing resolutionReason returns 400 and the service is never called", async () => {
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(unusedResolveAttentionItemFn);
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const { resolutionReason: _omit, ...body } = validBody();
      const res = await postResolve(baseUrl, VALID_ITEM_ID, body, {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(resolveAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

for (const [label, value] of [
  ["resolvedBy", ""],
  ["resolvedBy", "   "],
  ["resolutionReason", ""],
  ["resolutionReason", "   "],
] as const) {
  test(`POST .../resolve: a blank ${label} returns 400 and the service is never called`, async () => {
    const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(unusedResolveAttentionItemFn);
    const app = buildTestApp(resolveAttentionItemFn);

    await withEnvSecret(TEST_SECRET, () =>
      withServer(app, async (baseUrl) => {
        const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody({ [label]: value }), {
          "x-gtm-ingestion-secret": TEST_SECRET,
        });
        assert.equal(res.status, 400);
        assert.equal(resolveAttentionItemFn.mock.calls.length, 0);
      }),
    );
  });
}

// ---------------------------------------------------------------------
// Service outcome / error mapping
// ---------------------------------------------------------------------

test("POST .../resolve: a 'resolved' outcome returns 200 with the serialized item", async () => {
  const item = syntheticItem();
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(
    async (): Promise<ResolveAttentionItemResult> => ({ kind: "resolved", item }),
  );
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.equal(body.status, "resolved");
      assert.deepEqual(body.item, {
        id: item.id,
        accountId: item.accountId,
        reasonCode: item.reasonCode,
        reasonDetail: item.reasonDetail,
        source: item.source,
        sourceRef: item.sourceRef,
        context: item.context,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
        createdBy: item.createdBy,
        resolvedAt: item.resolvedAt!.toISOString(),
        resolvedBy: item.resolvedBy,
        resolutionReason: item.resolutionReason,
      });
    }),
  );
});

test("POST .../resolve: a 'replayed' outcome returns 200", async () => {
  const item = syntheticItem();
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(
    async (): Promise<ResolveAttentionItemResult> => ({ kind: "replayed", item }),
  );
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.equal(body.status, "replayed");
    }),
  );
});

test("POST .../resolve: a 'conflict' outcome returns 409 without leaking the existing item, no overwrite implied", async () => {
  const existingItem = syntheticItem({ resolvedBy: "someone-else@example.com" });
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(
    async (): Promise<ResolveAttentionItemResult> => ({ kind: "conflict", existingItem }),
  );
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 409);
      assert.deepEqual(body, {
        error: "The attention item was already resolved with different resolution data.",
        code: "attention_item_resolution_conflict",
        attentionItemId: VALID_ITEM_ID,
      });
    }),
  );
});

test("POST .../resolve: a 'not_found' outcome returns 404", async () => {
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(
    async (): Promise<ResolveAttentionItemResult> => ({ kind: "not_found" }),
  );
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 404);
      assert.deepEqual(body, {
        error: "The attention item was not found.",
        code: "attention_item_not_found",
      });
    }),
  );
});

test("POST .../resolve: an unexpected service error maps to 500 internal_error", async () => {
  const resolveAttentionItemFn = mock.fn<ResolveAttentionItemFn>(async () => {
    throw new Error("unexpected failure");
  });
  const app = buildTestApp(resolveAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_ITEM_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 500);
      assert.deepEqual(body, { error: "An unexpected error occurred.", code: "internal_error" });
    }),
  );
});
