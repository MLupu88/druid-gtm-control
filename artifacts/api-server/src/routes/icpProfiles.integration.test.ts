// Integration tests for /api/internal/icp-profiles, exercised end-to-end
// against a real, migrated Postgres instance: real db, real service layer
// (../services/icpProfiles.ts), real HTTP layer (an ephemeral express
// server + real fetch()), and the real integrity triggers/constraints
// from lib/db/drizzle/0001_integrity_triggers.sql — no fakes anywhere in
// this file.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed as part of this change — see the accompanying report for the
// exact Terminal command to run it.
//
// Mirrors the same "build our own pool/drizzle instance rather than
// import @workspace/db's singleton" pattern already used in
// ./accountEvaluations.integration.test.ts.
//
// Response bodies are parsed as `unknown` and narrowed with runtime
// assertion helpers (assertIsRecord/assertIsArray/assertIsString) rather
// than cast — this file exercises a real HTTP boundary, so a malformed
// response shape should fail the assertion, not be silently coerced.
//
// Run with: tsx --test src/routes/icpProfiles.integration.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { createIcpProfilesRouter } from "./icpProfiles.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

// ---------------------------------------------------------------------
// Runtime response-shape assertions (no `as` casts). Each helper has a TS
// `asserts` signature, so calling it narrows the checked value's type for
// the rest of the enclosing scope — a compiler-recognized guard, not a
// blind cast, and it actually throws if the real HTTP response doesn't
// match.
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

function assertIsArray(
  value: unknown,
  context: string,
): asserts value is unknown[] {
  assert.ok(Array.isArray(value), `${context} must be a JSON array`);
}

function assertIsString(
  value: unknown,
  context: string,
): asserts value is string {
  assert.ok(typeof value === "string", `${context} must be a string`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Drizzle wraps the underlying pg driver error (which itself carries the
// raised Postgres trigger's message, e.g. "... is immutable") in its own
// "Failed query..." Error, linked via the standard Error.cause chain —
// the trigger's own message is not necessarily on the outermost Error.
// Walks that chain (Error.cause is `unknown` per lib.es2022.error, so no
// cast is needed to read it) until it finds a message containing `needle`.
function errorChainMessageIncludes(err: unknown, needle: string): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    if (current.message.includes(needle)) return true;
    current = current.cause;
  }
  return false;
}

async function readRecord(
  res: Response,
  context: string,
): Promise<Record<string, unknown>> {
  const json: unknown = await res.json();
  assertIsRecord(json, context);
  return json;
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

// Uses an explicit `eq` match on company.domain (not a bare `exists`
// check) so this fixture carries meaningful target-company criteria —
// see evaluatePublicationReadiness in @workspace/evaluator (invoked from
// ../services/icpProfiles.ts). A plain "domain exists" rule alone would
// make every /publish call in this file fail with 422
// not_ready_for_publish.
function syntheticProfileConfig(marker = "base") {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "domain_match",
          description: `Domain matches ${marker}.example.com`,
          points: 10,
          condition: { op: "eq", field: "company.domain", value: `${marker}.example.com` },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info: () => {}, warn: () => {}, error: () => {} } as never;
    next();
  });
  app.use("/", createIcpProfilesRouter({ db: db! }));
  return app;
}

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
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

async function countAccountEvaluations(): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountEvaluations);
  return Number(row?.value ?? 0);
}

async function countAccountDecisions(): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountDecisions);
  return Number(row?.value ?? 0);
}

interface CreatedProfile {
  profileId: string;
  draftVersionId: string;
}

async function createProfileViaApi(
  baseUrl: string,
  marker: string,
): Promise<CreatedProfile> {
  const res = await fetch(`${baseUrl}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `icp-profile-integration-test-${marker}-${crypto.randomUUID()}`,
      config: syntheticProfileConfig(marker),
    }),
  });
  assert.equal(res.status, 201);
  const body = await readRecord(res, "POST / response body");

  assertIsRecord(body.profile, "response body.profile");
  assertIsString(body.profile.id, "response body.profile.id");
  const profileId = body.profile.id;

  assertIsRecord(body.draftVersion, "response body.draftVersion");
  assertIsString(body.draftVersion.id, "response body.draftVersion.id");
  const draftVersionId = body.draftVersion.id;

  return { profileId, draftVersionId };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

test(
  "POST / atomically creates the profile and its versionNumber=1 draft",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const { profileId, draftVersionId } = await createProfileViaApi(
        baseUrl,
        "create",
      );

      const [profileRow] = await db!
        .select()
        .from(schema.icpProfiles)
        .where(eq(schema.icpProfiles.id, profileId))
        .limit(1);
      assert.ok(profileRow, "profile row must exist");
      assert.equal(profileRow.activeVersionId, null);

      const [versionRow] = await db!
        .select()
        .from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.id, draftVersionId))
        .limit(1);
      assert.ok(versionRow, "draft version row must exist");
      assert.equal(versionRow.profileId, profileId);
      assert.equal(versionRow.versionNumber, 1);
      assert.equal(versionRow.status, "draft");
    });
  },
);

test(
  "PUT /:profileId/draft replaces the draft's config (full replacement)",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const { profileId, draftVersionId } = await createProfileViaApi(
        baseUrl,
        "update-draft",
      );

      const newConfig = syntheticProfileConfig("updated");
      const res = await fetch(`${baseUrl}/${profileId}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: newConfig, notes: "updated notes" }),
      });
      assert.equal(res.status, 200);

      const [versionRow] = await db!
        .select()
        .from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.id, draftVersionId))
        .limit(1);
      assert.deepEqual(versionRow!.config, newConfig);
      assert.equal(versionRow!.notes, "updated notes");
    });
  },
);

test(
  "published versions cannot be edited: after publish, PUT /:profileId/draft is rejected (409) and the row is untouched",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const { profileId, draftVersionId } = await createProfileViaApi(
        baseUrl,
        "publish-immutable",
      );

      const publishRes = await fetch(`${baseUrl}/${profileId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(publishRes.status, 200);

      const [beforeAttempt] = await db!
        .select()
        .from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.id, draftVersionId))
        .limit(1);

      const editRes = await fetch(`${baseUrl}/${profileId}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: syntheticProfileConfig("rejected") }),
      });
      const editBody = await readRecord(editRes, "PUT draft response body");
      assert.equal(editRes.status, 409);
      assert.equal(editBody.code, "no_draft_version");

      const [afterAttempt] = await db!
        .select()
        .from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.id, draftVersionId))
        .limit(1);
      assert.deepEqual(afterAttempt!.config, beforeAttempt!.config);
      assert.equal(afterAttempt!.status, "published");

      // The database's own immutability trigger is the final authority,
      // independent of the application-layer status filter above. Drizzle
      // wraps the raised trigger error in its own "Failed query..." Error
      // (linked via Error.cause), so the "immutable" message is checked
      // across the whole cause chain rather than assumed to be on the
      // outermost error.
      await assert.rejects(
        db!
          .update(schema.icpProfileVersions)
          .set({ notes: "direct write attempt" })
          .where(eq(schema.icpProfileVersions.id, draftVersionId)),
        (err: unknown) =>
          err instanceof Error && errorChainMessageIncludes(err, "immutable"),
      );
    });
  },
);

test(
  "clone creates an exact new draft and leaves the source version untouched",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const { profileId, draftVersionId: sourceVersionId } =
        await createProfileViaApi(baseUrl, "clone-source");

      const publishRes = await fetch(`${baseUrl}/${profileId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(publishRes.status, 200);

      const [sourceBefore] = await db!
        .select()
        .from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.id, sourceVersionId))
        .limit(1);

      const cloneRes = await fetch(`${baseUrl}/${profileId}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: sourceVersionId }),
      });
      assert.equal(cloneRes.status, 201);
      const cloned = await readRecord(cloneRes, "POST /clone response body");

      assert.equal(cloned.profileId, profileId);
      assert.equal(cloned.versionNumber, 2);
      assert.equal(cloned.status, "draft");
      assert.deepEqual(cloned.config, sourceBefore!.config);

      const [sourceAfter] = await db!
        .select()
        .from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.id, sourceVersionId))
        .limit(1);
      assert.deepEqual(sourceAfter, sourceBefore);
    });
  },
);

test(
  "a second draft (via clone) is rejected with 409 while one already exists",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const { profileId, draftVersionId } = await createProfileViaApi(
        baseUrl,
        "second-draft",
      );

      const res = await fetch(`${baseUrl}/${profileId}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: draftVersionId }),
      });
      const body = await readRecord(res, "POST /clone response body");
      assert.equal(res.status, 409);
      assert.equal(body.code, "draft_already_exists");
    });
  },
);

test(
  "publish makes the draft immutable and does not activate it",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const { profileId } = await createProfileViaApi(
        baseUrl,
        "publish-no-activate",
      );

      const res = await fetch(`${baseUrl}/${profileId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const published = await readRecord(res, "POST /publish response body");
      assert.equal(res.status, 200);
      assert.equal(published.status, "published");
      assert.ok(published.publishedAt);

      const [profileRow] = await db!
        .select()
        .from(schema.icpProfiles)
        .where(eq(schema.icpProfiles.id, profileId))
        .limit(1);
      assert.equal(
        profileRow!.activeVersionId,
        null,
        "publishing must not activate the version",
      );

      // Publishing again (no draft left) is rejected.
      const secondPublishRes = await fetch(`${baseUrl}/${profileId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(secondPublishRes.status, 409);
    });
  },
);

test(
  "activate updates the pointer and creates exactly one activation event",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const { profileId, draftVersionId } = await createProfileViaApi(
        baseUrl,
        "activate",
      );
      const publishRes = await fetch(`${baseUrl}/${profileId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(publishRes.status, 200);

      const activateRes = await fetch(`${baseUrl}/${profileId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: draftVersionId }),
      });
      const activated = await readRecord(
        activateRes,
        "POST /activate response body",
      );
      assert.equal(activateRes.status, 200);
      assert.equal(activated.alreadyActive, false);
      assert.ok(activated.event);

      const [profileRow] = await db!
        .select()
        .from(schema.icpProfiles)
        .where(eq(schema.icpProfiles.id, profileId))
        .limit(1);
      assert.equal(profileRow!.activeVersionId, draftVersionId);

      const events = await db!
        .select()
        .from(schema.icpProfileActivationEvents)
        .where(eq(schema.icpProfileActivationEvents.profileId, profileId));
      assert.equal(events.length, 1);
      assert.equal(events[0]!.eventType, "activated");
      assert.equal(events[0]!.versionId, draftVersionId);
      assert.equal(events[0]!.previousActiveVersionId, null);

      // Re-activating the already-active version is a deterministic
      // no-op: no duplicate event.
      const reactivateRes = await fetch(`${baseUrl}/${profileId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: draftVersionId }),
      });
      const reactivated = await readRecord(
        reactivateRes,
        "second POST /activate response body",
      );
      assert.equal(reactivateRes.status, 200);
      assert.equal(reactivated.alreadyActive, true);
      assert.equal(reactivated.event, null);

      const eventsAfter = await db!
        .select()
        .from(schema.icpProfileActivationEvents)
        .where(eq(schema.icpProfileActivationEvents.profileId, profileId));
      assert.equal(eventsAfter.length, 1, "no duplicate activation event");
    });
  },
);

test("activating a draft version is rejected with 409", { skip }, async () => {
  await withServer(async (baseUrl) => {
    const { profileId, draftVersionId } = await createProfileViaApi(
      baseUrl,
      "activate-draft-rejected",
    );

    const res = await fetch(`${baseUrl}/${profileId}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: draftVersionId }),
    });
    const body = await readRecord(res, "POST /activate response body");
    assert.equal(res.status, 409);
    assert.equal(body.code, "version_not_published");

    const [profileRow] = await db!
      .select()
      .from(schema.icpProfiles)
      .where(eq(schema.icpProfiles.id, profileId))
      .limit(1);
    assert.equal(profileRow!.activeVersionId, null);
  });
});

test(
  "cross-profile version use is rejected for both clone and activate",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const profileA = await createProfileViaApi(baseUrl, "cross-a");
      const profileB = await createProfileViaApi(baseUrl, "cross-b");

      const publishBRes = await fetch(
        `${baseUrl}/${profileB.profileId}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(publishBRes.status, 200);

      // Publish profile A's own draft first, so the failures observed
      // below are specifically the cross-profile check, not
      // draft-already-exists.
      const publishARes = await fetch(
        `${baseUrl}/${profileA.profileId}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(publishARes.status, 200);

      const cloneRes = await fetch(`${baseUrl}/${profileA.profileId}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: profileB.draftVersionId }),
      });
      const cloneBody = await readRecord(cloneRes, "POST /clone response body");
      assert.equal(cloneRes.status, 409);
      assert.equal(cloneBody.code, "version_belongs_to_another_profile");

      const activateRes = await fetch(
        `${baseUrl}/${profileA.profileId}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId: profileB.draftVersionId }),
        },
      );
      const activateBody = await readRecord(
        activateRes,
        "POST /activate response body",
      );
      assert.equal(activateRes.status, 409);
      assert.equal(activateBody.code, "version_belongs_to_another_profile");
    });
  },
);

test("list and retrieve read canonical stored records", { skip }, async () => {
  await withServer(async (baseUrl) => {
    const { profileId, draftVersionId } = await createProfileViaApi(
      baseUrl,
      "list-retrieve",
    );
    const publishRes = await fetch(`${baseUrl}/${profileId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(publishRes.status, 200);
    const activateRes = await fetch(`${baseUrl}/${profileId}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: draftVersionId }),
    });
    assert.equal(activateRes.status, 200);

    const listRes = await fetch(`${baseUrl}/`);
    assert.equal(listRes.status, 200);
    const listJson: unknown = await listRes.json();
    assertIsArray(listJson, "GET / response body");

    const listItem = listJson.find(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && entry.id === profileId,
    );
    assert.ok(listItem, "created profile must appear in the list");

    assertIsRecord(listItem.activeVersion, "listItem.activeVersion");
    assertIsString(listItem.activeVersion.id, "listItem.activeVersion.id");
    assert.equal(listItem.activeVersion.id, draftVersionId);
    // List rows must not carry full config.
    assert.equal("config" in listItem.activeVersion, false);

    assertIsRecord(listItem.latestVersion, "listItem.latestVersion");
    assertIsString(listItem.latestVersion.id, "listItem.latestVersion.id");
    assert.equal(listItem.latestVersion.id, draftVersionId);

    assert.equal(listItem.draftVersion, null);

    const getRes = await fetch(`${baseUrl}/${profileId}`);
    assert.equal(getRes.status, 200);
    const detail = await readRecord(getRes, "GET /:profileId response body");

    assertIsRecord(detail.profile, "detail.profile");
    assertIsString(detail.profile.id, "detail.profile.id");
    assert.equal(detail.profile.id, profileId);

    assertIsArray(detail.versions, "detail.versions");
    assert.equal(detail.versions.length, 1);
    const versionEntry = detail.versions[0];
    assertIsRecord(versionEntry, "detail.versions[0]");
    assertIsString(versionEntry.id, "detail.versions[0].id");
    assert.equal(versionEntry.id, draftVersionId);
    assert.deepEqual(
      versionEntry.config,
      syntheticProfileConfig("list-retrieve"),
    );
  });
});

// NOTE ON SCOPE: as of this schema (lib/db/src/schema/*.ts), the only
// tables that record per-account evaluation/decision activity are
// account_evaluations and account_decisions — both counted below. There
// is no separate routing, action, or outbox TABLE anywhere in the current
// schema: "routing output" (routingOutput / decisionGate enums) is only a
// pair of columns *on* account_decisions, produced by a future Phase 3
// decision/routing policy layer that does not exist yet. If those tables
// are introduced later, this test must be extended to count them too.
test(
  "the full profile lifecycle creates no account_evaluations or account_decisions records (no separate routing/action/outbox tables exist in the current schema)",
  { skip },
  async () => {
    const evaluationsBefore = await countAccountEvaluations();
    const decisionsBefore = await countAccountDecisions();

    await withServer(async (baseUrl) => {
      const { profileId, draftVersionId } = await createProfileViaApi(
        baseUrl,
        "no-side-effects",
      );
      await fetch(`${baseUrl}/${profileId}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: syntheticProfileConfig("edited") }),
      });
      const publishRes = await fetch(`${baseUrl}/${profileId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.equal(publishRes.status, 200);
      const activateRes = await fetch(`${baseUrl}/${profileId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: draftVersionId }),
      });
      assert.equal(activateRes.status, 200);
    });

    assert.equal(await countAccountEvaluations(), evaluationsBefore);
    assert.equal(await countAccountDecisions(), decisionsBefore);
  },
);

test.after(async () => {
  await pool?.end();
});
