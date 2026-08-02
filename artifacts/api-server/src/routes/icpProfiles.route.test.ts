// Route-level tests for /api/internal/icp-profiles. No database needed —
// createIcpProfilesRouter's db is a required but unused fake object here,
// and every service function is always an injected fake. Runs a real
// ephemeral HTTP server (app.listen(0)) and issues real fetch() requests,
// mirroring ./accountEvaluations.route.test.ts.
//
// Run with: tsx --test src/routes/icpProfiles.route.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mock, test } from "node:test";
import express, { type Express } from "express";
import type { IcpProfile, IcpProfileVersion } from "@workspace/db/schema";
import {
  ProfileNotFoundError,
  VersionNotFoundError,
  VersionBelongsToAnotherProfileError,
  DraftAlreadyExistsError,
  NoDraftVersionError,
  VersionNotPublishedError,
  InvalidProfileConfigError,
  NotReadyForPublishError,
  type ActivateVersionResult,
  type ProfileDetail,
  type ProfileListItem,
} from "../services/icpProfiles.js";
import type { Operator } from "../lib/operators.js";
import {
  createIcpProfilesRouter,
  type IcpProfilesRouterDeps,
} from "./icpProfiles.js";

// Explicit signatures for the mocks below — without these, mock.fn()
// infers a zero-argument function from the no-arg implementation callback
// used in most tests, which types `.mock.calls[n].arguments` as an empty
// tuple `[]`. That's fine for tests that never read the call arguments,
// but the tests that inspect `arguments[0]` need the real dependency
// signature so that access is actually type-checked, not just cast away.
type CreateProfileFn = NonNullable<IcpProfilesRouterDeps["createProfileFn"]>;
type UpdateDraftFn = NonNullable<IcpProfilesRouterDeps["updateDraftFn"]>;

const VALID_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const VALID_VERSION_ID = "22222222-2222-4222-8222-222222222222";

function syntheticProfileConfig() {
  return {
    configSchemaVersion: "v1",
    fit: { rules: [], tiers: [{ code: "base", minScore: 0 }] },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

function syntheticProfile(overrides: Partial<IcpProfile> = {}): IcpProfile {
  return {
    id: VALID_PROFILE_ID,
    name: "Enterprise ICP",
    description: null,
    activeVersionId: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    ...overrides,
  };
}

function syntheticVersion(
  overrides: Partial<IcpProfileVersion> = {},
): IcpProfileVersion {
  return {
    id: VALID_VERSION_ID,
    profileId: VALID_PROFILE_ID,
    versionNumber: 1,
    status: "draft",
    config: syntheticProfileConfig(),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    publishedAt: null,
    notes: null,
    ...overrides,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function buildTestApp(
  deps: Omit<IcpProfilesRouterDeps, "db">,
  operator?: Operator,
): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info: () => {}, warn: () => {}, error: () => {} } as never;
    if (operator) req.operator = operator;
    next();
  });
  app.use("/", createIcpProfilesRouter({ db: {} as never, ...deps }));
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

// ---------------------------------------------------------------------
// POST / (create)
// ---------------------------------------------------------------------

test("POST / with a valid body invokes the service once and returns 201", async () => {
  const created = {
    profile: syntheticProfile(),
    draftVersion: syntheticVersion(),
  };
  const createProfileFn = mock.fn(async () => created);
  const app = buildTestApp({ createProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Enterprise ICP",
        config: syntheticProfileConfig(),
      }),
    });
    const body = await readJson(res);

    assert.equal(res.status, 201);
    assert.deepEqual(body, JSON.parse(JSON.stringify(created)));
    assert.equal(createProfileFn.mock.calls.length, 1);
  });
});

test("POST / trims the name and defaults description to null", async () => {
  const created = {
    profile: syntheticProfile(),
    draftVersion: syntheticVersion(),
  };
  const createProfileFn = mock.fn<CreateProfileFn>(async () => created);
  const app = buildTestApp({ createProfileFn });

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "  Enterprise ICP  ",
        config: syntheticProfileConfig(),
      }),
    });
  });

  const call = createProfileFn.mock.calls[0];
  assert.ok(call, "createProfileFn must have been called");
  const args = call.arguments[0];
  assert.equal(args.name, "Enterprise ICP");
  assert.equal(args.description, null);
});

test("POST / rejects a body missing config with 400 and does not call the service", async () => {
  const createProfileFn = mock.fn(async () => ({
    profile: syntheticProfile(),
    draftVersion: syntheticVersion(),
  }));
  const app = buildTestApp({ createProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Enterprise ICP" }),
    });
    assert.equal(res.status, 400);
    const body = await readJson(res);
    assert.equal(body.code, "invalid_request");
    assert.equal(createProfileFn.mock.calls.length, 0);
  });
});

test("POST / rejects a blank name with 400", async () => {
  const createProfileFn = mock.fn(async () => ({
    profile: syntheticProfile(),
    draftVersion: syntheticVersion(),
  }));
  const app = buildTestApp({ createProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   ", config: syntheticProfileConfig() }),
    });
    assert.equal(res.status, 400);
    assert.equal(createProfileFn.mock.calls.length, 0);
  });
});

test("POST / rejects a body that supplies createdBy — it is never accepted from the client", async () => {
  const createProfileFn = mock.fn(async () => ({
    profile: syntheticProfile(),
    draftVersion: syntheticVersion(),
  }));
  const app = buildTestApp({ createProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Enterprise ICP",
        config: syntheticProfileConfig(),
        createdBy: "spoofed@example.test",
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(createProfileFn.mock.calls.length, 0);
  });
});

test("POST / derives createdBy from the verified operator's trimmed, non-empty email", async () => {
  const createProfileFn = mock.fn<CreateProfileFn>(async () => ({
    profile: syntheticProfile(),
    draftVersion: syntheticVersion(),
  }));
  const app = buildTestApp(
    { createProfileFn },
    { name: "Jane Operator", email: "  jane@example.test  ", role: "operator" },
  );

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Enterprise ICP",
        config: syntheticProfileConfig(),
      }),
    });
  });

  const call = createProfileFn.mock.calls[0];
  assert.ok(call, "createProfileFn must have been called");
  assert.equal(call.arguments[0].createdBy, "jane@example.test");
});

test("POST / persists createdBy as null when the operator has no non-empty email", async () => {
  const createProfileFn = mock.fn<CreateProfileFn>(async () => ({
    profile: syntheticProfile(),
    draftVersion: syntheticVersion(),
  }));
  const app = buildTestApp(
    { createProfileFn },
    { name: "Authenticated operator", email: "   ", role: "operator" },
  );

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Enterprise ICP",
        config: syntheticProfileConfig(),
      }),
    });
  });

  const call = createProfileFn.mock.calls[0];
  assert.ok(call, "createProfileFn must have been called");
  assert.equal(call.arguments[0].createdBy, null);
});

test("POST / maps InvalidProfileConfigError to 422", async () => {
  const createProfileFn = mock.fn(async () => {
    throw new InvalidProfileConfigError("fit.tiers: missing floor tier");
  });
  const app = buildTestApp({ createProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Enterprise ICP", config: {} }),
    });
    assert.equal(res.status, 422);
    const body = await readJson(res);
    assert.equal(body.code, "invalid_profile_config");
  });
});

test("POST / maps an unexpected error to a safe 500 with no internal details", async () => {
  const createProfileFn = mock.fn(async () => {
    throw new Error("relation icp_profiles violates constraint xyz");
  });
  const app = buildTestApp({ createProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Enterprise ICP",
        config: syntheticProfileConfig(),
      }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 500);
    assert.equal(body.code, "internal_error");
    assert.ok(!String(body.error).includes("constraint"));
  });
});

// ---------------------------------------------------------------------
// GET / (list)
// ---------------------------------------------------------------------

test("GET / returns 200 with the list from the service", async () => {
  const list: ProfileListItem[] = [
    {
      id: VALID_PROFILE_ID,
      name: "Enterprise ICP",
      description: null,
      archivedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      createdBy: null,
      activeVersion: null,
      draftVersion: null,
      latestVersion: null,
      classification: "no_active_definition",
      targetCriteria: [],
    },
  ];
  const listProfilesFn = mock.fn(async () => list);
  const app = buildTestApp({ listProfilesFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    const body = await readJson(res);
    assert.equal(res.status, 200);
    assert.deepEqual(body, JSON.parse(JSON.stringify(list)));
  });
});

// ---------------------------------------------------------------------
// GET /:profileId (retrieve)
// ---------------------------------------------------------------------

test("GET /:profileId returns 200 with the profile detail", async () => {
  const detail: ProfileDetail = {
    profile: syntheticProfile(),
    versions: [syntheticVersion()],
  };
  const getProfileFn = mock.fn(async () => detail);
  const app = buildTestApp({ getProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}`);
    const body = await readJson(res);
    assert.equal(res.status, 200);
    assert.deepEqual(body, JSON.parse(JSON.stringify(detail)));
  });
});

test("GET /:profileId returns 404 profile_not_found when the service returns undefined", async () => {
  const getProfileFn = mock.fn(async () => undefined);
  const app = buildTestApp({ getProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}`);
    const body = await readJson(res);
    assert.equal(res.status, 404);
    assert.equal(body.code, "profile_not_found");
  });
});

test("GET /:profileId rejects a non-UUID profileId with 400", async () => {
  const getProfileFn = mock.fn(async () => undefined);
  const app = buildTestApp({ getProfileFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-a-uuid`);
    assert.equal(res.status, 400);
    assert.equal(getProfileFn.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------
// PUT /:profileId/draft (update draft)
// ---------------------------------------------------------------------

test("PUT /:profileId/draft returns 200 with the updated draft", async () => {
  const updated = syntheticVersion({
    config: { configSchemaVersion: "v1", marker: "updated" },
  });
  const updateDraftFn = mock.fn(async () => updated);
  const app = buildTestApp({ updateDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: syntheticProfileConfig() }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 200);
    assert.deepEqual(body, JSON.parse(JSON.stringify(updated)));
  });
});

test("PUT /:profileId/draft passes notes through as undefined when omitted (leave unchanged)", async () => {
  const updateDraftFn = mock.fn<UpdateDraftFn>(async () => syntheticVersion());
  const app = buildTestApp({ updateDraftFn });

  await withServer(app, async (baseUrl) => {
    await fetch(`${baseUrl}/${VALID_PROFILE_ID}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: syntheticProfileConfig() }),
    });
  });

  const call = updateDraftFn.mock.calls[0];
  assert.ok(call, "updateDraftFn must have been called");
  assert.equal(call.arguments[0].notes, undefined);
});

test("PUT /:profileId/draft rejects a missing config with 400", async () => {
  const updateDraftFn = mock.fn(async () => syntheticVersion());
  const app = buildTestApp({ updateDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.equal(updateDraftFn.mock.calls.length, 0);
  });
});

test("PUT /:profileId/draft maps ProfileNotFoundError to 404", async () => {
  const updateDraftFn = mock.fn(async () => {
    throw new ProfileNotFoundError(VALID_PROFILE_ID);
  });
  const app = buildTestApp({ updateDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: syntheticProfileConfig() }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 404);
    assert.equal(body.code, "profile_not_found");
  });
});

test("PUT /:profileId/draft maps NoDraftVersionError to 409", async () => {
  const updateDraftFn = mock.fn(async () => {
    throw new NoDraftVersionError(VALID_PROFILE_ID);
  });
  const app = buildTestApp({ updateDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: syntheticProfileConfig() }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 409);
    assert.equal(body.code, "no_draft_version");
  });
});

test("PUT /:profileId/draft maps InvalidProfileConfigError to 422", async () => {
  const updateDraftFn = mock.fn(async () => {
    throw new InvalidProfileConfigError("bad shape");
  });
  const app = buildTestApp({ updateDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: {} }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 422);
    assert.equal(body.code, "invalid_profile_config");
  });
});

// ---------------------------------------------------------------------
// POST /:profileId/clone
// ---------------------------------------------------------------------

test("POST /:profileId/clone returns 201 with the cloned draft", async () => {
  const cloned = syntheticVersion({ id: "new-draft", versionNumber: 2 });
  const cloneVersionIntoDraftFn = mock.fn(async () => cloned);
  const app = buildTestApp({ cloneVersionIntoDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 201);
    assert.deepEqual(body, JSON.parse(JSON.stringify(cloned)));
    assert.equal(cloneVersionIntoDraftFn.mock.calls.length, 1);
  });
});

test("POST /:profileId/clone rejects a non-UUID versionId with 400", async () => {
  const cloneVersionIntoDraftFn = mock.fn(async () => syntheticVersion());
  const app = buildTestApp({ cloneVersionIntoDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: "not-a-uuid" }),
    });
    assert.equal(res.status, 400);
    assert.equal(cloneVersionIntoDraftFn.mock.calls.length, 0);
  });
});

test("POST /:profileId/clone maps VersionNotFoundError to 404", async () => {
  const cloneVersionIntoDraftFn = mock.fn(async () => {
    throw new VersionNotFoundError(VALID_VERSION_ID);
  });
  const app = buildTestApp({ cloneVersionIntoDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 404);
    assert.equal(body.code, "version_not_found");
  });
});

test("POST /:profileId/clone maps DraftAlreadyExistsError to 409", async () => {
  const cloneVersionIntoDraftFn = mock.fn(async () => {
    throw new DraftAlreadyExistsError(VALID_PROFILE_ID);
  });
  const app = buildTestApp({ cloneVersionIntoDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 409);
    assert.equal(body.code, "draft_already_exists");
  });
});

test("POST /:profileId/clone maps VersionBelongsToAnotherProfileError to 409", async () => {
  const cloneVersionIntoDraftFn = mock.fn(async () => {
    throw new VersionBelongsToAnotherProfileError(
      VALID_VERSION_ID,
      VALID_PROFILE_ID,
    );
  });
  const app = buildTestApp({ cloneVersionIntoDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 409);
    assert.equal(body.code, "version_belongs_to_another_profile");
  });
});

// ---------------------------------------------------------------------
// POST /:profileId/publish
// ---------------------------------------------------------------------

test("POST /:profileId/publish returns 200 with the published version", async () => {
  const published = syntheticVersion({
    status: "published",
    publishedAt: new Date(),
  });
  const publishDraftFn = mock.fn(async () => published);
  const app = buildTestApp({ publishDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await readJson(res);
    assert.equal(res.status, 200);
    assert.deepEqual(body, JSON.parse(JSON.stringify(published)));
  });
});

test("POST /:profileId/publish accepts a request with no body at all", async () => {
  const published = syntheticVersion({
    status: "published",
    publishedAt: new Date(),
  });
  const publishDraftFn = mock.fn(async () => published);
  const app = buildTestApp({ publishDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/publish`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
  });
});

test("POST /:profileId/publish rejects an unexpected body field with 400", async () => {
  const publishDraftFn = mock.fn(async () => syntheticVersion());
  const app = buildTestApp({ publishDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    assert.equal(res.status, 400);
    assert.equal(publishDraftFn.mock.calls.length, 0);
  });
});

test("POST /:profileId/publish maps NoDraftVersionError to 409", async () => {
  const publishDraftFn = mock.fn(async () => {
    throw new NoDraftVersionError(VALID_PROFILE_ID);
  });
  const app = buildTestApp({ publishDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await readJson(res);
    assert.equal(res.status, 409);
    assert.equal(body.code, "no_draft_version");
  });
});

test("POST /:profileId/publish maps NotReadyForPublishError to 422 with structured reasons", async () => {
  const publishDraftFn = mock.fn(async () => {
    throw new NotReadyForPublishError([
      {
        code: "meaningful_target_required",
        message: "Add at least one target company criterion worth more than zero points.",
      },
    ]);
  });
  const app = buildTestApp({ publishDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await readJson(res);
    assert.equal(res.status, 422);
    assert.equal(body.code, "not_ready_for_publish");
    const reasons = body.reasons as { code: string; message: string }[];
    assert.equal(reasons.length, 1);
    assert.equal(reasons[0]!.code, "meaningful_target_required");
  });
});

test("POST /:profileId/publish maps ProfileNotFoundError to 404", async () => {
  const publishDraftFn = mock.fn(async () => {
    throw new ProfileNotFoundError(VALID_PROFILE_ID);
  });
  const app = buildTestApp({ publishDraftFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await readJson(res);
    assert.equal(res.status, 404);
    assert.equal(body.code, "profile_not_found");
  });
});

// ---------------------------------------------------------------------
// POST /:profileId/activate
// ---------------------------------------------------------------------

test("POST /:profileId/activate returns 200 with the pointer update and new event", async () => {
  const result: ActivateVersionResult = {
    profile: syntheticProfile({ activeVersionId: VALID_VERSION_ID }),
    event: {
      id: "event-1",
      profileId: VALID_PROFILE_ID,
      eventType: "activated",
      versionId: VALID_VERSION_ID,
      previousActiveVersionId: null,
      performedBy: "jane@example.test",
      performedAt: new Date(),
      reason: null,
    },
    alreadyActive: false,
  };
  const activateVersionFn = mock.fn(async () => result);
  const app = buildTestApp({ activateVersionFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 200);
    assert.deepEqual(body, JSON.parse(JSON.stringify(result)));
  });
});

test("POST /:profileId/activate returns 200 with alreadyActive=true and a null event for a no-op re-activation", async () => {
  const result: ActivateVersionResult = {
    profile: syntheticProfile({ activeVersionId: VALID_VERSION_ID }),
    event: null,
    alreadyActive: true,
  };
  const activateVersionFn = mock.fn(async () => result);
  const app = buildTestApp({ activateVersionFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 200);
    assert.equal(body.alreadyActive, true);
    assert.equal(body.event, null);
  });
});

test("POST /:profileId/activate rejects a missing versionId with 400", async () => {
  const activateVersionFn = mock.fn(async () => {
    throw new Error("should not be called");
  });
  const app = buildTestApp({ activateVersionFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.equal(activateVersionFn.mock.calls.length, 0);
  });
});

test("POST /:profileId/activate maps VersionNotPublishedError to 409", async () => {
  const activateVersionFn = mock.fn(async () => {
    throw new VersionNotPublishedError(VALID_VERSION_ID);
  });
  const app = buildTestApp({ activateVersionFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 409);
    assert.equal(body.code, "version_not_published");
  });
});

test("POST /:profileId/activate maps VersionBelongsToAnotherProfileError to 409", async () => {
  const activateVersionFn = mock.fn(async () => {
    throw new VersionBelongsToAnotherProfileError(
      VALID_VERSION_ID,
      VALID_PROFILE_ID,
    );
  });
  const app = buildTestApp({ activateVersionFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 409);
    assert.equal(body.code, "version_belongs_to_another_profile");
  });
});

test("POST /:profileId/activate maps ProfileNotFoundError to 404", async () => {
  const activateVersionFn = mock.fn(async () => {
    throw new ProfileNotFoundError(VALID_PROFILE_ID);
  });
  const app = buildTestApp({ activateVersionFn });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/${VALID_PROFILE_ID}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: VALID_VERSION_ID }),
    });
    const body = await readJson(res);
    assert.equal(res.status, 404);
    assert.equal(body.code, "profile_not_found");
  });
});
