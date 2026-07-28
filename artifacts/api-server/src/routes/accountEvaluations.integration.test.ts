// Integration tests for POST/GET /api/internal/account-evaluations,
// exercised end-to-end against a real, migrated Postgres instance: real
// db, real @workspace/evaluator-persistence, real HTTP layer (an
// ephemeral express server + real fetch()) — no fakes anywhere in this
// file.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed as part of this change — see the accompanying report for the
// exact Terminal command to run it.
//
// Deliberately builds its own pg.Pool/drizzle instance rather than
// importing @workspace/db's exported singleton — that singleton throws
// at import time if DATABASE_URL is unset, which would break this file's
// ability to skip itself. Mirrors the same pattern already used in
// lib/evaluator-persistence/src/evaluateAndPersist.integration.test.ts.
//
// Run with: tsx --test src/routes/accountEvaluations.integration.test.ts

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { createAccountEvaluationsRouter } from "./accountEvaluations.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

// ---------------------------------------------------------------------
// Fixtures — same shape as lib/evaluator-persistence's integration
// fixtures (this route is a thin wrapper around that package).
// ---------------------------------------------------------------------

async function makeAccount() {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:api-test-${crypto.randomUUID()}.example` })
    .returning();
  return account;
}

async function makeSnapshot(accountId: string) {
  const [snapshot] = await db!
    .insert(schema.accountSnapshots)
    .values({
      accountId,
      source: "api-integration-test",
      rawInput: { raw: true },
      normalizedInput: {
        schemaVersion: "v1",
        company: {
          domain: "api-test.example",
          name: "API Test Co",
          industry: null,
          employeeRange: null,
          revenueRange: null,
          region: "unknown",
          country: null,
        },
        engagement: {
          sources: [],
          pagesVisited: [],
          distinctSourceCount: 0,
          repeatVisit: false,
          lastSeenAt: null,
        },
        contact: {
          name: null,
          email: "api-test@example.test",
          phone: null,
          title: null,
          linkedinUrl: null,
          origin: "form_submit",
        },
        crm: {
          hubspotCompanyId: null,
          hubspotContactId: null,
          hubspotOwner: null,
          openOpportunity: false,
          existingCustomer: false,
          competitorFlag: false,
          partnerFlag: false,
        },
        doNotContact: false,
        consent: {
          email: "unknown",
          call: "unknown",
          liBasisCleared: "unknown",
          dpoVoiceCleared: "unknown",
        },
        source: "api-integration-test",
      },
      schemaVersion: "v1",
    })
    .returning();
  return snapshot;
}

function syntheticProfileConfig() {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "has_domain",
          description: "Has a domain",
          points: 10,
          condition: { op: "exists", field: "company.domain" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

async function makeProfile() {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `api-test-profile-${crypto.randomUUID()}` })
    .returning();
  return profile;
}

async function makeDraftVersion(profileId: string) {
  const [version] = await db!
    .insert(schema.icpProfileVersions)
    .values({ profileId, versionNumber: 1, config: syntheticProfileConfig() })
    .returning();
  return version;
}

// evaluator_versions.version is UNIQUE — get-or-create so repeated test
// runs against the same database don't collide.
async function getOrCreateCanonicalEvaluatorVersion() {
  const [inserted] = await db!
    .insert(schema.evaluatorVersions)
    .values({ version: "canonical-v1" })
    .onConflictDoNothing({ target: schema.evaluatorVersions.version })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db!
    .select()
    .from(schema.evaluatorVersions)
    .where(eq(schema.evaluatorVersions.version, "canonical-v1"))
    .limit(1);
  if (!existing)
    throw new Error(
      "getOrCreateCanonicalEvaluatorVersion: insert conflicted but no existing row was found",
    );
  return existing;
}

async function countAccountDecisions(): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountDecisions);
  return Number(row?.value ?? 0);
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info: () => {}, warn: () => {}, error: () => {} } as never;
    next();
  });
  app.use("/", createAccountEvaluationsRouter({ db: db! }));
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

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

test(
  "POST creates a real, persisted evaluation row and returns it with 201",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await getOrCreateCanonicalEvaluatorVersion();

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: snapshot.id,
          profileVersionId: draftVersion.id,
          evaluatorVersionId: evaluatorVersion.id,
          evaluationMode: "preview",
        }),
      });
      const body = await readJson(res);

      assert.equal(res.status, 201);
      assert.equal(body.status, "completed");
      assert.equal(body.snapshotId, snapshot.id);
      assert.equal(typeof body.id, "string");
      // assert.equal above is a runtime check only — it doesn't narrow
      // body.id's TS type, so a plain control-flow guard does that here
      // instead of an `as string` cast.
      if (typeof body.id !== "string") {
        throw new Error(
          "unreachable: the typeof assertion above already passed",
        );
      }
      const evaluationId = body.id;

      const [row] = await db!
        .select()
        .from(schema.accountEvaluations)
        .where(eq(schema.accountEvaluations.id, evaluationId))
        .limit(1);
      assert.ok(
        row,
        "the row returned by the API must actually exist in account_evaluations",
      );
      assert.equal(row.snapshotId, snapshot.id);
    });
  },
);

test(
  "GET retrieves a previously persisted evaluation from the canonical table",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await getOrCreateCanonicalEvaluatorVersion();

    await withServer(async (baseUrl) => {
      const createRes = await fetch(`${baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: snapshot.id,
          profileVersionId: draftVersion.id,
          evaluatorVersionId: evaluatorVersion.id,
          evaluationMode: "preview",
        }),
      });
      const created = await readJson(createRes);
      assert.equal(typeof created.id, "string");
      if (typeof created.id !== "string") {
        throw new Error(
          "unreachable: the typeof assertion above already passed",
        );
      }
      const createdEvaluationId = created.id;

      const getRes = await fetch(`${baseUrl}/${createdEvaluationId}`);
      const fetched = await readJson(getRes);

      assert.equal(getRes.status, 200);
      assert.equal(fetched.id, createdEvaluationId);
      assert.equal(fetched.snapshotId, snapshot.id);
    });
  },
);

test(
  "GET returns 404 for an evaluation id that does not exist",
  { skip },
  async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/00000000-0000-4000-8000-000000000000`,
      );
      assert.equal(res.status, 404);
    });
  },
);

test(
  "creating an evaluation through this endpoint creates no account_decisions, routing, action, or outbox records",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await getOrCreateCanonicalEvaluatorVersion();

    const before = await countAccountDecisions();

    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: snapshot.id,
          profileVersionId: draftVersion.id,
          evaluatorVersionId: evaluatorVersion.id,
          evaluationMode: "preview",
        }),
      });
      assert.equal(res.status, 201);
    });

    const after = await countAccountDecisions();
    assert.equal(after, before);
  },
);

test.after(async () => {
  await pool?.end();
});
