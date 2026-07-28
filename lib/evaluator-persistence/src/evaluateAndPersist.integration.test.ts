// Integration tests for evaluateAndPersist(): the transactional
// load-validate-evaluate-persist adapter, exercised against a real,
// migrated Postgres instance.
//
// This file requires DATABASE_URL to point at a Postgres instance with
// migrations already applied (`pnpm --filter @workspace/db run migrate`).
// It SKIPS itself (does not fail) when DATABASE_URL is unset, matching
// lib/db's own integration test convention. This file was NOT executed
// as part of this change — see the accompanying report for what still
// needs to run in a real Terminal against Postgres.
//
// Run with: tsx --test lib/evaluator-persistence/src/evaluateAndPersist.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { UnsupportedEvaluatorVersionError } from "@workspace/evaluator";
import type { IcpProfileConfigV1 } from "@workspace/evaluator";
import { evaluateAndPersist } from "./evaluateAndPersist.js";
import {
  MissingRecordError,
  ProductionRequiresPublishedProfileError,
} from "./errors.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

function syntheticProfileConfig(): IcpProfileConfigV1 {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "has_domain",
          description: "Has a company domain",
          points: 10,
          condition: {
            op: "eq",
            field: "company.domain",
            value: "adapter-test.example",
          },
        },
      ],
      tiers: [
        { code: "low", minScore: 0 },
        { code: "high", minScore: 10 },
      ],
    },
    intent: {
      rules: [],
      tiers: [{ code: "floor", minScore: 0 }],
    },
    actionability: {
      rules: [
        {
          id: "has_email",
          description: "Has email",
          points: 5,
          condition: { op: "exists", field: "contact.email" },
        },
      ],
    },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

function syntheticNormalizedInput() {
  return {
    schemaVersion: "v1",
    company: {
      domain: "adapter-test.example",
      name: "Adapter Test Co",
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
      email: "adapter@example.test",
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
    source: "adapter-integration-test",
  };
}

async function makeAccount() {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:adapter-test-${crypto.randomUUID()}.example` })
    .returning();
  return account;
}

async function makeSnapshot(
  accountId: string,
  normalizedInput: unknown = syntheticNormalizedInput(),
) {
  const [snapshot] = await db!
    .insert(schema.accountSnapshots)
    .values({
      accountId,
      source: "adapter-test",
      rawInput: { raw: true },
      normalizedInput,
      schemaVersion: "v1",
    })
    .returning();
  return snapshot;
}

async function makeProfile() {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `adapter-test-profile-${crypto.randomUUID()}` })
    .returning();
  return profile;
}

async function makeDraftVersion(
  profileId: string,
  config: unknown = syntheticProfileConfig(),
  versionNumber = 1,
) {
  const [version] = await db!
    .insert(schema.icpProfileVersions)
    .values({ profileId, versionNumber, config })
    .returning();
  return version;
}

async function makePublishedVersion(
  profileId: string,
  config: unknown = syntheticProfileConfig(),
  versionNumber = 1,
) {
  const draft = await makeDraftVersion(profileId, config, versionNumber);
  const [published] = await db!
    .update(schema.icpProfileVersions)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(schema.icpProfileVersions.id, draft.id))
    .returning();
  return published;
}

/**
 * evaluator_versions.version is UNIQUE, and every test in this file that
 * needs a real, registered evaluator wants the SAME "canonical-v1" row
 * (the one @workspace/evaluator's registry actually recognizes) — a
 * plain insert per test would violate uniqueness after the first test
 * runs. Get-or-create via `ON CONFLICT DO NOTHING` (a real Postgres
 * upsert-style clause, already expressible idiomatically through
 * drizzle-orm's query builder) followed by a SELECT when the insert
 * reports no returned row (i.e. the conflict fired).
 */
async function getOrCreateEvaluatorVersion(version: string) {
  const [inserted] = await db!
    .insert(schema.evaluatorVersions)
    .values({ version })
    .onConflictDoNothing({ target: schema.evaluatorVersions.version })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db!
    .select()
    .from(schema.evaluatorVersions)
    .where(eq(schema.evaluatorVersions.version, version))
    .limit(1);
  if (!existing) {
    throw new Error(
      `getOrCreateEvaluatorVersion: insert conflicted on version "${version}" but no existing row was found`,
    );
  }
  return existing;
}

async function makeCanonicalEvaluatorVersion() {
  // Must match @workspace/evaluator's SUPPORTED_EVALUATOR_VERSIONS.
  return getOrCreateEvaluatorVersion("canonical-v1");
}

async function makeUnsupportedEvaluatorVersion() {
  // Randomized — never collides across tests, so a plain insert is fine.
  const [v] = await db!
    .insert(schema.evaluatorVersions)
    .values({ version: `not-a-real-version-${crypto.randomUUID()}` })
    .returning();
  return v;
}

async function evaluationCountFor(snapshotId: string): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountEvaluations)
    .where(eq(schema.accountEvaluations.snapshotId, snapshotId));
  return Number(row?.value ?? 0);
}

// ---------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------

test(
  "successful preview evaluation using a draft profile",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    const row = await evaluateAndPersist({
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: draftVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "preview",
    });

    assert.equal(row.status, "completed");
    assert.equal(row.evaluationMode, "preview");
    assert.equal(row.fitScore, "10");
    assert.equal(row.fitTier, "high");
  },
);

test(
  "successful production evaluation using a published profile",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const publishedVersion = await makePublishedVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    const row = await evaluateAndPersist({
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: publishedVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "production",
      createdBy: "operator-integration-test",
    });

    assert.equal(row.status, "completed");
    assert.equal(row.evaluationMode, "production");
    assert.equal(row.createdBy, "operator-integration-test");
  },
);

test(
  "exactly one evaluation row is inserted for one successful invocation",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    await evaluateAndPersist({
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: draftVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "preview",
    });

    assert.equal(await evaluationCountFor(snapshot.id), 1);
  },
);

test(
  "exact profile_config_snapshot preservation for a completed evaluation",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const config = syntheticProfileConfig();
    const draftVersion = await makeDraftVersion(profile.id, config);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    const row = await evaluateAndPersist({
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: draftVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "preview",
    });

    assert.deepEqual(row.profileConfigSnapshot, config);
  },
);

test(
  "evaluator output maps correctly into every existing account_evaluations column",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    const row = await evaluateAndPersist({
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: draftVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "preview",
    });

    // has_domain (10 pts) matches; has_email (actionability, 5 pts) matches.
    assert.equal(row.fitScore, "10");
    assert.equal(row.fitTier, "high");
    assert.equal(row.intentScore, "0");
    assert.equal(row.intentTier, "floor");
    assert.equal(row.identityResolutionLevel, "contact"); // form_submit + email -> contact/high
    assert.equal(row.identityConfidence, "high");
    assert.equal(row.actionabilityScore, "5");
    assert.equal(row.eligibilityOutcome, "eligible");
    assert.equal(row.accountId, account.id);
    assert.equal(row.snapshotId, snapshot.id);
    assert.equal(row.profileVersionId, draftVersion.id);
    assert.equal(row.evaluatorVersionId, evaluatorVersion.id);
    assert.ok(
      Array.isArray(row.scoreComponents) &&
        (row.scoreComponents as unknown[]).length === 2,
    );
    assert.ok(Array.isArray(row.matchedRules));
    assert.deepEqual(row.hardDisqualifiers, []);
    assert.deepEqual(row.eligibilityRestrictions, []);
  },
);

// ---------------------------------------------------------------------
// "No row inserted" failure paths
// ---------------------------------------------------------------------

test(
  "production evaluation against a draft profile is rejected and inserts no row",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    await assert.rejects(
      evaluateAndPersist({
        db: db!,
        snapshotId: snapshot.id,
        profileVersionId: draftVersion.id,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
      }),
      ProductionRequiresPublishedProfileError,
    );
    assert.equal(await evaluationCountFor(snapshot.id), 0);
  },
);

test(
  "an unsupported evaluator version is rejected and inserts no row",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const unsupportedVersion = await makeUnsupportedEvaluatorVersion();

    await assert.rejects(
      evaluateAndPersist({
        db: db!,
        snapshotId: snapshot.id,
        profileVersionId: draftVersion.id,
        evaluatorVersionId: unsupportedVersion.id,
        evaluationMode: "preview",
      }),
      UnsupportedEvaluatorVersionError,
    );
    assert.equal(await evaluationCountFor(snapshot.id), 0);
  },
);

test(
  "a missing account snapshot is rejected and inserts no row",
  { skip },
  async () => {
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();
    const nonExistentSnapshotId = crypto.randomUUID();

    await assert.rejects(
      evaluateAndPersist({
        db: db!,
        snapshotId: nonExistentSnapshotId,
        profileVersionId: draftVersion.id,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "preview",
      }),
      MissingRecordError,
    );
    assert.equal(await evaluationCountFor(nonExistentSnapshotId), 0);
  },
);

test(
  "a missing ICP profile version is rejected and inserts no row (transaction rolls back after a successful earlier read)",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();
    const nonExistentProfileVersionId = crypto.randomUUID();

    // By the time this throws, the snapshot load already succeeded inside
    // the same transaction — proving the transaction as a whole rolls back
    // (no row from this call exists afterward), not merely that "nothing
    // was attempted".
    await assert.rejects(
      evaluateAndPersist({
        db: db!,
        snapshotId: snapshot.id,
        profileVersionId: nonExistentProfileVersionId,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "preview",
      }),
      MissingRecordError,
    );
    assert.equal(await evaluationCountFor(snapshot.id), 0);
  },
);

test(
  "a missing evaluator version is rejected and inserts no row",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const nonExistentEvaluatorVersionId = crypto.randomUUID();

    await assert.rejects(
      evaluateAndPersist({
        db: db!,
        snapshotId: snapshot.id,
        profileVersionId: draftVersion.id,
        evaluatorVersionId: nonExistentEvaluatorVersionId,
        evaluationMode: "preview",
      }),
      MissingRecordError,
    );
    assert.equal(await evaluationCountFor(snapshot.id), 0);
  },
);

test(
  "a real database-level insertion failure rolls back the transaction and leaves no partial row",
  { skip },
  async () => {
    // Every application-level check the adapter performs (missing-record,
    // production-requires-published, unsupported-evaluator-version,
    // snapshot/config validation) passes here — the point of this test is
    // to reach the actual INSERT statement and have THAT fail for real,
    // proving the transaction rolls back rather than leaving a partial
    // row. Nothing in the adapter's own logic depends on evaluationMode
    // being a real enum value until the database itself enforces
    // evaluation_mode's pgEnum type at insert time — an unweakened,
    // pre-existing constraint, reached here via a deliberately bogus value
    // that simulates a caller bypassing TypeScript (e.g. a value
    // deserialized from untyped JSON), not by disabling or altering any
    // constraint.
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    await assert.rejects(
      evaluateAndPersist({
        db: db!,
        snapshotId: snapshot.id,
        profileVersionId: draftVersion.id,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "not-a-real-mode" as unknown as
          | "preview"
          | "production",
      }),
    );
    assert.equal(await evaluationCountFor(snapshot.id), 0);
  },
);

// ---------------------------------------------------------------------
// Truthful "failed" rows (structurally invalid stored data)
// ---------------------------------------------------------------------

test(
  "a malformed stored snapshot produces a truthful failed evaluation row, not a thrown error",
  { skip },
  async () => {
    const account = await makeAccount();
    // Valid JSON object per account_snapshots' own CHECK (jsonb_typeof =
    // 'object'), but missing schemaVersion and every other required
    // NormalizedAccountInputV1 field — the DB has no way to prevent this,
    // since normalized_input's internal shape is an @workspace/evaluator
    // concern, not a database CHECK.
    const snapshot = await makeSnapshot(account.id, { malformed: true });
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    const row = await evaluateAndPersist({
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: draftVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "preview",
    });

    assert.equal(row.status, "failed");
    assert.ok(row.errorDetail && row.errorDetail.length > 0);
    assert.match(row.errorDetail!, /NormalizedAccountInputV1/);
    assert.equal(row.fitScore, null);
    assert.equal(await evaluationCountFor(snapshot.id), 1);
  },
);

test(
  "a malformed stored profile config produces a truthful failed evaluation row and preserves the exact original object",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    // Valid JSON object per icp_profile_versions' own CHECK, but missing
    // configSchemaVersion and every required IcpProfileConfigV1 section.
    const malformedConfig = {
      malformed: true,
      note: "not a real profile config",
    };
    const draftVersion = await makeDraftVersion(profile.id, malformedConfig);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    const row = await evaluateAndPersist({
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: draftVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "preview",
    });

    assert.equal(row.status, "failed");
    assert.match(row.errorDetail!, /IcpProfileConfigV1/);
    // Preserved verbatim — never {} and never a substitute from any other
    // profile's active config.
    assert.deepEqual(row.profileConfigSnapshot, malformedConfig);
  },
);

// ---------------------------------------------------------------------
// Idempotency — documenting the current (absent) contract, per the task
// instruction to report rather than silently invent a policy.
// ---------------------------------------------------------------------

test(
  "KNOWN GAP: calling evaluateAndPersist twice with identical arguments inserts two distinct completed rows (no idempotency contract exists today)",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeCanonicalEvaluatorVersion();

    const args = {
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: draftVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "preview" as const,
    };

    const first = await evaluateAndPersist(args);
    const second = await evaluateAndPersist(args);

    assert.notEqual(first.id, second.id);
    assert.equal(await evaluationCountFor(snapshot.id), 2);
  },
);

test.after(async () => {
  await pool?.end();
});
