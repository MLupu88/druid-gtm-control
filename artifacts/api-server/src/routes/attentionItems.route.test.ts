// Route-level tests for POST /internal/accounts/:accountId/attention-items.
// No database of any kind — real or fake — is ever constructed here:
// createAttentionItemsRouter accepts a dependency shape with no `db`
// field at all once createAttentionItemFn is supplied directly (see
// AttentionItemsRouterDeps in ./attentionItems.ts), so these tests inject
// a fully-typed fake instead of a real service/database. Mounts
// requireServiceAuth in front of the router exactly as production wiring
// does (see ./index.ts), so the auth tests below exercise the real
// middleware, not a stand-in. Runs a real ephemeral HTTP server
// (app.listen(0)) and issues real fetch() requests, mirroring
// ./signals.route.test.ts.
//
// Run with: tsx --test src/routes/attentionItems.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { AttentionItem } from "@workspace/db/schema";
import { requireServiceAuth } from "../middlewares/requireServiceAuth.js";
import { AttentionAccountNotFoundError, type CreateAttentionItemResult } from "../services/attentionItems.js";
import { createAttentionItemsRouter, type CreateAttentionItemFn } from "./attentionItems.js";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXISTING_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEST_SECRET = "test-ingestion-secret-value";

function syntheticItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: ITEM_ID,
    accountId: ACCOUNT_ID,
    reasonCode: "no_recent_activity",
    reasonDetail: null,
    source: "manual",
    sourceRef: null,
    context: {},
    status: "open",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: "operator@example.com",
    resolvedAt: null,
    resolvedBy: null,
    resolutionReason: null,
    ...overrides,
  } as AttentionItem;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    reasonCode: "no_recent_activity",
    source: "manual",
    createdBy: "operator@example.com",
    ...overrides,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

interface FakeLogCall {
  level: "info" | "warn" | "error";
  arg0: unknown;
  arg1?: unknown;
}

function createFakeLogger() {
  const calls: FakeLogCall[] = [];
  const record =
    (level: FakeLogCall["level"]) =>
    (arg0: unknown, arg1?: unknown): void => {
      calls.push({ level, arg0, arg1 });
    };
  return { calls, info: record("info"), warn: record("warn"), error: record("error") };
}

function buildTestApp(
  createAttentionItemFn: CreateAttentionItemFn,
  log: ReturnType<typeof createFakeLogger> = createFakeLogger(),
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = log as never;
    next();
  });
  app.use(
    "/internal/accounts/:accountId/attention-items",
    requireServiceAuth,
    createAttentionItemsRouter({ createAttentionItemFn }),
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

const unusedCreateAttentionItemFn: CreateAttentionItemFn = async () => {
  throw new Error("createAttentionItemFn should not have been called");
};

function postAttentionItem(
  baseUrl: string,
  accountId: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/internal/accounts/${accountId}/attention-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------

test("POST .../attention-items: correct secret is accepted and reaches the service", async () => {
  const item = syntheticItem();
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(async () => ({ outcome: "created", item }));
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 201);
      assert.equal(createAttentionItemFn.mock.calls.length, 1);
      // Regression guard for { mergeParams: true } (see ./attentionItems.ts):
      // :accountId lives in the parent mount pattern, not this router's own
      // route, so this asserts the exact value reaching the service — not
      // just that some validly-shaped UUID was present.
      assert.equal(createAttentionItemFn.mock.calls[0]?.arguments[0].accountId, ACCOUNT_ID);
    }),
  );
});

test("POST .../attention-items: missing secret header is rejected with 401 and the service is never called", async () => {
  const app = buildTestApp(unusedCreateAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody());
      const body = await readJson(res);
      assert.equal(res.status, 401);
      assert.deepEqual(body, { error: "Unauthorized.", code: "unauthorized" });
    }),
  );
});

test("POST .../attention-items: incorrect secret is rejected with 401 and the service is never called", async () => {
  const app = buildTestApp(unusedCreateAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": "wrong-secret-value-1234567",
      });
      const body = await readJson(res);
      assert.equal(res.status, 401);
      assert.deepEqual(body, { error: "Unauthorized.", code: "unauthorized" });
    }),
  );
});

test("POST .../attention-items: an unconfigured secret fails closed with 503 and the service is never called", async () => {
  const app = buildTestApp(unusedCreateAttentionItemFn);

  await withEnvSecret(undefined, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": "anything",
      });
      assert.equal(res.status, 503);
    }),
  );
});

// ---------------------------------------------------------------------
// Request contract validation
// ---------------------------------------------------------------------

test("POST .../attention-items: an invalid accountId (non-UUID) returns 400 and the service is never called", async () => {
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(unusedCreateAttentionItemFn);
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, "not-a-uuid", validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(createAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

test("POST .../attention-items: an unknown top-level key returns 400 and the service is never called", async () => {
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(unusedCreateAttentionItemFn);
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody({ unexpectedField: true }), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(createAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

test("POST .../attention-items: a missing reasonCode returns 400 and the service is never called", async () => {
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(unusedCreateAttentionItemFn);
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const { reasonCode: _omit, ...body } = validBody();
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, body, {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(createAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

for (const [label, value] of [
  ["reasonCode", ""],
  ["reasonCode", "   "],
  ["createdBy", ""],
  ["createdBy", "   "],
] as const) {
  test(`POST .../attention-items: a blank ${label} returns 400 and the service is never called`, async () => {
    const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(unusedCreateAttentionItemFn);
    const app = buildTestApp(createAttentionItemFn);

    await withEnvSecret(TEST_SECRET, () =>
      withServer(app, async (baseUrl) => {
        const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody({ [label]: value }), {
          "x-gtm-ingestion-secret": TEST_SECRET,
        });
        assert.equal(res.status, 400);
        assert.equal(createAttentionItemFn.mock.calls.length, 0);
      }),
    );
  });
}

test("POST .../attention-items: a blank reasonDetail (present, whitespace-only) returns 400", async () => {
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(unusedCreateAttentionItemFn);
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody({ reasonDetail: "   " }), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(createAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

test("POST .../attention-items: an invalid source value returns 400 and the service is never called", async () => {
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(unusedCreateAttentionItemFn);
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody({ source: "not_a_real_source" }), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 400);
      assert.equal(createAttentionItemFn.mock.calls.length, 0);
    }),
  );
});

for (const [label, badContext] of [
  ["an array", [1, 2, 3]],
  ["a string", "not-an-object"],
  ["a number", 5],
  ["null", null],
] as const) {
  test(`POST .../attention-items: context as ${label} returns 400 and the service is never called`, async () => {
    const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(unusedCreateAttentionItemFn);
    const app = buildTestApp(createAttentionItemFn);

    await withEnvSecret(TEST_SECRET, () =>
      withServer(app, async (baseUrl) => {
        const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody({ context: badContext }), {
          "x-gtm-ingestion-secret": TEST_SECRET,
        });
        assert.equal(res.status, 400);
        assert.equal(createAttentionItemFn.mock.calls.length, 0);
      }),
    );
  });
}

test("POST .../attention-items: undefined optional fields normalize consistently (no reasonDetail/sourceRef/context supplied)", async () => {
  const item = syntheticItem();
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(async () => ({ outcome: "created", item }));
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 201);
      const call = createAttentionItemFn.mock.calls[0]!;
      assert.equal(call.arguments[0].reasonDetail, null);
      assert.equal(call.arguments[0].sourceRef, null);
      assert.deepEqual(call.arguments[0].context, {});
    }),
  );
});

// ---------------------------------------------------------------------
// Service outcome / error mapping
// ---------------------------------------------------------------------

test("POST .../attention-items: a 'created' outcome returns 201 with the serialized item", async () => {
  const item = syntheticItem();
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(
    async (): Promise<CreateAttentionItemResult> => ({ outcome: "created", item }),
  );
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 201);
      assert.equal(body.status, "created");
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
        resolvedAt: item.resolvedAt,
        resolvedBy: item.resolvedBy,
        resolutionReason: item.resolutionReason,
      });
    }),
  );
});

test("POST .../attention-items: a 'duplicate' outcome returns 200 with the existing item", async () => {
  const item = syntheticItem();
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(
    async (): Promise<CreateAttentionItemResult> => ({ outcome: "duplicate", item }),
  );
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.equal(body.status, "duplicate");
    }),
  );
});

test("POST .../attention-items: a 'conflict' outcome returns 409 with only the existing item's id, no overwrite implied", async () => {
  const existingItem = syntheticItem({ id: EXISTING_ITEM_ID });
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(
    async (): Promise<CreateAttentionItemResult> => ({ outcome: "conflict", existingItem }),
  );
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 409);
      assert.deepEqual(body, {
        error: "An open attention item already exists for this deduplication key with different content.",
        code: "attention_item_conflict",
        existingItemId: EXISTING_ITEM_ID,
      });
    }),
  );
});

test("POST .../attention-items: AttentionAccountNotFoundError from the service maps to 404 account_not_found", async () => {
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(async () => {
    throw new AttentionAccountNotFoundError(ACCOUNT_ID);
  });
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 404);
      assert.equal(body.code, "account_not_found");
    }),
  );
});

test("POST .../attention-items: an unexpected service error maps to 500 internal_error", async () => {
  const createAttentionItemFn = mock.fn<CreateAttentionItemFn>(async () => {
    throw new Error("unexpected failure");
  });
  const app = buildTestApp(createAttentionItemFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postAttentionItem(baseUrl, ACCOUNT_ID, validBody(), {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      const body = await readJson(res);
      assert.equal(res.status, 500);
      assert.deepEqual(body, { error: "An unexpected error occurred.", code: "internal_error" });
    }),
  );
});
