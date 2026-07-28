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
import { eq } from "drizzle-orm";
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
  // Every expectation field the caller supplied must match — not "at
  // least one of them". If both `code` and `messageIncludes` are given,
  // both have to be true.
  if (expectation.constraint !== undefined) {
    assert.equal(
      caught.constraint,
      expectation.constraint,
      `expected constraint "${expectation.constraint}", got constraint=${caught.constraint} code=${caught.code} message=${caught.message}`,
    );
  }
  if (expectation.code !== undefined) {
    assert.equal(
      caught.code,
      expectation.code,
      `expected code "${expectation.code}", got constraint=${caught.constraint} code=${caught.code} message=${caught.message}`,
    );
  }
  if (expectation.messageIncludes !== undefined) {
    assert.ok(
      String(caught.message ?? "").includes(expectation.messageIncludes),
      `expected message to include "${expectation.messageIncludes}", got constraint=${caught.constraint} code=${caught.code} message=${caught.message}`,
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

async function makeCompletedProductionEvaluation(overrides: {
  accountId: string;
  snapshotId: string;
  profileVersionId: string;
  evaluatorVersionId: string;
}) {
  const [evaluation] = await db!
    .insert(schema.accountEvaluations)
    .values({
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

test.after(async () => {
  await pool?.end();
});
