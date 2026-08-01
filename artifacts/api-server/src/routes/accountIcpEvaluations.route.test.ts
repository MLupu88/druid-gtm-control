// Route-level tests for POST /api/internal/accounts/:accountId/icp-evaluations.
// No database of any kind — real or fake — is ever constructed here:
// createAccountIcpEvaluationsRouter accepts a dependency shape with no
// `db` field at all once runPreviewIcpEvaluationForAccountFn is supplied
// directly (see AccountIcpEvaluationsRouterDeps in
// ./accountIcpEvaluations.ts), so these tests inject a fully-typed fake
// instead of casting a stand-in object to the database type. Runs a real
// ephemeral HTTP server (app.listen(0)) and issues real fetch() requests,
// mirroring ./accountDecisions.route.test.ts and ./icpProfiles.route.test.ts.
//
// Scope: route validation, service invocation, response semantics, and
// error mapping only. Draft-versus-active profile-version resolution and
// any real Postgres behavior belong to the integration test slice, not
// here — every domain error below is thrown directly by the injected
// fake, never actually computed.
//
// Run with: tsx --test src/routes/accountIcpEvaluations.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { AccountEvaluation } from "@workspace/db/schema";
import {
  AccountNotFoundError,
  NoActiveProfileVersionError,
  NoResolvablePreviewVersionError,
} from "../services/icpEvaluationResolvers.js";
import { ProfileNotFoundError } from "../services/icpProfiles.js";
import {
  MissingRecordError,
  ProductionRequiresPublishedProfileError,
} from "@workspace/evaluator-persistence";
import { UnsupportedEvaluatorVersionError } from "@workspace/evaluator";
import {
  createAccountIcpEvaluationsRouter,
  type RunPreviewIcpEvaluationForAccountFn,
  type RunOfficialIcpEvaluationForAccountFn,
} from "./accountIcpEvaluations.js";

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const VALID_EVALUATION_ID = "33333333-3333-4333-8333-333333333333";
const VALID_SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";
const VALID_PROFILE_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const VALID_EVALUATOR_VERSION_ID = "66666666-6666-4666-8666-666666666666";

function syntheticEvaluation(
  overrides: Partial<AccountEvaluation> = {},
): AccountEvaluation {
  return {
    id: VALID_EVALUATION_ID,
    accountId: VALID_ACCOUNT_ID,
    snapshotId: VALID_SNAPSHOT_ID,
    profileVersionId: VALID_PROFILE_VERSION_ID,
    profileConfigSnapshot: { configSchemaVersion: "v1" },
    evaluatorVersionId: VALID_EVALUATOR_VERSION_ID,
    evaluationMode: "preview",
    status: "completed",
    errorDetail: null,
    fitScore: "10",
    fitTier: "high",
    intentScore: "0",
    intentTier: "floor",
    identityResolutionLevel: "anonymous",
    identityConfidence: "low",
    actionabilityScore: "0",
    eligibilityOutcome: "eligible",
    eligibilityRestrictions: [],
    hardDisqualifiers: [],
    scoreComponents: [],
    matchedRules: [],
    missingInputs: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    ...overrides,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

const unusedRunPreviewIcpEvaluationForAccountFn: RunPreviewIcpEvaluationForAccountFn =
  async () => {
    throw new Error(
      "runPreviewIcpEvaluationForAccountFn should not have been called",
    );
  };

const unusedRunOfficialIcpEvaluationForAccountFn: RunOfficialIcpEvaluationForAccountFn =
  async () => {
    throw new Error(
      "runOfficialIcpEvaluationForAccountFn should not have been called",
    );
  };

function buildTestApp(
  deps: {
    runPreviewIcpEvaluationForAccountFn?: RunPreviewIcpEvaluationForAccountFn;
    runOfficialIcpEvaluationForAccountFn?: RunOfficialIcpEvaluationForAccountFn;
  } = {},
): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/",
    createAccountIcpEvaluationsRouter({
      runPreviewIcpEvaluationForAccountFn:
        deps.runPreviewIcpEvaluationForAccountFn ??
        unusedRunPreviewIcpEvaluationForAccountFn,
      runOfficialIcpEvaluationForAccountFn:
        deps.runOfficialIcpEvaluationForAccountFn ??
        unusedRunOfficialIcpEvaluationForAccountFn,
    }),
  );
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

async function postIcpEvaluation(
  baseUrl: string,
  accountId: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/accounts/${accountId}/icp-evaluations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postOfficialIcpEvaluation(
  baseUrl: string,
  accountId: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/accounts/${accountId}/icp-evaluations/official`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------
// 1. Successful preview request
// ---------------------------------------------------------------------

test("POST returns 201 with the exact evaluation returned by the service, calling it exactly once with only accountId/profileId", async () => {
  const evaluation = syntheticEvaluation();
  const runPreviewIcpEvaluationForAccountFn =
    mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () => evaluation);
  const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
    });
    const body = await readJson(res);

    assert.equal(res.status, 201);
    assert.deepEqual(body, JSON.parse(JSON.stringify(evaluation)));
  });

  assert.equal(runPreviewIcpEvaluationForAccountFn.mock.calls.length, 1);
  const call = runPreviewIcpEvaluationForAccountFn.mock.calls[0];
  assert.ok(call, "runPreviewIcpEvaluationForAccountFn must have been called");
  assert.deepEqual(call.arguments[0], {
    accountId: VALID_ACCOUNT_ID,
    profileId: VALID_PROFILE_ID,
  });
});

// ---------------------------------------------------------------------
// 2-6. Request validation
// ---------------------------------------------------------------------

test("POST rejects a malformed accountId with 400 invalid_request and does not call the service", async () => {
  const runPreviewIcpEvaluationForAccountFn =
    mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postIcpEvaluation(baseUrl, "not-a-uuid", {
      profileId: VALID_PROFILE_ID,
    });
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runPreviewIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

test("POST rejects a body missing profileId with 400 invalid_request and does not call the service", async () => {
  const runPreviewIcpEvaluationForAccountFn =
    mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {});
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runPreviewIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

test("POST rejects a malformed profileId with 400 invalid_request and does not call the service", async () => {
  const runPreviewIcpEvaluationForAccountFn =
    mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: "not-a-uuid",
    });
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runPreviewIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

// Load-bearing: proves the strict request schema REJECTS evaluationMode
// rather than silently ignoring it — the only thing standing between this
// endpoint and a client smuggling "production" through.
test("POST rejects a body containing evaluationMode: \"production\" with 400 invalid_request and does not call the service", async () => {
  const runPreviewIcpEvaluationForAccountFn =
    mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
      evaluationMode: "production",
    });
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runPreviewIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

test("POST rejects a body containing an unrecognized field with 400 invalid_request and does not call the service", async () => {
  const runPreviewIcpEvaluationForAccountFn =
    mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
      unknownField: "nope",
    });
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runPreviewIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------
// 7. Persisted failed evaluation still returns 201, unchanged
// ---------------------------------------------------------------------

test("POST returns 201 with a persisted failed evaluation returned unchanged", async () => {
  const failedEvaluation = syntheticEvaluation({
    status: "failed",
    errorDetail: "account snapshot failed NormalizedAccountInputV1 validation",
    fitScore: null,
    fitTier: null,
    intentScore: null,
    intentTier: null,
    identityResolutionLevel: null,
    identityConfidence: null,
    actionabilityScore: null,
    eligibilityOutcome: null,
  });
  const runPreviewIcpEvaluationForAccountFn =
    mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () => failedEvaluation);
  const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
    });
    const body = await readJson(res);

    assert.equal(res.status, 201);
    assert.deepEqual(body, JSON.parse(JSON.stringify(failedEvaluation)));
    assert.equal(body.status, "failed");
  });
});

// ---------------------------------------------------------------------
// 8. Domain-error mappings
// ---------------------------------------------------------------------

const domainErrorCases: Array<{
  label: string;
  makeError: () => Error;
  status: number;
  code: string;
}> = [
  {
    label: "AccountNotFoundError",
    makeError: () => new AccountNotFoundError(VALID_ACCOUNT_ID),
    status: 404,
    code: "account_not_found",
  },
  {
    label: "ProfileNotFoundError",
    makeError: () => new ProfileNotFoundError(VALID_PROFILE_ID),
    status: 404,
    code: "profile_not_found",
  },
  {
    label: "NoResolvablePreviewVersionError",
    makeError: () => new NoResolvablePreviewVersionError(VALID_PROFILE_ID),
    status: 409,
    code: "no_resolvable_preview_version",
  },
  {
    label: "MissingRecordError",
    makeError: () =>
      new MissingRecordError("accountSnapshot", VALID_SNAPSHOT_ID),
    status: 404,
    code: "record_not_found",
  },
  {
    label: "UnsupportedEvaluatorVersionError",
    makeError: () => new UnsupportedEvaluatorVersionError("not-a-real-version"),
    status: 422,
    code: "unsupported_evaluator_version",
  },
];

for (const { label, makeError, status, code } of domainErrorCases) {
  test(`POST maps ${label} to ${status} ${code}`, async () => {
    const runPreviewIcpEvaluationForAccountFn =
      mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () => {
        throw makeError();
      });
    const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

    await withServer(app, async (baseUrl) => {
      const res = await postIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
        profileId: VALID_PROFILE_ID,
      });
      const body = await readJson(res);

      assert.equal(res.status, status);
      assert.equal(body.code, code);
      assert.equal(runPreviewIcpEvaluationForAccountFn.mock.calls.length, 1);
    });
  });
}

// ---------------------------------------------------------------------
// 9. Unexpected error
// ---------------------------------------------------------------------

test("POST maps an unexpected service error to a safe 500 response, without leaking the thrown message or stack", async () => {
  const runPreviewIcpEvaluationForAccountFn =
    mock.fn<RunPreviewIcpEvaluationForAccountFn>(async () => {
      throw new Error(
        "relation account_evaluations violates constraint xyz at connection pg://internal",
      );
    });
  const app = buildTestApp({ runPreviewIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
    });
    const body = await readJson(res);

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.equal(body.error, "An unexpected error occurred.");
    assert.ok(!String(body.error).includes("pg://internal"));
    assert.ok(!String(body.error).includes("constraint"));
    assert.equal(runPreviewIcpEvaluationForAccountFn.mock.calls.length, 1);
  });
});

// =======================================================================
// POST /api/internal/accounts/:accountId/icp-evaluations/official
// =======================================================================

// ---------------------------------------------------------------------
// 10. Successful official evaluation request
// ---------------------------------------------------------------------

test("POST /official returns 201 with the exact evaluation returned by the service, calling it exactly once with accountId/profileId/createdBy", async () => {
  const evaluation = syntheticEvaluation({ evaluationMode: "production" });
  const runOfficialIcpEvaluationForAccountFn =
    mock.fn<RunOfficialIcpEvaluationForAccountFn>(async () => evaluation);
  const app = buildTestApp({ runOfficialIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postOfficialIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
    });
    const body = await readJson(res);

    assert.equal(res.status, 201);
    assert.deepEqual(body, JSON.parse(JSON.stringify(evaluation)));
  });

  assert.equal(runOfficialIcpEvaluationForAccountFn.mock.calls.length, 1);
  const call = runOfficialIcpEvaluationForAccountFn.mock.calls[0];
  assert.ok(call, "runOfficialIcpEvaluationForAccountFn must have been called");
  assert.deepEqual(call.arguments[0], {
    accountId: VALID_ACCOUNT_ID,
    profileId: VALID_PROFILE_ID,
    createdBy: null,
  });
});

// ---------------------------------------------------------------------
// 11-14. Request validation — identical body contract to preview.
// ---------------------------------------------------------------------

test("POST /official rejects a malformed accountId with 400 invalid_request and does not call the service", async () => {
  const runOfficialIcpEvaluationForAccountFn =
    mock.fn<RunOfficialIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runOfficialIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postOfficialIcpEvaluation(baseUrl, "not-a-uuid", {
      profileId: VALID_PROFILE_ID,
    });
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runOfficialIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

test("POST /official rejects a body missing profileId with 400 invalid_request and does not call the service", async () => {
  const runOfficialIcpEvaluationForAccountFn =
    mock.fn<RunOfficialIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runOfficialIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postOfficialIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {});
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runOfficialIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

// Load-bearing: proves the strict request schema REJECTS evaluationMode
// rather than silently ignoring it — same guarantee as the preview
// endpoint's equivalent test above, now proven for /official too.
test('POST /official rejects a body containing evaluationMode: "preview" with 400 invalid_request and does not call the service', async () => {
  const runOfficialIcpEvaluationForAccountFn =
    mock.fn<RunOfficialIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runOfficialIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postOfficialIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
      evaluationMode: "preview",
    });
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runOfficialIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

test("POST /official rejects a body containing an unrecognized field with 400 invalid_request and does not call the service", async () => {
  const runOfficialIcpEvaluationForAccountFn =
    mock.fn<RunOfficialIcpEvaluationForAccountFn>(async () =>
      syntheticEvaluation(),
    );
  const app = buildTestApp({ runOfficialIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postOfficialIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
      unknownField: "nope",
    });
    const body = await readJson(res);

    assert.equal(res.status, 400);
    assert.equal(body.code, "invalid_request");
    assert.equal(runOfficialIcpEvaluationForAccountFn.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------
// 15. Persisted failed evaluation still returns 201, unchanged
// ---------------------------------------------------------------------

test("POST /official returns 201 with a persisted failed evaluation returned unchanged", async () => {
  const failedEvaluation = syntheticEvaluation({
    evaluationMode: "production",
    status: "failed",
    errorDetail: "account snapshot failed NormalizedAccountInputV1 validation",
    fitScore: null,
    fitTier: null,
    intentScore: null,
    intentTier: null,
    identityResolutionLevel: null,
    identityConfidence: null,
    actionabilityScore: null,
    eligibilityOutcome: null,
  });
  const runOfficialIcpEvaluationForAccountFn =
    mock.fn<RunOfficialIcpEvaluationForAccountFn>(async () => failedEvaluation);
  const app = buildTestApp({ runOfficialIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postOfficialIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
    });
    const body = await readJson(res);

    assert.equal(res.status, 201);
    assert.deepEqual(body, JSON.parse(JSON.stringify(failedEvaluation)));
    assert.equal(body.status, "failed");
  });
});

// ---------------------------------------------------------------------
// 16. Domain-error mappings
// ---------------------------------------------------------------------

const officialDomainErrorCases: Array<{
  label: string;
  makeError: () => Error;
  status: number;
  code: string;
}> = [
  {
    label: "AccountNotFoundError",
    makeError: () => new AccountNotFoundError(VALID_ACCOUNT_ID),
    status: 404,
    code: "account_not_found",
  },
  {
    label: "ProfileNotFoundError",
    makeError: () => new ProfileNotFoundError(VALID_PROFILE_ID),
    status: 404,
    code: "profile_not_found",
  },
  {
    label: "NoActiveProfileVersionError",
    makeError: () => new NoActiveProfileVersionError(VALID_PROFILE_ID),
    status: 409,
    code: "no_active_profile_version",
  },
  {
    label: "MissingRecordError",
    makeError: () =>
      new MissingRecordError("accountSnapshot", VALID_SNAPSHOT_ID),
    status: 404,
    code: "record_not_found",
  },
  {
    label: "ProductionRequiresPublishedProfileError",
    makeError: () =>
      new ProductionRequiresPublishedProfileError(
        VALID_PROFILE_VERSION_ID,
        "draft",
      ),
    status: 409,
    code: "production_requires_published_profile",
  },
  {
    label: "UnsupportedEvaluatorVersionError",
    makeError: () => new UnsupportedEvaluatorVersionError("not-a-real-version"),
    status: 422,
    code: "unsupported_evaluator_version",
  },
];

for (const { label, makeError, status, code } of officialDomainErrorCases) {
  test(`POST /official maps ${label} to ${status} ${code}`, async () => {
    const runOfficialIcpEvaluationForAccountFn =
      mock.fn<RunOfficialIcpEvaluationForAccountFn>(async () => {
        throw makeError();
      });
    const app = buildTestApp({ runOfficialIcpEvaluationForAccountFn });

    await withServer(app, async (baseUrl) => {
      const res = await postOfficialIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
        profileId: VALID_PROFILE_ID,
      });
      const body = await readJson(res);

      assert.equal(res.status, status);
      assert.equal(body.code, code);
      assert.equal(runOfficialIcpEvaluationForAccountFn.mock.calls.length, 1);
    });
  });
}

// ---------------------------------------------------------------------
// 17. Unexpected error
// ---------------------------------------------------------------------

test("POST /official maps an unexpected service error to a safe 500 response, without leaking the thrown message or stack", async () => {
  const runOfficialIcpEvaluationForAccountFn =
    mock.fn<RunOfficialIcpEvaluationForAccountFn>(async () => {
      throw new Error(
        "relation account_evaluations violates constraint xyz at connection pg://internal",
      );
    });
  const app = buildTestApp({ runOfficialIcpEvaluationForAccountFn });

  await withServer(app, async (baseUrl) => {
    const res = await postOfficialIcpEvaluation(baseUrl, VALID_ACCOUNT_ID, {
      profileId: VALID_PROFILE_ID,
    });
    const body = await readJson(res);

    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.equal(body.error, "An unexpected error occurred.");
    assert.ok(!String(body.error).includes("pg://internal"));
    assert.ok(!String(body.error).includes("constraint"));
    assert.equal(runOfficialIcpEvaluationForAccountFn.mock.calls.length, 1);
  });
});
