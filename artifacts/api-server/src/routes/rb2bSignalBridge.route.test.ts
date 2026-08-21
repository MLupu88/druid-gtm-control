// Route-level tests for POST /internal/rb2b/signals. No database of any
// kind — real or fake — is ever constructed here: createRb2bSignalBridgeRouter
// accepts a dependency shape with no `db` field once both
// recordObservationFn and resolvePersonAccountFn are supplied directly.
// Runs a real ephemeral HTTP server, mirroring ./accounts.route.test.ts.
//
// M3.5 — this router previously had no route-level test file at all (the
// observation write path was only exercised via
// ../services/rb2bObservationMapping.integration.test.ts, which calls
// recordObservation() directly, never through the HTTP route). This file
// closes that gap AND covers the new identity-resolution wiring: it must
// run after a successful observation write, must never gate/fail that
// write, and must never run at all on an observation conflict.
//
// Run with: tsx --test src/routes/rb2bSignalBridge.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { Observation } from "@workspace/db/schema";
import {
  createRb2bSignalBridgeRouter,
  type RecordObservationFn,
  type ResolvePersonAccountFn,
} from "./rb2bSignalBridge.js";
import type { Rb2bPersonAccountBinding } from "../services/rb2bIdentity.js";

const VALID_BODY = {
  source: "rb2b" as const,
  signal_type: "page_view",
  source_record_id: "evt-1",
  ingestion_attempt_at: "2026-08-22T10:00:00Z",
};

function syntheticObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    provider: "rb2b",
    sourceRecordId: "evt-1",
    observationClass: "behavioral_signal",
    semanticKey: "page_view",
    identitySubjectType: null,
    identityValue: null,
    rawValue: VALID_BODY,
    normalizedValue: null,
    observedAt: null,
    importedAt: new Date("2026-08-22T10:00:00Z"),
    confidence: null,
    evidenceRefs: [],
    providerMetadata: null,
    ...overrides,
  };
}

function syntheticBinding(overrides: Partial<Rb2bPersonAccountBinding> = {}): Rb2bPersonAccountBinding {
  return {
    accountResolution: {
      outcome: "resolved",
      accountId: "bbbbbbbb-0000-4000-8000-000000000001",
      matchAction: "created",
      methodToken: "account_domain",
    },
    personResolution: { attempted: false },
    ...overrides,
  };
}

// Called by whichever path a given test is NOT exercising — throwing turns
// any unexpected cross-path invocation into a loud test failure.
const unusedResolvePersonAccountFn: ResolvePersonAccountFn = async () => {
  throw new Error("resolvePersonAccountFn should not have been called");
};

function buildTestApp(deps: {
  recordObservationFn: RecordObservationFn;
  resolvePersonAccountFn?: ResolvePersonAccountFn;
}): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info() {}, warn() {}, error() {} } as never;
    next();
  });
  app.use(
    "/internal/rb2b/signals",
    createRb2bSignalBridgeRouter({
      recordObservationFn: deps.recordObservationFn,
      resolvePersonAccountFn: deps.resolvePersonAccountFn ?? unusedResolvePersonAccountFn,
    }),
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
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function postSignal(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/internal/rb2b/signals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: globalThis.Response, context: string): Promise<Record<string, unknown>> {
  const value: unknown = await res.json();
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${context} must be a JSON object`);
  return value as Record<string, unknown>;
}

test("a created observation triggers identity resolution exactly once, and the binding is included in the response", async () => {
  const recordObservationFn = mock.fn<RecordObservationFn>(async () => ({
    outcome: "created",
    observation: syntheticObservation(),
  }));
  const resolvePersonAccountFn = mock.fn<ResolvePersonAccountFn>(async () => syntheticBinding());
  const app = buildTestApp({ recordObservationFn, resolvePersonAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postSignal(baseUrl, VALID_BODY);
    const body = await readJson(res, "created response");

    assert.equal(res.status, 201);
    assert.equal(recordObservationFn.mock.calls.length, 1);
    assert.equal(resolvePersonAccountFn.mock.calls.length, 1);
    assert.deepEqual(resolvePersonAccountFn.mock.calls[0]?.arguments[0], VALID_BODY);
    assert.deepEqual(body.identity, {
      account: syntheticBinding().accountResolution,
      person: syntheticBinding().personResolution,
    });
  });
});

test("a duplicate observation (idempotent replay) still runs identity resolution", async () => {
  const recordObservationFn = mock.fn<RecordObservationFn>(async () => ({
    outcome: "duplicate",
    observation: syntheticObservation(),
  }));
  const resolvePersonAccountFn = mock.fn<ResolvePersonAccountFn>(async () => syntheticBinding());
  const app = buildTestApp({ recordObservationFn, resolvePersonAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postSignal(baseUrl, VALID_BODY);
    assert.equal(res.status, 200);
    assert.equal(resolvePersonAccountFn.mock.calls.length, 1);
  });
});

test("an observation conflict returns 409 and never attempts identity resolution", async () => {
  const recordObservationFn = mock.fn<RecordObservationFn>(async () => ({
    outcome: "conflict",
    existingObservation: syntheticObservation(),
  }));
  const app = buildTestApp({ recordObservationFn }); // resolvePersonAccountFn defaults to "unused"

  await withServer(app, async (baseUrl) => {
    const res = await postSignal(baseUrl, VALID_BODY);
    assert.equal(res.status, 409);
  });
});

test("a failed identity resolution never fails the request — the observation write already succeeded", async () => {
  const recordObservationFn = mock.fn<RecordObservationFn>(async () => ({
    outcome: "created",
    observation: syntheticObservation(),
  }));
  const resolvePersonAccountFn = mock.fn<ResolvePersonAccountFn>(async () => {
    throw new Error("identity resolution boom");
  });
  const app = buildTestApp({ recordObservationFn, resolvePersonAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postSignal(baseUrl, VALID_BODY);
    const body = await readJson(res, "identity-failure response");

    assert.equal(res.status, 201);
    assert.equal(body.observationId, syntheticObservation().id);
    assert.equal(body.identity, null);
  });
});

test("an invalid request body is rejected with 400 before either function is called", async () => {
  const recordObservationFn = mock.fn<RecordObservationFn>(async () => ({
    outcome: "created",
    observation: syntheticObservation(),
  }));
  const app = buildTestApp({ recordObservationFn });

  await withServer(app, async (baseUrl) => {
    const res = await postSignal(baseUrl, { source: "rb2b" });
    assert.equal(res.status, 400);
    assert.equal(recordObservationFn.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------
// M3.5 real-data defect fix — a companion identity observation must also
// be recorded when company_domain is present, so
// ../services/observationSubjectBinding.ts can later bind the
// behavioral observation to an account. See
// ../services/rb2bObservationMapping.ts's module comment.
// ---------------------------------------------------------------------

const BODY_WITH_DOMAIN = { ...VALID_BODY, company_domain: "acme.com" };

test("when company_domain is present, a second recordObservationFn call records a companion identity/domain observation", async () => {
  const recordObservationFn = mock.fn<RecordObservationFn>(async () => ({
    outcome: "created",
    observation: syntheticObservation(),
  }));
  const resolvePersonAccountFn = mock.fn<ResolvePersonAccountFn>(async () => syntheticBinding());
  const app = buildTestApp({ recordObservationFn, resolvePersonAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postSignal(baseUrl, BODY_WITH_DOMAIN);
    assert.equal(res.status, 201);
    assert.equal(recordObservationFn.mock.calls.length, 2);

    const identityCall = recordObservationFn.mock.calls[1]?.arguments[0];
    assert.equal(identityCall?.observation.observationClass, "identity");
    if (identityCall?.observation.observationClass === "identity") {
      assert.equal(identityCall.observation.identityKey, "domain");
      assert.equal(identityCall.observation.identityValue, "acme.com");
      assert.equal(identityCall.observation.sourceRecordId, BODY_WITH_DOMAIN.source_record_id);
    }
  });
});

test("without company_domain, only the behavioral observation is recorded — no fabricated identity observation", async () => {
  const recordObservationFn = mock.fn<RecordObservationFn>(async () => ({
    outcome: "created",
    observation: syntheticObservation(),
  }));
  const resolvePersonAccountFn = mock.fn<ResolvePersonAccountFn>(async () => syntheticBinding());
  const app = buildTestApp({ recordObservationFn, resolvePersonAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postSignal(baseUrl, VALID_BODY);
    assert.equal(res.status, 201);
    assert.equal(recordObservationFn.mock.calls.length, 1);
  });
});

test("a failure recording the companion identity observation never fails the request — the behavioral observation already succeeded", async () => {
  let calls = 0;
  const recordObservationFn = mock.fn<RecordObservationFn>(async () => {
    calls += 1;
    if (calls === 1) {
      return { outcome: "created", observation: syntheticObservation() };
    }
    throw new Error("identity observation write boom");
  });
  const resolvePersonAccountFn = mock.fn<ResolvePersonAccountFn>(async () => syntheticBinding());
  const app = buildTestApp({ recordObservationFn, resolvePersonAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postSignal(baseUrl, BODY_WITH_DOMAIN);
    const body = await readJson(res, "identity-observation-failure response");

    assert.equal(res.status, 201);
    assert.equal(body.observationId, syntheticObservation().id);
    assert.equal(calls, 2);
    // Identity resolution still ran — the identity-observation failure
    // is isolated from it entirely.
    assert.equal(resolvePersonAccountFn.mock.calls.length, 1);
  });
});
