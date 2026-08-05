// Integration tests for database-level integrity: partial unique
// indexes, CHECK constraints, and — most importantly — the triggers that
// cannot be expressed or verified any other way (drizzle-orm has no
// trigger DSL, so these only exist as hand-authored SQL in
// drizzle/0001_integrity_triggers.sql and can only be proven correct
// against a real PostgreSQL instance).
//
// This file requires DATABASE_URL to point at a Postgres instance with
// migrations already applied (`pnpm run migrate`). It is written to
// SKIP (not fail) when DATABASE_URL is absent, which is the expected
// state of this repository's local dev environment today — see
// lib/db/README.md. CI (.github/workflows/pr-checks.yml) provisions a
// Postgres service container and sets DATABASE_URL for this job
// specifically so these tests are never skipped there.
//
// Every rejection test below asserts *which* rule fired, via
// assertDbRejects — a bare assert.rejects would pass for any error at
// all (a typo in a column name, a dropped connection, the wrong
// constraint firing), which defeats the point of testing integrity
// rules individually. assertDbRejects requires callers to supply at
// least one concrete, checkable expectation (constraint name, error
// code, and/or a message substring), and EVERY expectation field a
// caller supplies must match — if a test asserts both `code` and
// `messageIncludes`, both have to be true, not just one.
//
// Run with: tsx --test lib/db/src/schema/integrity.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

type DbErrorExpectation = {
  /** Exact Postgres constraint name (CHECK/UNIQUE violations always have one). */
  constraint?: string;
  /** Postgres SQLSTATE, e.g. 'P0001' for a trigger-raised RAISE EXCEPTION. */
  code?: string;
  /** Substring the error message must contain. */
  messageIncludes?: string;
};

/**
 * Drizzle wraps the underlying `pg` driver error in `cause` (sometimes
 * more than one level deep). Postgres-specific fields like `constraint`
 * and `code` live on that inner error, not on the outer Drizzle
 * QueryError — so assertions must unwrap before reading them.
 *
 * Walks the `cause` chain defensively: handles non-object/unknown values
 * at every step, and tracks visited objects in a Set to guarantee
 * termination even if something were to form a cyclical `cause` chain.
 * Falls back to returning the original error unchanged when there is no
 * `cause` at all (or it isn't a followable object).
 */
function unwrapDatabaseError(err: unknown): any {
  const visited = new Set<unknown>();
  let current = err;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const cause = (current as { cause?: unknown }).cause;
    if (!cause || typeof cause !== "object" || visited.has(cause)) {
      break;
    }
    current = cause;
  }
  return current;
}

async function assertDbRejects(
  promise: Promise<unknown>,
  expectation: DbErrorExpectation,
) {
  if (
    !expectation.constraint &&
    !expectation.code &&
    !expectation.messageIncludes
  ) {
    throw new Error(
      "assertDbRejects requires at least one of constraint, code, or messageIncludes — a bare rejection check is not a test of a specific rule",
    );
  }
  let caught: any;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  if (!caught) {
    assert.fail(
      "expected the database to reject this operation, but it succeeded",
    );
  }
  // Drizzle's outer error rarely carries `constraint`/`code` itself —
  // those live on the wrapped `pg` driver error, reachable via `cause`.
  const dbError = unwrapDatabaseError(caught);
  const diagnostic = () =>
    `outer message=${caught?.message} | unwrapped: code=${dbError?.code} constraint=${dbError?.constraint} message=${dbError?.message}`;
  // Every expectation field the caller supplied must match — not "at
  // least one of them". If both `code` and `messageIncludes` are given,
  // both have to be true.
  if (expectation.constraint !== undefined) {
    assert.equal(
      dbError?.constraint,
      expectation.constraint,
      `expected constraint "${expectation.constraint}", got ${diagnostic()}`,
    );
  }
  if (expectation.code !== undefined) {
    assert.equal(
      dbError?.code,
      expectation.code,
      `expected code "${expectation.code}", got ${diagnostic()}`,
    );
  }
  if (expectation.messageIncludes !== undefined) {
    assert.ok(
      String(dbError?.message ?? "").includes(expectation.messageIncludes),
      `expected message to include "${expectation.messageIncludes}", got ${diagnostic()}`,
    );
  }
}

// ---------------------------------------------------------------------
// Fixture helpers — each test builds only the rows it needs. Table
// names/keys are randomized so repeated CI runs against a fresh,
// migrated database never collide.
// ---------------------------------------------------------------------

async function makeProfile() {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `test-profile-${crypto.randomUUID()}` })
    .returning();
  return profile;
}

async function makeDraftVersion(profileId: string, versionNumber = 1) {
  const [version] = await db!
    .insert(schema.icpProfileVersions)
    .values({ profileId, versionNumber, config: { weights: {} } })
    .returning();
  return version;
}

async function publishVersion(versionId: string) {
  const [version] = await db!
    .update(schema.icpProfileVersions)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(schema.icpProfileVersions.id, versionId))
    .returning();
  return version;
}

async function makePublishedVersion(profileId: string, versionNumber = 1) {
  const draft = await makeDraftVersion(profileId, versionNumber);
  return publishVersion(draft.id);
}

async function makeEvaluatorVersion() {
  const [v] = await db!
    .insert(schema.evaluatorVersions)
    .values({ version: `evaluator-${crypto.randomUUID()}` })
    .returning();
  return v;
}

async function makeDecisionPolicyVersion() {
  const [v] = await db!
    .insert(schema.decisionPolicyVersions)
    .values({ version: `policy-${crypto.randomUUID()}` })
    .returning();
  return v;
}

async function makeAccount() {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:test-${crypto.randomUUID()}.example` })
    .returning();
  return account;
}

async function makeSnapshot(accountId: string) {
  const [snapshot] = await db!
    .insert(schema.accountSnapshots)
    .values({
      accountId,
      source: "test",
      rawInput: { raw: true },
      normalizedInput: { normalized: true },
      schemaVersion: "v1",
    })
    .returning();
  return snapshot;
}

async function makeSignal(
  overrides: Partial<typeof schema.signals.$inferInsert> = {},
) {
  const [signal] = await db!
    .insert(schema.signals)
    .values({
      source: "hubspot",
      sourceEventId: `evt-${crypto.randomUUID()}`,
      occurredAt: new Date(),
      signalType: "page_view",
      observedResolutionLevel: "anonymous",
      schemaVersion: "v1",
      rawPayload: { raw: true },
      normalizedPayload: { normalized: true },
      ...overrides,
    })
    .returning();
  return signal;
}

async function makePerson(
  overrides: Partial<typeof schema.people.$inferInsert> = {},
) {
  const [person] = await db!
    .insert(schema.people)
    .values({
      workEmail: `person-${crypto.randomUUID()}@example.com`,
      ...overrides,
    })
    .returning();
  return person;
}

// profile_config_snapshot has no DB default (NOT NULL, required on every
// row regardless of status/mode) — a fixed fixture value for tests that
// aren't specifically exercising that column.
const PROFILE_CONFIG_SNAPSHOT_FIXTURE = {
  configSchemaVersion: "v1",
  fit: { rules: [] },
};

async function makeCompletedProductionEvaluation(overrides: {
  accountId: string;
  snapshotId: string;
  profileVersionId: string;
  evaluatorVersionId: string;
  profileConfigSnapshot?: Record<string, unknown>;
}) {
  const [evaluation] = await db!
    .insert(schema.accountEvaluations)
    .values({
      profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
      ...overrides,
      evaluationMode: "production",
      status: "completed",
      fitScore: "10",
      fitTier: "outbound_now",
      intentScore: "5",
      intentTier: "engaged",
      identityResolutionLevel: "contact",
      identityConfidence: "high",
      actionabilityScore: "3",
      eligibilityOutcome: "eligible",
    })
    .returning();
  return evaluation;
}

/** account_id + snapshot_id + published profile_version_id + evaluator_version_id, ready to insert an evaluation from. */
async function makeEvaluationPrereqs() {
  const account = await makeAccount();
  const snapshot = await makeSnapshot(account.id);
  const profile = await makeProfile();
  const publishedVersion = await makePublishedVersion(profile.id);
  const evaluatorVersion = await makeEvaluatorVersion();
  return { account, snapshot, profile, publishedVersion, evaluatorVersion };
}

// =======================================================================
// icp_profile_versions
// =======================================================================

test(
  "at most one draft version per profile (partial unique index)",
  { skip },
  async () => {
    const profile = await makeProfile();
    await makeDraftVersion(profile.id, 1);
    await assertDbRejects(makeDraftVersion(profile.id, 2), {
      constraint: "icp_profile_versions_one_draft_per_profile",
    });
  },
);

test("version_number must be positive", { skip }, async () => {
  const profile = await makeProfile();
  await assertDbRejects(
    db!
      .insert(schema.icpProfileVersions)
      .values({ profileId: profile.id, versionNumber: 0, config: {} }),
    { constraint: "icp_profile_versions_version_number_positive" },
  );
});

test("config must be a JSON object", { skip }, async () => {
  const profile = await makeProfile();
  await assertDbRejects(
    db!.insert(schema.icpProfileVersions).values({
      profileId: profile.id,
      versionNumber: 1,
      config: ["not", "an", "object"] as any,
    }),
    { constraint: "icp_profile_versions_config_is_object" },
  );
});

test(
  "published_at must match status (draft=null, published=set)",
  { skip },
  async () => {
    const profile = await makeProfile();
    const version = await makeDraftVersion(profile.id);
    await assertDbRejects(
      db!
        .update(schema.icpProfileVersions)
        .set({ status: "published" })
        .where(eq(schema.icpProfileVersions.id, version.id)),
      { constraint: "icp_profile_versions_published_at_matches_status" },
    );
  },
);

test("a published version rejects UPDATE", { skip }, async () => {
  const profile = await makeProfile();
  const version = await makePublishedVersion(profile.id);
  await assertDbRejects(
    db!
      .update(schema.icpProfileVersions)
      .set({ notes: "trying to edit" })
      .where(eq(schema.icpProfileVersions.id, version.id)),
    { code: "P0001", messageIncludes: "is immutable" },
  );
});

test("a published version rejects DELETE", { skip }, async () => {
  const profile = await makeProfile();
  const version = await makePublishedVersion(profile.id);
  await assertDbRejects(
    db!
      .delete(schema.icpProfileVersions)
      .where(eq(schema.icpProfileVersions.id, version.id)),
    {
      code: "P0001",
      messageIncludes: "cannot be deleted",
    },
  );
});

// =======================================================================
// icp_profiles.active_version_id
// =======================================================================

test(
  "active_version_id cannot reference a draft version",
  { skip },
  async () => {
    const profile = await makeProfile();
    const version = await makeDraftVersion(profile.id);
    await assertDbRejects(
      db!
        .update(schema.icpProfiles)
        .set({ activeVersionId: version.id })
        .where(eq(schema.icpProfiles.id, profile.id)),
      { code: "P0001", messageIncludes: "is not published" },
    );
  },
);

test(
  "active_version_id cannot reference another profile's published version",
  { skip },
  async () => {
    const profileA = await makeProfile();
    const versionA = await makePublishedVersion(profileA.id);
    const profileB = await makeProfile();
    await assertDbRejects(
      db!
        .update(schema.icpProfiles)
        .set({ activeVersionId: versionA.id })
        .where(eq(schema.icpProfiles.id, profileB.id)),
      { code: "P0001", messageIncludes: "does not belong to profile" },
    );
  },
);

test(
  "active_version_id accepts a published version of the same profile",
  { skip },
  async () => {
    const profile = await makeProfile();
    const version = await makePublishedVersion(profile.id);
    const [updated] = await db!
      .update(schema.icpProfiles)
      .set({ activeVersionId: version.id })
      .where(eq(schema.icpProfiles.id, profile.id))
      .returning();
    assert.equal(updated.activeVersionId, version.id);
  },
);

// =======================================================================
// icp_profile_activation_events
// =======================================================================

test(
  "an 'activated' event's version must belong to the same profile",
  { skip },
  async () => {
    const profileA = await makeProfile();
    const versionA = await makePublishedVersion(profileA.id);
    const profileB = await makeProfile();
    await assertDbRejects(
      db!.insert(schema.icpProfileActivationEvents).values({
        profileId: profileB.id,
        eventType: "activated",
        versionId: versionA.id,
      }),
      { code: "P0001", messageIncludes: "does not belong to profile" },
    );
  },
);

test("an 'activated' event's version must be published", { skip }, async () => {
  const profile = await makeProfile();
  const draft = await makeDraftVersion(profile.id);
  await assertDbRejects(
    db!.insert(schema.icpProfileActivationEvents).values({
      profileId: profile.id,
      eventType: "activated",
      versionId: draft.id,
    }),
    { code: "P0001", messageIncludes: "is not published" },
  );
});

test(
  "an 'activated' event's previousActiveVersionId is rejected when it belongs to another profile",
  { skip },
  async () => {
    const profile = await makeProfile();
    const version = await makePublishedVersion(profile.id);
    const otherProfile = await makeProfile();
    const otherVersion = await makePublishedVersion(otherProfile.id);
    await assertDbRejects(
      db!.insert(schema.icpProfileActivationEvents).values({
        profileId: profile.id,
        eventType: "activated",
        versionId: version.id,
        previousActiveVersionId: otherVersion.id,
      }),
      { code: "P0001", messageIncludes: "does not belong to profile" },
    );
  },
);

test(
  "an 'activated' event's previousActiveVersionId is rejected when it references a draft version",
  { skip },
  async () => {
    const profile = await makeProfile();
    const version = await makePublishedVersion(profile.id, 2);
    const draft = await makeDraftVersion(profile.id, 1);
    await assertDbRejects(
      db!.insert(schema.icpProfileActivationEvents).values({
        profileId: profile.id,
        eventType: "activated",
        versionId: version.id,
        previousActiveVersionId: draft.id,
      }),
      { code: "P0001", messageIncludes: "is not published" },
    );
  },
);

test(
  "an 'activated' event with previousActiveVersionId equal to versionId is rejected (no-op guard)",
  { skip },
  async () => {
    const profile = await makeProfile();
    const version = await makePublishedVersion(profile.id);
    await assertDbRejects(
      db!.insert(schema.icpProfileActivationEvents).values({
        profileId: profile.id,
        eventType: "activated",
        versionId: version.id,
        previousActiveVersionId: version.id,
      }),
      {
        constraint:
          "icp_profile_activation_events_activation_is_a_real_transition",
      },
    );
  },
);

test(
  "a valid 'activated' event with a different published previous version is accepted",
  { skip },
  async () => {
    const profile = await makeProfile();
    const previous = await makePublishedVersion(profile.id, 1);
    const next = await makePublishedVersion(profile.id, 2);
    const [event] = await db!
      .insert(schema.icpProfileActivationEvents)
      .values({
        profileId: profile.id,
        eventType: "activated",
        versionId: next.id,
        previousActiveVersionId: previous.id,
      })
      .returning();
    assert.equal(event.versionId, next.id);
    assert.equal(event.previousActiveVersionId, previous.id);
  },
);

test(
  "a 'deactivated' event requires previousActiveVersionId and rejects a bare versionId",
  { skip },
  async () => {
    const profile = await makeProfile();
    const version = await makePublishedVersion(profile.id);
    await assertDbRejects(
      db!.insert(schema.icpProfileActivationEvents).values({
        profileId: profile.id,
        eventType: "deactivated",
        versionId: version.id,
      }),
      {
        constraint: "icp_profile_activation_events_required_reference_by_type",
      },
    );
  },
);

test("a valid 'deactivated' event is accepted", { skip }, async () => {
  const profile = await makeProfile();
  const version = await makePublishedVersion(profile.id);
  const [event] = await db!
    .insert(schema.icpProfileActivationEvents)
    .values({
      profileId: profile.id,
      eventType: "deactivated",
      previousActiveVersionId: version.id,
    })
    .returning();
  assert.equal(event.eventType, "deactivated");
  assert.equal(event.versionId, null);
});

test("activation events reject UPDATE and DELETE", { skip }, async () => {
  const profile = await makeProfile();
  const version = await makePublishedVersion(profile.id);
  const [event] = await db!
    .insert(schema.icpProfileActivationEvents)
    .values({
      profileId: profile.id,
      eventType: "activated",
      versionId: version.id,
    })
    .returning();
  await assertDbRejects(
    db!
      .update(schema.icpProfileActivationEvents)
      .set({ reason: "edited" })
      .where(eq(schema.icpProfileActivationEvents.id, event.id)),
    { code: "P0001", messageIncludes: "icp_profile_activation_events" },
  );
  await assertDbRejects(
    db!
      .delete(schema.icpProfileActivationEvents)
      .where(eq(schema.icpProfileActivationEvents.id, event.id)),
    {
      code: "P0001",
      messageIncludes: "icp_profile_activation_events",
    },
  );
});

test("deactivation events reject UPDATE and DELETE", { skip }, async () => {
  const profile = await makeProfile();
  const version = await makePublishedVersion(profile.id);
  const [event] = await db!
    .insert(schema.icpProfileActivationEvents)
    .values({
      profileId: profile.id,
      eventType: "deactivated",
      previousActiveVersionId: version.id,
    })
    .returning();
  await assertDbRejects(
    db!
      .update(schema.icpProfileActivationEvents)
      .set({ reason: "edited" })
      .where(eq(schema.icpProfileActivationEvents.id, event.id)),
    { code: "P0001", messageIncludes: "icp_profile_activation_events" },
  );
  await assertDbRejects(
    db!
      .delete(schema.icpProfileActivationEvents)
      .where(eq(schema.icpProfileActivationEvents.id, event.id)),
    {
      code: "P0001",
      messageIncludes: "icp_profile_activation_events",
    },
  );
});

// =======================================================================
// evaluator_versions / decision_policy_versions — CHECK + append-only
// =======================================================================

test("evaluator_versions rejects a blank version", { skip }, async () => {
  await assertDbRejects(
    db!.insert(schema.evaluatorVersions).values({ version: "   " }),
    {
      constraint: "evaluator_versions_version_not_blank",
    },
  );
});

test("evaluator_versions rejects UPDATE and DELETE", { skip }, async () => {
  const version = await makeEvaluatorVersion();
  await assertDbRejects(
    db!
      .update(schema.evaluatorVersions)
      .set({ description: "x" })
      .where(eq(schema.evaluatorVersions.id, version.id)),
    { code: "P0001", messageIncludes: "evaluator_versions" },
  );
  await assertDbRejects(
    db!
      .delete(schema.evaluatorVersions)
      .where(eq(schema.evaluatorVersions.id, version.id)),
    {
      code: "P0001",
      messageIncludes: "evaluator_versions",
    },
  );
});

test("decision_policy_versions rejects a blank version", { skip }, async () => {
  await assertDbRejects(
    db!.insert(schema.decisionPolicyVersions).values({ version: "" }),
    {
      constraint: "decision_policy_versions_version_not_blank",
    },
  );
});

test(
  "decision_policy_versions rejects UPDATE and DELETE",
  { skip },
  async () => {
    const version = await makeDecisionPolicyVersion();
    await assertDbRejects(
      db!
        .update(schema.decisionPolicyVersions)
        .set({ description: "x" })
        .where(eq(schema.decisionPolicyVersions.id, version.id)),
      { code: "P0001", messageIncludes: "decision_policy_versions" },
    );
    await assertDbRejects(
      db!
        .delete(schema.decisionPolicyVersions)
        .where(eq(schema.decisionPolicyVersions.id, version.id)),
      {
        code: "P0001",
        messageIncludes: "decision_policy_versions",
      },
    );
  },
);

// =======================================================================
// accounts
// =======================================================================

test("accounts rejects a blank account_key", { skip }, async () => {
  await assertDbRejects(
    db!.insert(schema.accounts).values({ accountKey: "   " }),
    {
      constraint: "accounts_account_key_not_blank",
    },
  );
});

// =======================================================================
// account_snapshots
// =======================================================================

test("account_snapshots rejects a blank source", { skip }, async () => {
  const account = await makeAccount();
  await assertDbRejects(
    db!.insert(schema.accountSnapshots).values({
      accountId: account.id,
      source: "  ",
      rawInput: {},
      normalizedInput: {},
      schemaVersion: "v1",
    }),
    { constraint: "account_snapshots_source_not_blank" },
  );
});

test("account_snapshots rejects a blank schema_version", { skip }, async () => {
  const account = await makeAccount();
  await assertDbRejects(
    db!.insert(schema.accountSnapshots).values({
      accountId: account.id,
      source: "test",
      rawInput: {},
      normalizedInput: {},
      schemaVersion: "",
    }),
    { constraint: "account_snapshots_schema_version_not_blank" },
  );
});

test("account_snapshots rejects UPDATE and DELETE", { skip }, async () => {
  const account = await makeAccount();
  const snapshot = await makeSnapshot(account.id);
  await assertDbRejects(
    db!
      .update(schema.accountSnapshots)
      .set({ source: "changed" })
      .where(eq(schema.accountSnapshots.id, snapshot.id)),
    { code: "P0001", messageIncludes: "account_snapshots" },
  );
  await assertDbRejects(
    db!
      .delete(schema.accountSnapshots)
      .where(eq(schema.accountSnapshots.id, snapshot.id)),
    {
      code: "P0001",
      messageIncludes: "account_snapshots",
    },
  );
});

// =======================================================================
// account_evaluations
// =======================================================================

test(
  "account_evaluations rejects a snapshot from a different account",
  { skip },
  async () => {
    const accountA = await makeAccount();
    const accountB = await makeAccount();
    const snapshotOfB = await makeSnapshot(accountB.id);
    const { publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();

    await assertDbRejects(
      db!.insert(schema.accountEvaluations).values({
        accountId: accountA.id,
        snapshotId: snapshotOfB.id,
        profileVersionId: publishedVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
        status: "failed",
        errorDetail: "should never insert",
      }),
      { code: "P0001", messageIncludes: "does not match snapshot" },
    );
  },
);

test(
  "a production evaluation must reference a published profile version",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeEvaluatorVersion();

    await assertDbRejects(
      db!.insert(schema.accountEvaluations).values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: draftVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
        status: "failed",
        errorDetail: "should never insert",
      }),
      {
        code: "P0001",
        messageIncludes: "production evaluation must reference a published",
      },
    );
  },
);

test(
  "a preview evaluation may reference a draft profile version",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeEvaluatorVersion();

    const [evaluation] = await db!
      .insert(schema.accountEvaluations)
      .values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: draftVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "preview",
        status: "failed",
        errorDetail: "preview evaluations may still fail",
      })
      .returning();
    assert.equal(evaluation.evaluationMode, "preview");
  },
);

test(
  "a 'completed' evaluation requires all core outputs",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    await assertDbRejects(
      db!.insert(schema.accountEvaluations).values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: publishedVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
        status: "completed",
        // fitScore, fitTier, etc. intentionally omitted
      }),
      { constraint: "account_evaluations_completed_requires_core_outputs" },
    );
  },
);

test(
  "a 'completed' evaluation must not carry an error_detail",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    await assertDbRejects(
      db!.insert(schema.accountEvaluations).values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: publishedVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
        status: "completed",
        errorDetail: "should not be allowed alongside completed",
        fitScore: "10",
        fitTier: "outbound_now",
        intentScore: "5",
        intentTier: "engaged",
        identityResolutionLevel: "contact",
        identityConfidence: "high",
        actionabilityScore: "3",
        eligibilityOutcome: "eligible",
      }),
      { constraint: "account_evaluations_completed_has_no_error_detail" },
    );
  },
);

test(
  "a 'failed' evaluation requires a non-blank error_detail",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    await assertDbRejects(
      db!.insert(schema.accountEvaluations).values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: publishedVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
        status: "failed",
        // errorDetail intentionally omitted
      }),
      { constraint: "account_evaluations_failed_requires_error_detail" },
    );
  },
);

test(
  "account_evaluations jsonb collection fields must be arrays",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    await assertDbRejects(
      db!.insert(schema.accountEvaluations).values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: publishedVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
        status: "failed",
        errorDetail: "testing malformed jsonb",
        eligibilityRestrictions: { not: "an array" } as any,
      }),
      { constraint: "account_evaluations_eligibility_restrictions_is_array" },
    );
  },
);

test(
  "account_evaluations.profile_config_snapshot must be a JSON object",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    await assertDbRejects(
      db!.insert(schema.accountEvaluations).values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: publishedVersion.id,
        profileConfigSnapshot: ["not", "an", "object"] as any,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
        status: "failed",
        errorDetail: "testing malformed profile_config_snapshot",
      }),
      { constraint: "account_evaluations_profile_config_snapshot_is_object" },
    );
  },
);

test(
  "a valid completed production evaluation is accepted and is immutable afterward",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    const evaluation = await makeCompletedProductionEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      profileVersionId: publishedVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
    });
    assert.equal(evaluation.status, "completed");

    await assertDbRejects(
      db!
        .update(schema.accountEvaluations)
        .set({ fitScore: "999" })
        .where(eq(schema.accountEvaluations.id, evaluation.id)),
      { code: "P0001", messageIncludes: "account_evaluations" },
    );
    await assertDbRejects(
      db!
        .delete(schema.accountEvaluations)
        .where(eq(schema.accountEvaluations.id, evaluation.id)),
      {
        code: "P0001",
        messageIncludes: "account_evaluations",
      },
    );
  },
);

// =======================================================================
// account_decisions
// =======================================================================

test(
  "account_decisions rejects a reference to a preview evaluation",
  { skip },
  async () => {
    const account = await makeAccount();
    const snapshot = await makeSnapshot(account.id);
    const profile = await makeProfile();
    const draftVersion = await makeDraftVersion(profile.id);
    const evaluatorVersion = await makeEvaluatorVersion();
    const decisionPolicyVersion = await makeDecisionPolicyVersion();

    const [previewEvaluation] = await db!
      .insert(schema.accountEvaluations)
      .values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: draftVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "preview",
        status: "completed",
        fitScore: "10",
        fitTier: "outbound_now",
        intentScore: "5",
        intentTier: "engaged",
        identityResolutionLevel: "contact",
        identityConfidence: "high",
        actionabilityScore: "3",
        eligibilityOutcome: "eligible",
      })
      .returning();

    await assertDbRejects(
      db!.insert(schema.accountDecisions).values({
        accountEvaluationId: previewEvaluation.id,
        decisionPolicyVersionId: decisionPolicyVersion.id,
        operationalContextSnapshot: {},
        routingOutput: "mql",
        overallDecisionGate: "actionable",
      }),
      { code: "P0001", messageIncludes: "not a production evaluation" },
    );
  },
);

test(
  "account_decisions rejects a reference to a failed evaluation",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    const decisionPolicyVersion = await makeDecisionPolicyVersion();

    const [failedEvaluation] = await db!
      .insert(schema.accountEvaluations)
      .values({
        accountId: account.id,
        snapshotId: snapshot.id,
        profileVersionId: publishedVersion.id,
        profileConfigSnapshot: PROFILE_CONFIG_SNAPSHOT_FIXTURE,
        evaluatorVersionId: evaluatorVersion.id,
        evaluationMode: "production",
        status: "failed",
        errorDetail: "evaluator threw",
      })
      .returning();

    await assertDbRejects(
      db!.insert(schema.accountDecisions).values({
        accountEvaluationId: failedEvaluation.id,
        decisionPolicyVersionId: decisionPolicyVersion.id,
        operationalContextSnapshot: {},
        routingOutput: "mql",
        overallDecisionGate: "actionable",
      }),
      { code: "P0001", messageIncludes: "is not completed" },
    );
  },
);

test(
  "account_decisions requires operationalContextSnapshot to be a JSON object",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    const decisionPolicyVersion = await makeDecisionPolicyVersion();
    const evaluation = await makeCompletedProductionEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      profileVersionId: publishedVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
    });

    await assertDbRejects(
      db!.insert(schema.accountDecisions).values({
        accountEvaluationId: evaluation.id,
        decisionPolicyVersionId: decisionPolicyVersion.id,
        operationalContextSnapshot: ["not", "an", "object"] as any,
        routingOutput: "mql",
        overallDecisionGate: "actionable",
      }),
      { constraint: "account_decisions_operational_context_is_object" },
    );
  },
);

test(
  "account_decisions requires channelAvailability to be a JSON object",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    const decisionPolicyVersion = await makeDecisionPolicyVersion();
    const evaluation = await makeCompletedProductionEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      profileVersionId: publishedVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
    });

    await assertDbRejects(
      db!.insert(schema.accountDecisions).values({
        accountEvaluationId: evaluation.id,
        decisionPolicyVersionId: decisionPolicyVersion.id,
        operationalContextSnapshot: {},
        channelAvailability: ["not", "an", "object"] as any,
        routingOutput: "mql",
        overallDecisionGate: "actionable",
      }),
      { constraint: "account_decisions_channel_availability_is_object" },
    );
  },
);

test(
  "account_decisions requires blockers to be a JSON array",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    const decisionPolicyVersion = await makeDecisionPolicyVersion();
    const evaluation = await makeCompletedProductionEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      profileVersionId: publishedVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
    });

    await assertDbRejects(
      db!.insert(schema.accountDecisions).values({
        accountEvaluationId: evaluation.id,
        decisionPolicyVersionId: decisionPolicyVersion.id,
        operationalContextSnapshot: {},
        blockers: { not: "an array" } as any,
        routingOutput: "mql",
        overallDecisionGate: "actionable",
      }),
      { constraint: "account_decisions_blockers_is_array" },
    );
  },
);

test(
  "a valid decision referencing a completed production evaluation is accepted and is immutable afterward",
  { skip },
  async () => {
    const { account, snapshot, publishedVersion, evaluatorVersion } =
      await makeEvaluationPrereqs();
    const decisionPolicyVersion = await makeDecisionPolicyVersion();
    const evaluation = await makeCompletedProductionEvaluation({
      accountId: account.id,
      snapshotId: snapshot.id,
      profileVersionId: publishedVersion.id,
      evaluatorVersionId: evaluatorVersion.id,
    });

    const [decision] = await db!
      .insert(schema.accountDecisions)
      .values({
        accountEvaluationId: evaluation.id,
        decisionPolicyVersionId: decisionPolicyVersion.id,
        operationalContextSnapshot: { openOpportunity: false },
        routingOutput: "mql",
        overallDecisionGate: "actionable",
      })
      .returning();
    assert.equal(decision.overallDecisionGate, "actionable");

    await assertDbRejects(
      db!
        .update(schema.accountDecisions)
        .set({ routingOutput: "nurture" })
        .where(eq(schema.accountDecisions.id, decision.id)),
      { code: "P0001", messageIncludes: "account_decisions" },
    );
    await assertDbRejects(
      db!
        .delete(schema.accountDecisions)
        .where(eq(schema.accountDecisions.id, decision.id)),
      {
        code: "P0001",
        messageIncludes: "account_decisions",
      },
    );
  },
);

// =======================================================================
// GTM V2 Unit 1 — Operational Identity and Signal Contracts
// =======================================================================

// -----------------------------------------------------------------------
// signals
// -----------------------------------------------------------------------

test(
  "signals rejects a second insert with the same (source, source_event_id)",
  { skip },
  async () => {
    const sourceEventId = `evt-${crypto.randomUUID()}`;
    await makeSignal({ source: "hubspot", sourceEventId });
    await assertDbRejects(makeSignal({ source: "hubspot", sourceEventId }), {
      constraint: "signals_source_source_event_id_uq",
    });
  },
);

test("signals rejects a blank source", { skip }, async () => {
  await assertDbRejects(makeSignal({ source: "" }), {
    constraint: "signals_source_not_blank",
  });
});

test(
  "signals rejects a non-canonical (uppercase/untrimmed) source",
  { skip },
  async () => {
    await assertDbRejects(makeSignal({ source: " HubSpot " }), {
      constraint: "signals_source_is_canonical_form",
    });
  },
);

test(
  "signals.company_domain rejects a value still containing www. or a protocol",
  { skip },
  async () => {
    await assertDbRejects(makeSignal({ companyDomain: "www.example.com" }), {
      constraint: "signals_company_domain_is_normalized_domain_shape",
    });
    await assertDbRejects(
      makeSignal({ companyDomain: "https://example.com" }),
      { constraint: "signals_company_domain_is_normalized_domain_shape" },
    );
  },
);

test(
  "signals accepts an already-normalized company_domain",
  { skip },
  async () => {
    const signal = await makeSignal({ companyDomain: "example.com" });
    assert.equal(signal.companyDomain, "example.com");
  },
);

test(
  "signals rejects non-object raw_payload/normalized_payload",
  { skip },
  async () => {
    await assertDbRejects(
      makeSignal({ rawPayload: ["not", "an", "object"] as any }),
      { constraint: "signals_raw_payload_is_object" },
    );
    await assertDbRejects(
      makeSignal({ normalizedPayload: ["not", "an", "object"] as any }),
      { constraint: "signals_normalized_payload_is_object" },
    );
  },
);

test("signals rejects UPDATE and DELETE", { skip }, async () => {
  const signal = await makeSignal();
  await assertDbRejects(
    db!
      .update(schema.signals)
      .set({ signalType: "changed" })
      .where(eq(schema.signals.id, signal.id)),
    { code: "P0001", messageIncludes: "signals" },
  );
  await assertDbRejects(
    db!.delete(schema.signals).where(eq(schema.signals.id, signal.id)),
    { code: "P0001", messageIncludes: "signals" },
  );
});

// -----------------------------------------------------------------------
// people
// -----------------------------------------------------------------------

test("people rejects an all-null (identityless) row", { skip }, async () => {
  await assertDbRejects(
    db!.insert(schema.people).values({
      fullName: null,
      workEmail: null,
      linkedinUrl: null,
      externalId: null,
      externalIdSource: null,
    }),
    { constraint: "people_has_identity_attribute" },
  );
});

test("people rejects a duplicate work_email", { skip }, async () => {
  const workEmail = `dup-${crypto.randomUUID()}@example.com`;
  await makePerson({ workEmail });
  await assertDbRejects(makePerson({ workEmail }), {
    constraint: "people_work_email_uq",
  });
});

test(
  "people rejects a duplicate (external_id_source, external_id)",
  { skip },
  async () => {
    const externalId = `hs-${crypto.randomUUID()}`;
    await makePerson({
      workEmail: null,
      externalId,
      externalIdSource: "hubspot",
    });
    await assertDbRejects(
      makePerson({ workEmail: null, externalId, externalIdSource: "hubspot" }),
      { constraint: "people_external_id_source_id_uq" },
    );
  },
);

test(
  "people rejects a non-canonical (uppercase/untrimmed) work_email",
  { skip },
  async () => {
    await assertDbRejects(makePerson({ workEmail: " Jordan@Example.com " }), {
      constraint: "people_work_email_is_canonical_form",
    });
  },
);

// -----------------------------------------------------------------------
// account_people
// -----------------------------------------------------------------------

test(
  "account_people rejects a duplicate (account_id, person_id)",
  { skip },
  async () => {
    const account = await makeAccount();
    const person = await makePerson();
    await db!.insert(schema.accountPeople).values({
      accountId: account.id,
      personId: person.id,
      source: "test",
    });
    await assertDbRejects(
      db!.insert(schema.accountPeople).values({
        accountId: account.id,
        personId: person.id,
        source: "test",
      }),
      { constraint: "account_people_account_id_person_id_uq" },
    );
  },
);

test(
  "account_people rejects last_seen_at before first_seen_at",
  { skip },
  async () => {
    const account = await makeAccount();
    const person = await makePerson();
    await assertDbRejects(
      db!.insert(schema.accountPeople).values({
        accountId: account.id,
        personId: person.id,
        source: "test",
        firstSeenAt: new Date("2026-01-10T00:00:00Z"),
        lastSeenAt: new Date("2026-01-01T00:00:00Z"),
      }),
      { constraint: "account_people_last_seen_after_first_seen" },
    );
  },
);

// -----------------------------------------------------------------------
// account_aliases
// -----------------------------------------------------------------------

test(
  "account_aliases rejects a duplicate strong alias across two accounts",
  { skip },
  async () => {
    const accountA = await makeAccount();
    const accountB = await makeAccount();
    const normalizedValue = `strong-${crypto.randomUUID()}.example.com`;
    await db!.insert(schema.accountAliases).values({
      accountId: accountA.id,
      aliasType: "domain",
      rawValue: normalizedValue,
      normalizedValue,
      normalizationStrategy: "domain",
      isStrong: true,
      source: "test",
    });
    await assertDbRejects(
      db!.insert(schema.accountAliases).values({
        accountId: accountB.id,
        aliasType: "domain",
        rawValue: normalizedValue,
        normalizedValue,
        normalizationStrategy: "domain",
        isStrong: true,
        source: "test",
      }),
      { constraint: "account_aliases_strong_type_normalized_value_uq" },
    );
  },
);

test(
  "account_aliases allows a duplicate weak alias across two accounts",
  { skip },
  async () => {
    const accountA = await makeAccount();
    const accountB = await makeAccount();
    const normalizedValue = `acme inc ${crypto.randomUUID()}`;
    const [aliasA] = await db!
      .insert(schema.accountAliases)
      .values({
        accountId: accountA.id,
        aliasType: "company_name",
        rawValue: normalizedValue,
        normalizedValue,
        normalizationStrategy: "case_insensitive",
        isStrong: false,
        source: "test",
      })
      .returning();
    const [aliasB] = await db!
      .insert(schema.accountAliases)
      .values({
        accountId: accountB.id,
        aliasType: "company_name",
        rawValue: normalizedValue,
        normalizedValue,
        normalizationStrategy: "case_insensitive",
        isStrong: false,
        source: "test",
      })
      .returning();
    assert.notEqual(aliasA.accountId, aliasB.accountId);
    assert.equal(aliasA.normalizedValue, aliasB.normalizedValue);
  },
);

test(
  "account_aliases 'domain' strategy collides once two raw values are correctly normalized to the same domain",
  { skip },
  async () => {
    const accountA = await makeAccount();
    const accountB = await makeAccount();
    const normalizedValue = `collide-${crypto.randomUUID()}.example.com`;
    await db!.insert(schema.accountAliases).values({
      accountId: accountA.id,
      aliasType: "domain",
      rawValue: `HTTPS://WWW.${normalizedValue}`,
      normalizedValue,
      normalizationStrategy: "domain",
      isStrong: true,
      source: "test",
    });
    await assertDbRejects(
      db!.insert(schema.accountAliases).values({
        accountId: accountB.id,
        aliasType: "domain",
        rawValue: `  ${normalizedValue}  `,
        normalizedValue,
        normalizationStrategy: "domain",
        isStrong: true,
        source: "test",
      }),
      { constraint: "account_aliases_strong_type_normalized_value_uq" },
    );
  },
);

test(
  "account_aliases 'exact' strategy preserves case — two distinct case-sensitive IDs do not collide",
  { skip },
  async () => {
    const accountA = await makeAccount();
    const accountB = await makeAccount();
    const suffix = crypto.randomUUID();
    const [aliasA] = await db!
      .insert(schema.accountAliases)
      .values({
        accountId: accountA.id,
        aliasType: "hubspot_company_id",
        rawValue: `AbC-${suffix}`,
        normalizedValue: `AbC-${suffix}`,
        normalizationStrategy: "exact",
        isStrong: true,
        source: "test",
      })
      .returning();
    const [aliasB] = await db!
      .insert(schema.accountAliases)
      .values({
        accountId: accountB.id,
        aliasType: "hubspot_company_id",
        rawValue: `abc-${suffix}`,
        normalizedValue: `abc-${suffix}`,
        normalizationStrategy: "exact",
        isStrong: true,
        source: "test",
      })
      .returning();
    assert.notEqual(aliasA.normalizedValue, aliasB.normalizedValue);
  },
);

test(
  "account_aliases 'domain' strategy CHECK rejects a value still containing a protocol/www./path",
  { skip },
  async () => {
    const account = await makeAccount();
    await assertDbRejects(
      db!.insert(schema.accountAliases).values({
        accountId: account.id,
        aliasType: "domain",
        rawValue: "https://www.example.com/path",
        normalizedValue: "https://www.example.com/path",
        normalizationStrategy: "domain",
        isStrong: true,
        source: "test",
      }),
      { constraint: "account_aliases_normalized_value_matches_strategy" },
    );
  },
);

test(
  "account_aliases 'case_insensitive' strategy CHECK rejects an uppercase or untrimmed value",
  { skip },
  async () => {
    const account = await makeAccount();
    await assertDbRejects(
      db!.insert(schema.accountAliases).values({
        accountId: account.id,
        aliasType: "company_name",
        rawValue: "Acme Inc",
        normalizedValue: "Acme Inc",
        normalizationStrategy: "case_insensitive",
        isStrong: false,
        source: "test",
      }),
      { constraint: "account_aliases_normalized_value_matches_strategy" },
    );
  },
);

test(
  "account_aliases 'exact' strategy CHECK allows a mixed-case value (not force-lowercased)",
  { skip },
  async () => {
    const account = await makeAccount();
    const value = `MiXeD-${crypto.randomUUID()}`;
    const [alias] = await db!
      .insert(schema.accountAliases)
      .values({
        accountId: account.id,
        aliasType: "hubspot_company_id",
        rawValue: value,
        normalizedValue: value,
        normalizationStrategy: "exact",
        isStrong: true,
        source: "test",
      })
      .returning();
    assert.match(alias.normalizedValue, /[A-Z]/);
  },
);

// -----------------------------------------------------------------------
// identity_resolution_events
// -----------------------------------------------------------------------

test(
  "identity_resolution_events 'unresolved' requires both account_id and person_id null",
  { skip },
  async () => {
    const signal = await makeSignal();
    const account = await makeAccount();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        resolutionMethod: "no_match",
        confidence: "low",
        resolverVersion: "test-1",
        accountId: account.id,
      }),
      { constraint: "identity_resolution_events_account_id_matches_outcome" },
    );
  },
);

test(
  "identity_resolution_events 'account_resolved' requires account_id",
  { skip },
  async () => {
    const signal = await makeSignal();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "account_resolved",
        resolutionLevel: "company",
        resolutionMethod: "domain_alias_match",
        confidence: "high",
        resolverVersion: "test-1",
        accountMatchAction: "matched",
        // accountId intentionally omitted
      }),
      { constraint: "identity_resolution_events_account_id_matches_outcome" },
    );
  },
);

test(
  "identity_resolution_events 'person_resolved' requires both account_id and person_id",
  { skip },
  async () => {
    const signal = await makeSignal();
    const account = await makeAccount();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "person_resolved",
        resolutionLevel: "contact",
        resolutionMethod: "email_match",
        confidence: "high",
        resolverVersion: "test-1",
        accountId: account.id,
        accountMatchAction: "matched",
        personMatchAction: "created",
        // personId intentionally omitted
      }),
      { constraint: "identity_resolution_events_person_id_matches_outcome" },
    );
  },
);

test(
  "identity_resolution_events rejects personId set without contact-level resolution ('never manufacture a person')",
  { skip },
  async () => {
    const signal = await makeSignal();
    const account = await makeAccount();
    const person = await makePerson();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "person_resolved",
        resolutionLevel: "company",
        resolutionMethod: "email_match",
        confidence: "high",
        resolverVersion: "test-1",
        accountId: account.id,
        accountMatchAction: "matched",
        personId: person.id,
        personMatchAction: "matched",
      }),
      {
        constraint: "identity_resolution_events_person_requires_contact_level",
      },
    );
  },
);

test(
  "identity_resolution_events rejects outcome='unresolved' with a non-anonymous resolution_level",
  { skip },
  async () => {
    const signal = await makeSignal();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "unresolved",
        resolutionLevel: "company",
        resolutionMethod: "no_match",
        confidence: "low",
        resolverVersion: "test-1",
      }),
      {
        constraint:
          "identity_resolution_events_resolution_level_matches_outcome",
      },
    );
  },
);

test(
  "identity_resolution_events rejects outcome='account_resolved' with a resolution_level other than 'company'",
  { skip },
  async () => {
    const signal = await makeSignal();
    const account = await makeAccount();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "account_resolved",
        resolutionLevel: "contact",
        resolutionMethod: "domain_alias_match",
        confidence: "high",
        resolverVersion: "test-1",
        accountId: account.id,
        accountMatchAction: "matched",
      }),
      {
        constraint:
          "identity_resolution_events_resolution_level_matches_outcome",
      },
    );
  },
);

test(
  "identity_resolution_events rejects a non-null account_match_action when outcome='unresolved'",
  { skip },
  async () => {
    const signal = await makeSignal();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        resolutionMethod: "no_match",
        confidence: "low",
        resolverVersion: "test-1",
        accountMatchAction: "matched",
      }),
      {
        constraint:
          "identity_resolution_events_account_match_action_matches_outcome",
      },
    );
  },
);

test(
  "identity_resolution_events requires account_match_action when outcome='account_resolved'",
  { skip },
  async () => {
    const signal = await makeSignal();
    const account = await makeAccount();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "account_resolved",
        resolutionLevel: "company",
        resolutionMethod: "domain_alias_match",
        confidence: "high",
        resolverVersion: "test-1",
        accountId: account.id,
        // accountMatchAction intentionally omitted
      }),
      {
        constraint:
          "identity_resolution_events_account_match_action_matches_outcome",
      },
    );
  },
);

test(
  "identity_resolution_events rejects a non-null person_match_action when outcome is not 'person_resolved'",
  { skip },
  async () => {
    const signal = await makeSignal();
    const account = await makeAccount();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "account_resolved",
        resolutionLevel: "company",
        resolutionMethod: "domain_alias_match",
        confidence: "high",
        resolverVersion: "test-1",
        accountId: account.id,
        accountMatchAction: "matched",
        personMatchAction: "matched",
      }),
      {
        constraint:
          "identity_resolution_events_person_match_action_matches_outcome",
      },
    );
  },
);

test(
  "identity_resolution_events requires person_match_action when outcome='person_resolved'",
  { skip },
  async () => {
    const signal = await makeSignal();
    const account = await makeAccount();
    const person = await makePerson();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "person_resolved",
        resolutionLevel: "contact",
        resolutionMethod: "email_match",
        confidence: "high",
        resolverVersion: "test-1",
        accountId: account.id,
        accountMatchAction: "matched",
        personId: person.id,
        // personMatchAction intentionally omitted
      }),
      {
        constraint:
          "identity_resolution_events_person_match_action_matches_outcome",
      },
    );
  },
);

test(
  "identity_resolution_events rejects a non-array candidate_matches",
  { skip },
  async () => {
    const signal = await makeSignal();
    await assertDbRejects(
      db!.insert(schema.identityResolutionEvents).values({
        signalId: signal.id,
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        resolutionMethod: "no_match",
        confidence: "low",
        resolverVersion: "test-1",
        candidateMatches: { not: "an array" } as any,
      }),
      { constraint: "identity_resolution_events_candidate_matches_is_array" },
    );
  },
);

test(
  "identity_resolution_events rejects an invalid outcome/confidence at the enum level",
  { skip },
  async () => {
    const signal = await makeSignal();
    await assertDbRejects(
      db!.execute(
        sql`INSERT INTO identity_resolution_events
          (signal_id, outcome, resolution_level, resolution_method, confidence, resolver_version)
          VALUES (${signal.id}, 'made_up_outcome', 'anonymous', 'no_match', 'low', 'test-1')`,
      ),
      { code: "22P02" },
    );
    await assertDbRejects(
      db!.execute(
        sql`INSERT INTO identity_resolution_events
          (signal_id, outcome, resolution_level, resolution_method, confidence, resolver_version)
          VALUES (${signal.id}, 'unresolved', 'anonymous', 'no_match', 'certain', 'test-1')`,
      ),
      { code: "22P02" },
    );
  },
);

test(
  "identity_resolution_events rejects UPDATE and DELETE",
  { skip },
  async () => {
    const signal = await makeSignal();
    const [event] = await db!
      .insert(schema.identityResolutionEvents)
      .values({
        signalId: signal.id,
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        resolutionMethod: "no_match",
        confidence: "low",
        resolverVersion: "test-1",
      })
      .returning();
    await assertDbRejects(
      db!
        .update(schema.identityResolutionEvents)
        .set({ reason: "edited" })
        .where(eq(schema.identityResolutionEvents.id, event.id)),
      { code: "P0001", messageIncludes: "identity_resolution_events" },
    );
    await assertDbRejects(
      db!
        .delete(schema.identityResolutionEvents)
        .where(eq(schema.identityResolutionEvents.id, event.id)),
      { code: "P0001", messageIncludes: "identity_resolution_events" },
    );
  },
);

test(
  "unresolved-then-resolved: the latest identity_resolution_events row alone carries the complete current binding",
  { skip },
  async () => {
    const signal = await makeSignal();
    const account = await makeAccount();
    const person = await makePerson();

    await db!.insert(schema.identityResolutionEvents).values({
      signalId: signal.id,
      outcome: "unresolved",
      resolutionLevel: "anonymous",
      resolutionMethod: "no_match",
      confidence: "low",
      resolverVersion: "test-1",
    });

    await db!.insert(schema.identityResolutionEvents).values({
      signalId: signal.id,
      outcome: "person_resolved",
      resolutionLevel: "contact",
      resolutionMethod: "email_match",
      confidence: "high",
      resolverVersion: "test-1",
      accountId: account.id,
      accountMatchAction: "matched",
      personId: person.id,
      personMatchAction: "created",
    });

    const rows = await db!
      .select()
      .from(schema.identityResolutionEvents)
      .where(eq(schema.identityResolutionEvents.signalId, signal.id))
      .orderBy(
        schema.identityResolutionEvents.createdAt,
        schema.identityResolutionEvents.id,
      );

    assert.equal(rows.length, 2);
    const latest = rows[rows.length - 1];
    // The latest row alone is self-sufficient — it carries BOTH the
    // account and person binding, unlike a granular person-only event
    // would have.
    assert.equal(latest.outcome, "person_resolved");
    assert.equal(latest.accountId, account.id);
    assert.equal(latest.personId, person.id);

    // signals itself was never touched — no UPDATE occurred, and a
    // direct attempt still fails via the immutability trigger.
    await assertDbRejects(
      db!
        .update(schema.signals)
        .set({ signalType: "changed" })
        .where(eq(schema.signals.id, signal.id)),
      { code: "P0001", messageIncludes: "signals" },
    );
  },
);

test.after(async () => {
  await pool?.end();
});
