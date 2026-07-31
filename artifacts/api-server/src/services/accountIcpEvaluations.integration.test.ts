// Integration tests for the account-level ICP preview orchestration,
// exercised end-to-end against a real, migrated Postgres instance: real
// db, real resolvers (./icpEvaluationResolvers.ts), real
// @workspace/evaluator-persistence, and the real integrity triggers/
// constraints from lib/db/drizzle/0001_integrity_triggers.sql — no fakes
// anywhere in this file. Tests runPreviewIcpEvaluationForAccount()
// directly, not through HTTP — the route boundary (validation, error-code
// mapping, response serialization, and the "evaluationMode can never be
// smuggled in" guarantee) is already covered by
// ../routes/accountIcpEvaluations.route.test.ts using injected fakes; this
// file's job is proving the real orchestration composes correctly.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed as part of this change — see the accompanying report for the
// exact Terminal command to run it.
//
// Mirrors the same "build our own pool/drizzle instance rather than
// import @workspace/db's singleton" pattern already used in
// ../routes/accountEvaluations.integration.test.ts and
// ../routes/icpProfiles.integration.test.ts. No truncation or row
// deletion anywhere — isolation comes entirely from crypto.randomUUID()-
// suffixed fixture values, and several tables here are immutable/
// insert-only by trigger regardless (account_snapshots, account_evaluations).
//
// Run with: tsx --test src/services/accountIcpEvaluations.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { activateVersion } from "./icpProfiles.js";
import { runPreviewIcpEvaluationForAccount } from "./accountEvaluations.js";
import {
  CURRENT_STATE_SNAPSHOT_SOURCE,
  NoResolvablePreviewVersionError,
} from "./icpEvaluationResolvers.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

// ---------------------------------------------------------------------
// Runtime narrowing for jsonb columns typed `unknown` (no `.$type<>()` on
// account_snapshots.normalized_input) — asserts rather than casts, so a
// genuinely malformed stored value fails the assertion instead of being
// silently coerced.
// ---------------------------------------------------------------------

function assertIsRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${context} must be an object`,
  );
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

async function makeAccount(
  overrides: { companyName?: string | null; companyDomain?: string | null } = {},
) {
  const [account] = await db!
    .insert(schema.accounts)
    .values({
      accountKey: `dom:icp-eval-integration-${crypto.randomUUID()}.example`,
      ...overrides,
    })
    .returning();
  return account;
}

async function makeProfile(marker: string) {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `icp-eval-integration-${marker}-${crypto.randomUUID()}` })
    .returning();
  return profile;
}

function syntheticProfileConfig(marker = "base") {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "has_domain",
          description: `Has a domain (${marker})`,
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

// Safe: the raw UPDATE below runs while OLD.status is still 'draft', so
// icp_profile_versions_immutable_after_publish does not reject it —
// mirrors the identical helper already proven in
// lib/evaluator-persistence/src/evaluateAndPersist.integration.test.ts.
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
  return published!;
}

// Reuses the real activateVersion service (not a hand-rolled pointer
// update) so activation stays consistent with how it actually happens in
// production.
async function makeActiveVersion(
  profileId: string,
  config: unknown = syntheticProfileConfig(),
  versionNumber = 1,
) {
  const published = await makePublishedVersion(profileId, config, versionNumber);
  await activateVersion({
    db: db!,
    profileId,
    versionId: published.id,
    performedBy: null,
  });
  return published;
}

async function countSnapshotsForAccount(accountId: string): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountSnapshots)
    .where(eq(schema.accountSnapshots.accountId, accountId));
  return Number(row?.value ?? 0);
}

async function countEvaluationsForAccount(accountId: string): Promise<number> {
  const [row] = await db!
    .select({ value: count() })
    .from(schema.accountEvaluations)
    .where(eq(schema.accountEvaluations.accountId, accountId));
  return Number(row?.value ?? 0);
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

test(
  "preview prefers a draft over an active version",
  { skip },
  async () => {
    const account = await makeAccount({
      companyName: "Acme Rockets",
      companyDomain: "acme-rockets.example",
    });
    const profile = await makeProfile("prefers-draft");
    const activeVersion = await makeActiveVersion(
      profile.id,
      syntheticProfileConfig("active"),
      1,
    );
    const draftVersion = await makeDraftVersion(
      profile.id,
      syntheticProfileConfig("draft"),
      2,
    );

    const evaluation = await runPreviewIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });

    assert.equal(evaluation.status, "completed");
    assert.equal(evaluation.evaluationMode, "preview");
    assert.equal(evaluation.profileVersionId, draftVersion.id);
    assert.notEqual(evaluation.profileVersionId, activeVersion.id);

    const [evaluationRow] = await db!
      .select()
      .from(schema.accountEvaluations)
      .where(eq(schema.accountEvaluations.id, evaluation.id))
      .limit(1);
    assert.ok(evaluationRow, "evaluation row must exist");

    const [snapshotRow] = await db!
      .select()
      .from(schema.accountSnapshots)
      .where(eq(schema.accountSnapshots.id, evaluation.snapshotId))
      .limit(1);
    assert.ok(snapshotRow, "snapshot row must exist");
    assert.equal(snapshotRow.accountId, account.id);
    assert.equal(snapshotRow.source, CURRENT_STATE_SNAPSHOT_SOURCE);

    assertIsRecord(snapshotRow.normalizedInput, "snapshot.normalizedInput");
    assertIsRecord(
      snapshotRow.normalizedInput.company,
      "normalizedInput.company",
    );
    assert.equal(snapshotRow.normalizedInput.company.name, account.companyName);
    assert.equal(
      snapshotRow.normalizedInput.company.domain,
      account.companyDomain,
    );
    assert.equal(snapshotRow.normalizedInput.doNotContact, true);

    assertIsRecord(
      snapshotRow.normalizedInput.consent,
      "normalizedInput.consent",
    );
    assert.deepEqual(snapshotRow.normalizedInput.consent, {
      email: "unknown",
      call: "unknown",
      liBasisCleared: "unknown",
      dpoVoiceCleared: "unknown",
    });
  },
);

test(
  "preview falls back to the active version when no draft exists",
  { skip },
  async () => {
    const account = await makeAccount();
    const profile = await makeProfile("falls-back-active");
    const activeVersion = await makeActiveVersion(profile.id);

    const evaluation = await runPreviewIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });

    assert.equal(evaluation.status, "completed");
    assert.equal(evaluation.evaluationMode, "preview");
    assert.equal(evaluation.profileVersionId, activeVersion.id);
  },
);

test(
  "an unresolvable profile version creates no snapshot or evaluation for the account (proves profile resolution happens before snapshot creation)",
  { skip },
  async () => {
    const account = await makeAccount();
    const profile = await makeProfile("unresolvable");
    // Deliberately no draft and no active version for this profile.

    const snapshotsBefore = await countSnapshotsForAccount(account.id);
    const evaluationsBefore = await countEvaluationsForAccount(account.id);

    await assert.rejects(
      runPreviewIcpEvaluationForAccount({
        db: db!,
        accountId: account.id,
        profileId: profile.id,
      }),
      NoResolvablePreviewVersionError,
    );

    assert.equal(await countSnapshotsForAccount(account.id), snapshotsBefore);
    assert.equal(
      await countEvaluationsForAccount(account.id),
      evaluationsBefore,
    );
  },
);

test(
  "a malformed stored profile config produces a persisted failed preview evaluation, not a thrown error",
  { skip },
  async () => {
    const account = await makeAccount();
    const profile = await makeProfile("malformed-config");
    const malformedConfig = {
      malformed: true,
      note: "not a real profile config",
    };
    await makeDraftVersion(profile.id, malformedConfig);

    const evaluation = await runPreviewIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });

    assert.equal(evaluation.status, "failed");
    assert.equal(evaluation.evaluationMode, "preview");
    assert.ok(
      evaluation.errorDetail && evaluation.errorDetail.length > 0,
      "errorDetail must be non-empty",
    );
    assert.match(evaluation.errorDetail!, /IcpProfileConfigV1/);

    const [evaluationRow] = await db!
      .select()
      .from(schema.accountEvaluations)
      .where(eq(schema.accountEvaluations.id, evaluation.id))
      .limit(1);
    assert.ok(evaluationRow, "evaluation row must exist");

    const [snapshotRow] = await db!
      .select()
      .from(schema.accountSnapshots)
      .where(eq(schema.accountSnapshots.id, evaluation.snapshotId))
      .limit(1);
    assert.ok(snapshotRow, "snapshot row must exist");
    assert.equal(snapshotRow.accountId, account.id);
  },
);

test.after(async () => {
  await pool?.end();
});
