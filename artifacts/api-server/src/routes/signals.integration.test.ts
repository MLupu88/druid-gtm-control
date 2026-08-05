// Integration tests for POST /api/internal/signals, exercised end-to-end
// against a real, migrated Postgres instance: real db, the real service
// layer (../services/signals.ts), the real HTTP layer (requireServiceAuth
// + an ephemeral express server + real fetch()), and the real
// signals_source_source_event_id_uq constraint and signals_immutable
// trigger from lib/db/drizzle/0008_grey_lester.sql /
// 0009_signals_identity_resolution_immutability.sql — no fakes anywhere in
// this file.
//
// This is the ONLY real-Postgres suite for signal ingestion — deliberately
// not paired with a services/signals.integration.test.ts, since every
// database-observable behavior this unit needs to prove (canonicalization,
// insert-first idempotency, conflict detection, side-effect absence,
// append-only enforcement) is fully exercised through this single HTTP
// boundary.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset.
//
// Mirrors the "build our own pool/drizzle instance rather than import
// @workspace/db's singleton" pattern already used throughout this
// package's other *.integration.test.ts files. No truncation or row
// deletion anywhere — isolation comes from crypto.randomUUID()-suffixed
// sourceEventId values, and signals is immutable/insert-only by trigger
// regardless.
//
// Run with: DATABASE_URL=postgres://... tsx --test src/routes/signals.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { requireServiceAuth } from "../middlewares/requireServiceAuth.js";
import { createSignalsRouter } from "./signals.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

const TEST_SECRET = "signals-integration-test-secret";
process.env.GTM_SIGNAL_INGESTION_SECRET = TEST_SECRET;

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "x-gtm-ingestion-secret": TEST_SECRET,
};

// ---------------------------------------------------------------------
// Runtime response-shape assertions (no `as` casts) — this file exercises
// a real HTTP boundary, so a malformed response shape should fail the
// assertion, not be silently coerced.
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

async function readJson(res: Response, context: string): Promise<Record<string, unknown>> {
  const value: unknown = await res.json();
  assertIsRecord(value, context);
  return value;
}

// Drizzle wraps the underlying pg driver error in its own "Failed
// query..." Error, linked via Error.cause — the trigger's own message is
// not necessarily on the outermost Error.
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
  app.use("/internal/signals", requireServiceAuth, createSignalsRouter({ db: db! }));
  return app;
}

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
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

function uniqueEventId(marker: string): string {
  return `${marker}-${crypto.randomUUID()}`;
}

function normalizedSignalPayload(
  sourceEventId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: "v1",
    source: "HubSpot",
    sourceEventId,
    occurredAt: "2026-01-01T00:00:00Z",
    signalType: "page_view",
    observedResolutionLevel: "company",
    company: { domain: "https://Www.Example.com/pricing", name: "Acme Inc", externalIds: {} },
    person: null,
    activity: {
      pageUrl: null,
      signalDetail: null,
      formName: null,
      formStep: null,
      campaignId: "camp-1",
      campaignName: "Spring Launch",
      utm: null,
      clickIds: null,
    },
    sourceMetadata: null,
    ...overrides,
  };
}

async function postSignal(
  baseUrl: string,
  body: unknown,
): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/internal/signals`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

test("valid creation returns 201 with a created signalId", { skip }, async () => {
  const sourceEventId = uniqueEventId("create");
  await withServer(async (baseUrl) => {
    const res = await postSignal(baseUrl, {
      normalizedSignal: normalizedSignalPayload(sourceEventId),
      rawPayload: { hs_object_id: "123", raw: true },
    });
    const body = await readJson(res, "create response");

    assert.equal(res.status, 201);
    assert.equal(body.status, "created");
    assert.equal(body.source, "hubspot");
    assert.equal(body.sourceEventId, sourceEventId);
    assert.equal(typeof body.signalId, "string");
    assert.equal(typeof body.createdAt, "string");
  });
});

test(
  "canonicalized flattened columns and the canonical normalized payload are persisted",
  { skip },
  async () => {
    const sourceEventId = uniqueEventId("canonical");
    await withServer(async (baseUrl) => {
      const res = await postSignal(baseUrl, {
        normalizedSignal: normalizedSignalPayload(sourceEventId, {
          company: {
            domain: "https://Www.Example.com/pricing?utm=1",
            name: "Acme Inc",
            externalIds: {},
          },
        }),
        rawPayload: { a: 1 },
      });
      const body = await readJson(res, "create response");
      assert.equal(res.status, 201);

      const [row] = await db!
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.id, body.signalId as string))
        .limit(1);
      assert.ok(row, "signals row must exist");
      assert.equal(row.source, "hubspot");
      assert.equal(row.companyDomain, "example.com");
      assert.equal(row.companyName, "Acme Inc");
      assert.equal(row.campaignId, "camp-1");
      assert.equal(row.campaignName, "Spring Launch");

      assertIsRecord(row.normalizedPayload, "row.normalizedPayload");
      assert.equal(row.normalizedPayload.source, "hubspot");
      assertIsRecord(row.normalizedPayload.company, "row.normalizedPayload.company");
      assert.equal(
        (row.normalizedPayload.company as Record<string, unknown>).domain,
        "example.com",
      );
    });
  },
);

test("the raw payload is retained untouched and opaque", { skip }, async () => {
  const sourceEventId = uniqueEventId("raw");
  const rawPayload = { Weird_Key: "value", nested: { z: 1, a: 2 }, list: [3, 1, 2] };

  await withServer(async (baseUrl) => {
    const res = await postSignal(baseUrl, {
      normalizedSignal: normalizedSignalPayload(sourceEventId),
      rawPayload,
    });
    const body = await readJson(res, "create response");
    assert.equal(res.status, 201);

    const [row] = await db!
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, body.signalId as string))
      .limit(1);
    assert.ok(row, "signals row must exist");
    assert.deepEqual(row.rawPayload, rawPayload);
  });
});

test(
  "an exact retry returns 200 with the same signalId and creates no new row",
  { skip },
  async () => {
    const sourceEventId = uniqueEventId("exact-retry");
    const requestBody = {
      normalizedSignal: normalizedSignalPayload(sourceEventId),
      rawPayload: { a: 1 },
    };

    await withServer(async (baseUrl) => {
      const first = await postSignal(baseUrl, requestBody);
      const firstBody = await readJson(first, "first response");
      assert.equal(first.status, 201);

      const second = await postSignal(baseUrl, requestBody);
      const secondBody = await readJson(second, "second response");
      assert.equal(second.status, 200);
      assert.equal(secondBody.status, "duplicate");
      assert.equal(secondBody.signalId, firstBody.signalId);

      const rows = await db!
        .select()
        .from(schema.signals)
        .where(
          and(eq(schema.signals.source, "hubspot"), eq(schema.signals.sourceEventId, sourceEventId)),
        );
      assert.equal(rows.length, 1);
    });
  },
);

test(
  "duplicate object key order is treated as equal (200, not 409) — proves the comparison is structural, not a literal string/stringify match",
  { skip },
  async () => {
    const sourceEventId = uniqueEventId("key-order");

    const bodyA =
      `{"normalizedSignal":{"schemaVersion":"v1","source":"HubSpot","sourceEventId":"${sourceEventId}",` +
      `"occurredAt":"2026-01-01T00:00:00Z","signalType":"page_view","observedResolutionLevel":"anonymous",` +
      `"company":{"domain":null,"name":null,"externalIds":{}},"person":null,` +
      `"activity":{"pageUrl":null,"signalDetail":null,"formName":null,"formStep":null,"campaignId":null,` +
      `"campaignName":null,"utm":null,"clickIds":null},"sourceMetadata":null},"rawPayload":{"a":1,"b":2}}`;

    const bodyB =
      `{"rawPayload":{"b":2,"a":1},"normalizedSignal":{"person":null,"sourceMetadata":null,` +
      `"activity":{"clickIds":null,"utm":null,"campaignName":null,"campaignId":null,"formStep":null,` +
      `"formName":null,"signalDetail":null,"pageUrl":null},"company":{"externalIds":{},"name":null,"domain":null},` +
      `"observedResolutionLevel":"anonymous","signalType":"page_view","occurredAt":"2026-01-01T00:00:00Z",` +
      `"sourceEventId":"${sourceEventId}","source":"HubSpot","schemaVersion":"v1"}}`;

    await withServer(async (baseUrl) => {
      const first = await postSignal(baseUrl, bodyA);
      assert.equal(first.status, 201);

      const second = await postSignal(baseUrl, bodyB);
      const secondBody = await readJson(second, "second response");
      assert.equal(second.status, 200);
      assert.equal(secondBody.status, "duplicate");
    });
  },
);

test("a changed raw payload for the same source/sourceEventId returns 409, no overwrite", { skip }, async () => {
  const sourceEventId = uniqueEventId("raw-conflict");
  const normalizedSignal = normalizedSignalPayload(sourceEventId);

  await withServer(async (baseUrl) => {
    const first = await postSignal(baseUrl, { normalizedSignal, rawPayload: { a: 1 } });
    const firstBody = await readJson(first, "first response");
    assert.equal(first.status, 201);

    const second = await postSignal(baseUrl, { normalizedSignal, rawPayload: { a: 2 } });
    const secondBody = await readJson(second, "second response");
    assert.equal(second.status, 409);
    assert.equal(secondBody.code, "signal_conflict");
    assert.equal(secondBody.existingSignalId, firstBody.signalId);

    const [row] = await db!
      .select()
      .from(schema.signals)
      .where(eq(schema.signals.id, firstBody.signalId as string))
      .limit(1);
    assert.deepEqual(row?.rawPayload, { a: 1 }, "the original raw payload must remain untouched");
  });
});

test(
  "a changed normalized payload for the same source/sourceEventId returns 409, no overwrite",
  { skip },
  async () => {
    const sourceEventId = uniqueEventId("normalized-conflict");
    const rawPayload = { a: 1 };

    await withServer(async (baseUrl) => {
      const first = await postSignal(baseUrl, {
        normalizedSignal: normalizedSignalPayload(sourceEventId, { signalType: "page_view" }),
        rawPayload,
      });
      const firstBody = await readJson(first, "first response");
      assert.equal(first.status, 201);

      const second = await postSignal(baseUrl, {
        normalizedSignal: normalizedSignalPayload(sourceEventId, { signalType: "form_submission" }),
        rawPayload,
      });
      const secondBody = await readJson(second, "second response");
      assert.equal(second.status, 409);
      assert.equal(secondBody.existingSignalId, firstBody.signalId);

      const [row] = await db!
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.id, firstBody.signalId as string))
        .limit(1);
      assert.equal(row?.signalType, "page_view", "the original signal_type must remain untouched");
    });
  },
);

test(
  "concurrent exact-duplicate submissions produce exactly one 201 and one 200 sharing the same signalId",
  { skip },
  async () => {
    const sourceEventId = uniqueEventId("concurrent");
    const requestBody = {
      normalizedSignal: normalizedSignalPayload(sourceEventId),
      rawPayload: { concurrent: true },
    };

    await withServer(async (baseUrl) => {
      const [resA, resB] = await Promise.all([
        postSignal(baseUrl, requestBody),
        postSignal(baseUrl, requestBody),
      ]);
      const [bodyA, bodyB] = await Promise.all([
        readJson(resA, "concurrent response A"),
        readJson(resB, "concurrent response B"),
      ]);

      assert.deepEqual([resA.status, resB.status].sort(), [200, 201]);
      assert.equal(bodyA.signalId, bodyB.signalId);

      const rows = await db!
        .select()
        .from(schema.signals)
        .where(
          and(eq(schema.signals.source, "hubspot"), eq(schema.signals.sourceEventId, sourceEventId)),
        );
      assert.equal(rows.length, 1, "exactly one row must exist for this source/sourceEventId");
    });
  },
);

test(
  "ingesting a signal creates no account, person, account_people, or account_aliases rows",
  { skip },
  async () => {
    const sourceEventId = uniqueEventId("no-side-effects");

    const [beforeAccounts] = await db!.select({ n: count() }).from(schema.accounts);
    const [beforePeople] = await db!.select({ n: count() }).from(schema.people);
    const [beforeAccountPeople] = await db!.select({ n: count() }).from(schema.accountPeople);
    const [beforeAliases] = await db!.select({ n: count() }).from(schema.accountAliases);

    await withServer(async (baseUrl) => {
      const res = await postSignal(baseUrl, {
        normalizedSignal: normalizedSignalPayload(sourceEventId, {
          observedResolutionLevel: "contact",
          company: { domain: "example.com", name: "Acme Inc", externalIds: {} },
          person: {
            fullName: "Jane Doe",
            workEmail: "jane.doe@example.com",
            title: "VP Sales",
            linkedinUrl: null,
            externalIds: {},
          },
        }),
        rawPayload: { a: 1 },
      });
      assert.equal(res.status, 201);
    });

    const [afterAccounts] = await db!.select({ n: count() }).from(schema.accounts);
    const [afterPeople] = await db!.select({ n: count() }).from(schema.people);
    const [afterAccountPeople] = await db!.select({ n: count() }).from(schema.accountPeople);
    const [afterAliases] = await db!.select({ n: count() }).from(schema.accountAliases);

    assert.equal(afterAccounts.n, beforeAccounts.n, "no account row must be created");
    assert.equal(afterPeople.n, beforePeople.n, "no person row must be created");
    assert.equal(afterAccountPeople.n, beforeAccountPeople.n, "no account_people row must be created");
    assert.equal(afterAliases.n, beforeAliases.n, "no account_aliases row must be created");
  },
);

test(
  "signals rows remain append-only: a direct UPDATE is rejected by the database trigger",
  { skip },
  async () => {
    const sourceEventId = uniqueEventId("append-only");
    let signalId = "";

    await withServer(async (baseUrl) => {
      const res = await postSignal(baseUrl, {
        normalizedSignal: normalizedSignalPayload(sourceEventId),
        rawPayload: { a: 1 },
      });
      const body = await readJson(res, "create response");
      assert.equal(res.status, 201);
      signalId = body.signalId as string;
    });

    await assert.rejects(
      () =>
        db!
          .update(schema.signals)
          .set({ signalType: "changed" })
          .where(eq(schema.signals.id, signalId)),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          errorChainMessageIncludes(err, "immutable/insert-only"),
          "expected the signals_immutable trigger's rejection message",
        );
        return true;
      },
    );
  },
);

test("an unauthenticated request (missing secret header) never reaches the database", { skip }, async () => {
  const sourceEventId = uniqueEventId("unauth");

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/internal/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        normalizedSignal: normalizedSignalPayload(sourceEventId),
        rawPayload: { a: 1 },
      }),
    });
    assert.equal(res.status, 401);
  });

  const rows = await db!
    .select()
    .from(schema.signals)
    .where(
      and(eq(schema.signals.source, "hubspot"), eq(schema.signals.sourceEventId, sourceEventId)),
    );
  assert.equal(rows.length, 0);
});

test.after(async () => {
  await pool?.end();
});
