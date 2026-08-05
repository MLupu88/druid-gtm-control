// Route-level tests for POST /internal/signals/:signalId/resolve. No
// database of any kind — real or fake — is ever constructed here:
// createSignalResolutionRouter accepts a dependency shape with no `db`
// field at all once resolveSignalFn is supplied directly (see
// SignalResolutionRouterDeps in ./signalResolution.ts), so these tests
// inject a fully-typed fake instead of a real service/database. Mounts
// requireServiceAuth in front of the router exactly as production wiring
// does (see ./index.ts), so the auth tests below exercise the real
// middleware, not a stand-in. Runs a real ephemeral HTTP server
// (app.listen(0)) and issues real fetch() requests, mirroring
// ./signals.route.test.ts.
//
// Run with: tsx --test src/routes/signalResolution.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { IdentityResolutionEvent } from "@workspace/db/schema";
import { requireServiceAuth } from "../middlewares/requireServiceAuth.js";
import {
  CorruptSignalPayloadError,
  type ResolveSignalResult,
  type CurrentIdentityBindingResult,
} from "../services/identityResolution.js";
import {
  createSignalResolutionRouter,
  type ResolveSignalFn,
  type GetCurrentIdentityBindingFn,
} from "./signalResolution.js";

const VALID_SIGNAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEST_SECRET = "test-ingestion-secret-value";

function syntheticEvent(overrides: Partial<IdentityResolutionEvent> = {}): IdentityResolutionEvent {
  return {
    id: EVENT_ID,
    signalId: VALID_SIGNAL_ID,
    outcome: "account_resolved",
    resolutionLevel: "company",
    resolutionMethod: "account_domain",
    confidence: "high",
    resolverVersion: "identity-resolver-v1",
    candidateMatches: null,
    accountId: ACCOUNT_ID,
    accountMatchAction: "matched",
    personId: null,
    personMatchAction: null,
    matchedAliasType: null,
    matchedAliasValue: null,
    reason: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as IdentityResolutionEvent;
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

const unusedGetCurrentIdentityBindingFn: GetCurrentIdentityBindingFn = async () => {
  throw new Error("getCurrentIdentityBindingFn should not have been called");
};

function buildTestApp(
  resolveSignalFn: ResolveSignalFn,
  log: ReturnType<typeof createFakeLogger> = createFakeLogger(),
  getCurrentIdentityBindingFn: GetCurrentIdentityBindingFn = unusedGetCurrentIdentityBindingFn,
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = log as never;
    next();
  });
  app.use(
    "/internal/signals",
    requireServiceAuth,
    createSignalResolutionRouter({ resolveSignalFn, getCurrentIdentityBindingFn }),
  );
  return app;
}

function buildIdentityTestApp(
  getCurrentIdentityBindingFn: GetCurrentIdentityBindingFn,
  log: ReturnType<typeof createFakeLogger> = createFakeLogger(),
): Express {
  return buildTestApp(unusedResolveSignalFn, log, getCurrentIdentityBindingFn);
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

const unusedResolveSignalFn: ResolveSignalFn = async () => {
  throw new Error("resolveSignalFn should not have been called");
};

function postResolve(
  baseUrl: string,
  signalId: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<globalThis.Response> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}/internal/signals/${signalId}/resolve`, init);
}

function getIdentity(
  baseUrl: string,
  signalId: string,
  headers: Record<string, string> = {},
): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/internal/signals/${signalId}/identity`, { headers });
}

// ---------------------------------------------------------------------
// Auth boundary reuse (same requireServiceAuth as signal ingestion)
// ---------------------------------------------------------------------

test("POST /internal/signals/:signalId/resolve: correct secret is accepted and reaches the service", async () => {
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => ({
    kind: "completed",
    status: "resolved",
    event: syntheticEvent(),
  }));
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      assert.equal(res.status, 200);
      assert.equal(resolveSignalFn.mock.calls.length, 1);
      assert.deepEqual(resolveSignalFn.mock.calls[0]?.arguments[0], { signalId: VALID_SIGNAL_ID });
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: missing secret header is rejected with 401 and the service is never called", async () => {
  const app = buildTestApp(unusedResolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {});
      const body = await readJson(res);
      assert.equal(res.status, 401);
      assert.deepEqual(body, { error: "Unauthorized.", code: "unauthorized" });
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: incorrect secret is rejected with 401", async () => {
  const app = buildTestApp(unusedResolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": "wrong-secret" });
      assert.equal(res.status, 401);
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: an unconfigured secret fails closed with 503", async () => {
  const app = buildTestApp(unusedResolveSignalFn);

  await withEnvSecret(undefined, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": "anything" });
      const body = await readJson(res);
      assert.equal(res.status, 503);
      assert.deepEqual(body, { error: "Signal ingestion is unavailable.", code: "signal_ingestion_unavailable" });
    }),
  );
});

// ---------------------------------------------------------------------
// Missing signal
// ---------------------------------------------------------------------

test("POST /internal/signals/:signalId/resolve: missing signal returns 404 signal_not_found", async () => {
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => ({ kind: "signal_not_found" }));
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 404);
      assert.deepEqual(body, { error: "The signal was not found.", code: "signal_not_found" });
    }),
  );
});

// ---------------------------------------------------------------------
// Request body contract — no resolution evidence accepted
// ---------------------------------------------------------------------

test("POST /internal/signals/:signalId/resolve: no body at all is accepted", async () => {
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => ({
    kind: "completed",
    status: "resolved",
    event: syntheticEvent(),
  }));
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, undefined, {
        "x-gtm-ingestion-secret": TEST_SECRET,
      });
      assert.equal(res.status, 200);
      assert.equal(resolveSignalFn.mock.calls.length, 1);
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: an empty JSON object {} is accepted", async () => {
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => ({
    kind: "completed",
    status: "resolved",
    event: syntheticEvent(),
  }));
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      assert.equal(res.status, 200);
      assert.equal(resolveSignalFn.mock.calls.length, 1);
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: a non-empty body is rejected with 400 and the service is never called", async () => {
  const resolveSignalFn = mock.fn<ResolveSignalFn>(unusedResolveSignalFn);
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(
        baseUrl,
        VALID_SIGNAL_ID,
        { accountId: "some-evidence-the-caller-must-not-be-able-to-inject" },
        { "x-gtm-ingestion-secret": TEST_SECRET },
      );
      const body = await readJson(res);
      assert.equal(res.status, 400);
      assert.deepEqual(body, { error: "The request body is invalid.", code: "invalid_request" });
      assert.equal(resolveSignalFn.mock.calls.length, 0);
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: a malformed (non-UUID) signalId is rejected with 400 before the service is called", async () => {
  const resolveSignalFn = mock.fn<ResolveSignalFn>(unusedResolveSignalFn);
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, "not-a-uuid", {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      assert.equal(res.status, 400);
      assert.equal(resolveSignalFn.mock.calls.length, 0);
    }),
  );
});

// ---------------------------------------------------------------------
// Response shape for every outcome, and resolved vs. replayed status
// ---------------------------------------------------------------------

test("POST /internal/signals/:signalId/resolve: newly computed unresolved outcome", async () => {
  const event = syntheticEvent({
    outcome: "unresolved",
    resolutionLevel: "anonymous",
    accountId: null,
    accountMatchAction: null,
    personId: null,
    personMatchAction: null,
    resolutionMethod: "no_strong_company_identity",
    reason: "no_strong_company_identity",
    confidence: "low",
  });
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => ({ kind: "completed", status: "resolved", event }));
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.deepEqual(body, {
        signalId: VALID_SIGNAL_ID,
        eventId: EVENT_ID,
        status: "resolved",
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        accountId: null,
        personId: null,
        accountMatchAction: null,
        personMatchAction: null,
        createdAt: event.createdAt.toISOString(),
      });
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: newly computed account_resolved outcome", async () => {
  const event = syntheticEvent();
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => ({ kind: "completed", status: "resolved", event }));
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.equal(body.status, "resolved");
      assert.equal(body.outcome, "account_resolved");
      assert.equal(body.accountId, ACCOUNT_ID);
      assert.equal(body.personId, null);
      assert.equal(body.accountMatchAction, "matched");
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: newly computed person_resolved outcome", async () => {
  const event = syntheticEvent({
    outcome: "person_resolved",
    resolutionLevel: "contact",
    personId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    personMatchAction: "created",
    resolutionMethod: "account_domain+person_created",
  });
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => ({ kind: "completed", status: "resolved", event }));
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.equal(body.outcome, "person_resolved");
      assert.equal(body.resolutionLevel, "contact");
      assert.equal(body.personMatchAction, "created");
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: idempotent replay reports status=replayed with the original eventId/createdAt", async () => {
  const originalCreatedAt = new Date("2025-06-01T00:00:00Z");
  const event = syntheticEvent({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", createdAt: originalCreatedAt });
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => ({ kind: "completed", status: "replayed", event }));
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.equal(body.status, "replayed");
      assert.equal(body.eventId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
      assert.equal(body.createdAt, originalCreatedAt.toISOString());
    }),
  );
});

// ---------------------------------------------------------------------
// Safe error mapping — an unexpected service failure never leaks
// internals, and logging carries only safe fields.
// ---------------------------------------------------------------------

test("POST /internal/signals/:signalId/resolve: an unexpected service error maps to a generic 500", async () => {
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => {
    throw new CorruptSignalPayloadError(VALID_SIGNAL_ID);
  });
  const app = buildTestApp(resolveSignalFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 500);
      assert.deepEqual(body, { error: "An unexpected error occurred.", code: "internal_error" });
    }),
  );
});

test("POST /internal/signals/:signalId/resolve: failure logging carries only safe fields, never raw error content", async () => {
  const log = createFakeLogger();
  const resolveSignalFn = mock.fn<ResolveSignalFn>(async () => {
    throw new Error("some internal detail that must never be logged verbatim");
  });
  const app = buildTestApp(resolveSignalFn, log);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      await postResolve(baseUrl, VALID_SIGNAL_ID, {}, { "x-gtm-ingestion-secret": TEST_SECRET });
      const errorCalls = log.calls.filter((c) => c.level === "error");
      assert.equal(errorCalls.length, 1);
      const [, message] = [errorCalls[0]?.arg0, errorCalls[0]?.arg1];
      assert.equal(message, "POST /internal/signals/:signalId/resolve failed");
      const loggedFields = errorCalls[0]?.arg0 as Record<string, unknown>;
      assert.deepEqual(Object.keys(loggedFields).sort(), ["pgConstraint", "pgErrorCode", "signalId"]);
    }),
  );
});

// =======================================================================
// GET /internal/signals/:signalId/identity — GTM V2 Stage 2 Unit 4
// =======================================================================

test("GET /internal/signals/:signalId/identity: correct secret is accepted and reaches the service", async () => {
  const getCurrentIdentityBindingFn = mock.fn<GetCurrentIdentityBindingFn>(async () => ({
    kind: "bound",
    event: syntheticEvent(),
  }));
  const app = buildIdentityTestApp(getCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID, { "x-gtm-ingestion-secret": TEST_SECRET });
      assert.equal(res.status, 200);
      assert.equal(getCurrentIdentityBindingFn.mock.calls.length, 1);
      assert.deepEqual(getCurrentIdentityBindingFn.mock.calls[0]?.arguments[0], { signalId: VALID_SIGNAL_ID });
    }),
  );
});

test("GET /internal/signals/:signalId/identity: missing secret header is rejected with 401 and the service is never called", async () => {
  const app = buildIdentityTestApp(unusedGetCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID);
      const body = await readJson(res);
      assert.equal(res.status, 401);
      assert.deepEqual(body, { error: "Unauthorized.", code: "unauthorized" });
    }),
  );
});

test("GET /internal/signals/:signalId/identity: incorrect secret is rejected with 401", async () => {
  const app = buildIdentityTestApp(unusedGetCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID, { "x-gtm-ingestion-secret": "wrong-secret" });
      assert.equal(res.status, 401);
    }),
  );
});

test("GET /internal/signals/:signalId/identity: an unconfigured secret fails closed with 503", async () => {
  const app = buildIdentityTestApp(unusedGetCurrentIdentityBindingFn);

  await withEnvSecret(undefined, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID, { "x-gtm-ingestion-secret": "anything" });
      const body = await readJson(res);
      assert.equal(res.status, 503);
      assert.deepEqual(body, { error: "Signal ingestion is unavailable.", code: "signal_ingestion_unavailable" });
    }),
  );
});

test("GET /internal/signals/:signalId/identity: a malformed (non-UUID) signalId is rejected with 400 before the service is called", async () => {
  const app = buildIdentityTestApp(unusedGetCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, "not-a-uuid", { "x-gtm-ingestion-secret": TEST_SECRET });
      assert.equal(res.status, 400);
    }),
  );
});

test("GET /internal/signals/:signalId/identity: missing signal returns 404 signal_not_found", async () => {
  const getCurrentIdentityBindingFn = mock.fn<GetCurrentIdentityBindingFn>(async () => ({
    kind: "signal_not_found",
  }));
  const app = buildIdentityTestApp(getCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 404);
      assert.deepEqual(body, { error: "The signal was not found.", code: "signal_not_found" });
    }),
  );
});

test("GET /internal/signals/:signalId/identity: signal with no resolution event returns 200 hasBinding=false, distinct from missing signal", async () => {
  const getCurrentIdentityBindingFn = mock.fn<GetCurrentIdentityBindingFn>(async () => ({ kind: "no_binding" }));
  const app = buildIdentityTestApp(getCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.deepEqual(body, {
        signalId: VALID_SIGNAL_ID,
        hasBinding: false,
        eventId: null,
        outcome: null,
        resolutionLevel: null,
        accountId: null,
        personId: null,
        accountMatchAction: null,
        personMatchAction: null,
        createdAt: null,
      });
    }),
  );
});

test("GET /internal/signals/:signalId/identity: an unresolved event is still a binding (hasBinding=true, outcome=unresolved)", async () => {
  const event = syntheticEvent({
    outcome: "unresolved",
    resolutionLevel: "anonymous",
    accountId: null,
    accountMatchAction: null,
    personId: null,
    personMatchAction: null,
    resolutionMethod: "no_strong_company_identity",
    reason: "no_strong_company_identity",
    confidence: "low",
  });
  const getCurrentIdentityBindingFn = mock.fn<GetCurrentIdentityBindingFn>(async () => ({ kind: "bound", event }));
  const app = buildIdentityTestApp(getCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.deepEqual(body, {
        signalId: VALID_SIGNAL_ID,
        hasBinding: true,
        eventId: EVENT_ID,
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        accountId: null,
        personId: null,
        accountMatchAction: null,
        personMatchAction: null,
        createdAt: event.createdAt.toISOString(),
      });
    }),
  );
});

test("GET /internal/signals/:signalId/identity: a resolved binding returns exactly the allow-listed fields, never raw payload/candidateMatches/reason/confidence/resolverVersion/resolutionMethod", async () => {
  const event = syntheticEvent();
  const getCurrentIdentityBindingFn = mock.fn<GetCurrentIdentityBindingFn>(async () => ({ kind: "bound", event }));
  const app = buildIdentityTestApp(getCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(body).sort(), [
        "accountId",
        "accountMatchAction",
        "createdAt",
        "eventId",
        "hasBinding",
        "outcome",
        "personId",
        "personMatchAction",
        "resolutionLevel",
        "signalId",
      ]);
      assert.equal(body.accountId, ACCOUNT_ID);
      assert.equal(body.accountMatchAction, "matched");
    }),
  );
});

test("GET /internal/signals/:signalId/identity: an unexpected service error maps to a generic 500", async () => {
  const getCurrentIdentityBindingFn = mock.fn<GetCurrentIdentityBindingFn>(async () => {
    throw new Error("some internal detail that must never leak");
  });
  const app = buildIdentityTestApp(getCurrentIdentityBindingFn);

  await withEnvSecret(TEST_SECRET, () =>
    withServer(app, async (baseUrl) => {
      const res = await getIdentity(baseUrl, VALID_SIGNAL_ID, { "x-gtm-ingestion-secret": TEST_SECRET });
      const body = await readJson(res);
      assert.equal(res.status, 500);
      assert.deepEqual(body, { error: "An unexpected error occurred.", code: "internal_error" });
    }),
  );
});
