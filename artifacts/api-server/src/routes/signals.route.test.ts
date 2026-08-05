// Route-level tests for POST /internal/signals. No database of any kind —
// real or fake — is ever constructed here: createSignalsRouter accepts a
// dependency shape with no `db` field at all once recordSignalFn is
// supplied directly (see SignalsRouterDeps in ./signals.ts), so these
// tests inject a fully-typed fake instead of a real service/database.
// Mounts requireServiceAuth in front of the router exactly as production
// wiring does (see ./index.ts), so the auth tests below exercise the real
// middleware, not a stand-in. Runs a real ephemeral HTTP server
// (app.listen(0)) and issues real fetch() requests, mirroring
// ./accountFacts.route.test.ts.
//
// Run with: tsx --test src/routes/signals.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { NormalizedSignalV1 } from "@workspace/identity";
import type { Signal } from "@workspace/db/schema";
import { requireServiceAuth } from "../middlewares/requireServiceAuth.js";
import {
  InvalidSignalDomainError,
  InvalidSignalWorkEmailError,
  type RecordSignalResult,
} from "../services/signals.js";
import { createSignalsRouter, type RecordSignalFn } from "./signals.js";

const VALID_SIGNAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXISTING_SIGNAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEST_SECRET = "test-ingestion-secret-value";

function validNormalizedSignal(
  overrides: Partial<NormalizedSignalV1> = {},
): NormalizedSignalV1 {
  return {
    schemaVersion: "v1",
    source: "HubSpot",
    sourceEventId: "evt_123",
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

function syntheticSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: VALID_SIGNAL_ID,
    source: "hubspot",
    sourceEventId: "evt_123",
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    signalType: "page_view",
    observedResolutionLevel: "anonymous",
    companyDomain: null,
    companyName: null,
    campaignId: null,
    campaignName: null,
    schemaVersion: "v1",
    rawPayload: {},
    normalizedPayload: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Signal;
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
  recordSignalFn: RecordSignalFn,
  log: ReturnType<typeof createFakeLogger> = createFakeLogger(),
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Stubs req.log so the route's req.log?.info/.error calls have
    // something to call — mirrors what pino-http provides in production
    // (see app.ts) without requiring that middleware here, and lets
    // logging-safety tests below inspect exactly what was logged.
    req.log = log as never;
    next();
  });
  app.use("/internal/signals", requireServiceAuth, createSignalsRouter({ recordSignalFn }));
  return app;
}

async function withServer(
  app: Express,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0);
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

async function withEnvSecret<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
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

const unusedRecordSignalFn: RecordSignalFn = async () => {
  throw new Error("recordSignalFn should not have been called");
};

function postSignal(
  baseUrl: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/internal/signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------

test("POST /internal/signals: correct secret is accepted and reaches the service", async () => {
  const signal = syntheticSignal();
  const recordSignalFn = mock.fn<RecordSignalFn>(async () => ({
    outcome: "created",
    signal,
  }));
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal(), rawPayload: { a: 1 } },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      assert.equal(res.status, 201);
      assert.equal(recordSignalFn.mock.calls.length, 1);
    }),
  );
});

test("POST /internal/signals: missing secret header is rejected with 401 and the service is never called", async () => {
  const app = buildTestApp(unusedRecordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(baseUrl, {
        normalizedSignal: validNormalizedSignal(),
        rawPayload: {},
      });
      const body = await readJson(res);
      assert.equal(res.status, 401);
      assert.deepEqual(body, { error: "Unauthorized.", code: "unauthorized" });
    }),
  );
});

test("POST /internal/signals: incorrect secret is rejected with 401 and the service is never called", async () => {
  const app = buildTestApp(unusedRecordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal(), rawPayload: {} },
        { "x-gtm-ingestion-secret": "wrong-secret-value-1234567" },
      );
      const body = await readJson(res);
      assert.equal(res.status, 401);
      assert.deepEqual(body, { error: "Unauthorized.", code: "unauthorized" });
    }),
  );
});

test("POST /internal/signals: an unconfigured secret fails closed with 503 and the service is never called", async () => {
  const app = buildTestApp(unusedRecordSignalFn);

  await withEnvSecret(undefined, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal(), rawPayload: {} },
        { "x-gtm-ingestion-secret": "anything" },
      );
      const body = await readJson(res);
      assert.equal(res.status, 503);
      assert.deepEqual(body, {
        error: "Signal ingestion is unavailable.",
        code: "signal_ingestion_unavailable",
      });
    }),
  );
});

// ---------------------------------------------------------------------
// Request contract validation
// ---------------------------------------------------------------------

test("POST /internal/signals: an invalid normalized-signal contract returns 400 and the service is never called", async () => {
  const recordSignalFn = mock.fn<RecordSignalFn>(unusedRecordSignalFn);
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      // contact-level resolution with no person object violates
      // NormalizedSignalV1Schema's cross-field superRefine.
      const res = await postSignal(
        baseUrl,
        {
          normalizedSignal: validNormalizedSignal({ observedResolutionLevel: "contact" }),
          rawPayload: {},
        },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      const body = await readJson(res);
      assert.equal(res.status, 400);
      assert.deepEqual(body, { error: "The request body is invalid.", code: "invalid_request" });
      assert.equal(recordSignalFn.mock.calls.length, 0);
    }),
  );
});

test("POST /internal/signals: a missing rawPayload returns 400 and the service is never called", async () => {
  const recordSignalFn = mock.fn<RecordSignalFn>(unusedRecordSignalFn);
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal() },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      assert.equal(res.status, 400);
      assert.equal(recordSignalFn.mock.calls.length, 0);
    }),
  );
});

for (const [label, badRawPayload] of [
  ["an array", [1, 2, 3]],
  ["a string", "not-an-object"],
  ["a number", 5],
  ["null", null],
] as const) {
  test(`POST /internal/signals: rawPayload as ${label} returns 400 and the service is never called`, async () => {
    const recordSignalFn = mock.fn<RecordSignalFn>(unusedRecordSignalFn);
    const app = buildTestApp(recordSignalFn);

    await withEnvSecret(TEST_SECRET, () =>
      withServer(app, async (baseUrl) => {
        const res = await postSignal(
          baseUrl,
          { normalizedSignal: validNormalizedSignal(), rawPayload: badRawPayload },
          { "x-gtm-ingestion-secret": TEST_SECRET },
        );
        assert.equal(res.status, 400);
        assert.equal(recordSignalFn.mock.calls.length, 0);
      }),
    );
  });
}

test("POST /internal/signals: an unknown top-level key returns 400 and the service is never called", async () => {
  const recordSignalFn = mock.fn<RecordSignalFn>(unusedRecordSignalFn);
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        {
          normalizedSignal: validNormalizedSignal(),
          rawPayload: {},
          unexpectedField: true,
        },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      assert.equal(res.status, 400);
      assert.equal(recordSignalFn.mock.calls.length, 0);
    }),
  );
});

// ---------------------------------------------------------------------
// Service outcome / error mapping
// ---------------------------------------------------------------------

test("POST /internal/signals: a 'duplicate' outcome returns 200 with the existing signal's identifiers", async () => {
  const signal = syntheticSignal({ id: VALID_SIGNAL_ID });
  const recordSignalFn = mock.fn<RecordSignalFn>(
    async (): Promise<RecordSignalResult> => ({ outcome: "duplicate", signal }),
  );
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal(), rawPayload: {} },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.equal(body.signalId, VALID_SIGNAL_ID);
      assert.equal(body.status, "duplicate");
      assert.equal(body.source, signal.source);
      assert.equal(body.sourceEventId, signal.sourceEventId);
    }),
  );
});

test("POST /internal/signals: a 'conflict' outcome returns 409 with the existing signal id, no overwrite implied", async () => {
  const existingSignal = syntheticSignal({ id: EXISTING_SIGNAL_ID });
  const recordSignalFn = mock.fn<RecordSignalFn>(
    async (): Promise<RecordSignalResult> => ({ outcome: "conflict", existingSignal }),
  );
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal(), rawPayload: {} },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      const body = await readJson(res);
      assert.equal(res.status, 409);
      assert.deepEqual(body, {
        error:
          "A signal already exists for this source and sourceEventId with different content.",
        code: "signal_conflict",
        existingSignalId: EXISTING_SIGNAL_ID,
      });
    }),
  );
});

test("POST /internal/signals: InvalidSignalDomainError from the service maps to 400 invalid_request", async () => {
  const recordSignalFn = mock.fn<RecordSignalFn>(async () => {
    throw new InvalidSignalDomainError();
  });
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal(), rawPayload: {} },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      const body = await readJson(res);
      assert.equal(res.status, 400);
      assert.deepEqual(body, { error: "The request body is invalid.", code: "invalid_request" });
    }),
  );
});

test("POST /internal/signals: InvalidSignalWorkEmailError from the service maps to 400 invalid_request", async () => {
  const recordSignalFn = mock.fn<RecordSignalFn>(async () => {
    throw new InvalidSignalWorkEmailError();
  });
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal(), rawPayload: {} },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      const body = await readJson(res);
      assert.equal(res.status, 400);
      assert.deepEqual(body, { error: "The request body is invalid.", code: "invalid_request" });
    }),
  );
});

test("POST /internal/signals: an unexpected service error maps to 500 internal_error", async () => {
  const recordSignalFn = mock.fn<RecordSignalFn>(async () => {
    throw new Error("unexpected failure");
  });
  const app = buildTestApp(recordSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: validNormalizedSignal(), rawPayload: {} },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      const body = await readJson(res);
      assert.equal(res.status, 500);
      assert.deepEqual(body, { error: "An unexpected error occurred.", code: "internal_error" });
    }),
  );
});

// ---------------------------------------------------------------------
// Logging safety
// ---------------------------------------------------------------------

test("POST /internal/signals: does not log the ingestion secret, rawPayload, or normalizedSignal person/company content", async () => {
  const secretMarker = "s3cret-marker-must-not-appear-in-logs";
  const rawPayloadMarker = "raw-payload-marker-must-not-appear-in-logs";
  const emailMarker = "jane.doe@example.com";

  const signal = syntheticSignal();
  const recordSignalFn = mock.fn<RecordSignalFn>(async () => ({
    outcome: "created",
    signal,
  }));
  const log = createFakeLogger();
  const app = buildTestApp(recordSignalFn, log);

  await withEnvSecret(secretMarker, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        {
          normalizedSignal: validNormalizedSignal({
            observedResolutionLevel: "contact",
            company: { domain: "example.com", name: "Example Inc", externalIds: {} },
            person: {
              fullName: "Jane Doe",
              workEmail: emailMarker,
              title: null,
              linkedinUrl: null,
              externalIds: {},
            },
          }),
          rawPayload: { marker: rawPayloadMarker },
        },
        { "x-gtm-ingestion-secret": secretMarker },
      );
      assert.equal(res.status, 201);
    }),
  );

  const serialized = JSON.stringify(log.calls);
  assert.ok(!serialized.includes(secretMarker), "the ingestion secret must never be logged");
  assert.ok(!serialized.includes(rawPayloadMarker), "rawPayload must never be logged");
  assert.ok(!serialized.includes(emailMarker), "a work email must never be logged");
  assert.ok(!serialized.includes("Jane Doe"), "a full name must never be logged");
});

test("POST /internal/signals: a validation failure does not log request body content", async () => {
  const secretMarker = "s3cret-marker-must-not-appear-in-logs-2";
  const rawPayloadMarker = "raw-payload-marker-must-not-appear-in-logs-2";
  const log = createFakeLogger();
  const app = buildTestApp(unusedRecordSignalFn, log);

  await withEnvSecret(secretMarker, () =>
    withServer(app, async (baseUrl) => {
      const res = await postSignal(
        baseUrl,
        { normalizedSignal: { bogus: true }, rawPayload: { marker: rawPayloadMarker } },
        { "x-gtm-ingestion-secret": secretMarker },
      );
      assert.equal(res.status, 400);
    }),
  );

  const serialized = JSON.stringify(log.calls);
  assert.ok(!serialized.includes(secretMarker), "the ingestion secret must never be logged");
  assert.ok(!serialized.includes(rawPayloadMarker), "rawPayload must never be logged");
});
