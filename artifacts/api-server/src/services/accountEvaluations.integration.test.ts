// Integration tests for GTM V2 Stage 4, Unit 2 — the evaluation resolution
// lifecycle in ./accountEvaluations.ts (applyProductionEvaluationLifecycleEffects,
// and createAccountEvaluation's transaction wrapping around it) — exercised
// end-to-end against a real, migrated Postgres instance: real db, real
// triggers/constraints (attention_items_lifecycle_guard,
// account_evaluations_immutable), real services (recordAccountFact,
// runOfficialIcpEvaluationForAccount, runPreviewIcpEvaluationForAccount) —
// no fakes anywhere in this file.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS itself
// (does not fail) when DATABASE_URL is unset. This file was NOT executed as
// part of this change (no Postgres instance was started/available in this
// environment) — see the accompanying report for the exact command to run
// it.
//
// Mirrors ../services/accountFacts.integration.test.ts's own conventions:
// builds its own pool/drizzle instance rather than importing
// @workspace/db's singleton; no truncation or row deletion anywhere —
// isolation comes from crypto.randomUUID()-suffixed fixture values, and
// account_evaluations/account_snapshots/attention_items are immutable/
// insert-mostly by trigger regardless.
//
// Run with: tsx --test src/services/accountEvaluations.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import {
  createAccountEvaluation,
  runOfficialIcpEvaluationForAccount,
  runPreviewIcpEvaluationForAccount,
  type ApplyEvaluationLifecycleEffectsFn,
} from "./accountEvaluations.js";
import { recordAccountFact } from "./accountFacts.js";
import {
  createCurrentAccountSnapshot,
  resolveCanonicalEvaluatorVersion,
} from "./icpEvaluationResolvers.js";
import { activateVersion } from "./icpProfiles.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool, Client } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

// ---------------------------------------------------------------------
// Fixtures — same shape/spirit as ../services/accountFacts.integration.test.ts's
// own fixture helpers.
// ---------------------------------------------------------------------

async function makeAccount() {
  const [account] = await db!
    .insert(schema.accounts)
    .values({
      accountKey: `dom:account-evaluations-integration-${crypto.randomUUID()}.example`,
    })
    .returning();
  return account!;
}

// A single fit rule referencing company.industry — non-empty when a
// company.industry account_facts value exists, otherwise the exact
// condition that populates a completed evaluation's own missingInputs
// (see @workspace/evaluator's evaluateScoredRuleSet/buildMissingInputs).
function syntheticProfileConfigWithIndustryFit() {
  return {
    configSchemaVersion: "v1",
    fit: {
      rules: [
        {
          id: "fit_industry_banking",
          description: "Industry is Banking",
          points: 10,
          condition: { op: "eq", field: "company.industry", value: "Banking" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

async function makeActiveProfileVersion(config: unknown) {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `account-evaluations-integration-${crypto.randomUUID()}` })
    .returning();
  const [draft] = await db!
    .insert(schema.icpProfileVersions)
    .values({ profileId: profile!.id, versionNumber: 1, config })
    .returning();
  const [published] = await db!
    .update(schema.icpProfileVersions)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(schema.icpProfileVersions.id, draft!.id))
    .returning();
  await activateVersion({
    db: db!,
    profileId: profile!.id,
    versionId: published!.id,
    performedBy: null,
  });
  return { profile: profile!, version: published! };
}

// A valid JSON object per icp_profile_versions' own CHECK (jsonb_typeof =
// 'object'), but missing configSchemaVersion and every required
// IcpProfileConfigV1 section — the exact shape
// lib/evaluator-persistence/src/evaluateAndPersist.integration.test.ts's own
// "malformed stored profile config" test uses to deterministically produce
// a truthful status: "failed" row (never a thrown error, per
// evaluateAndPersist's own IcpProfileConfigV1Schema.safeParse branch).
// Publishing/activating it (via makeActiveProfileVersion) is what lets a
// PRODUCTION evaluation reference it at all — evaluateAndPersist's
// production-requires-published check only inspects profileVersion.status,
// never config content.
function malformedProfileConfig() {
  return { malformed: true, note: "not a real profile config" };
}

async function makeMalformedActiveProfileVersion() {
  return makeActiveProfileVersion(malformedProfileConfig());
}

async function openAttentionItems(accountId: string) {
  return db!
    .select()
    .from(schema.attentionItems)
    .where(
      and(
        eq(schema.attentionItems.accountId, accountId),
        eq(schema.attentionItems.status, "open"),
      ),
    );
}

async function attentionItemsByReasonCode(accountId: string, reasonCode: string) {
  return db!
    .select()
    .from(schema.attentionItems)
    .where(
      and(
        eq(schema.attentionItems.accountId, accountId),
        eq(schema.attentionItems.reasonCode, reasonCode),
      ),
    );
}

// ---------------------------------------------------------------------
// 1/2 — freshness: a fresh successful production evaluation resolves only
// evaluation_stale items its OWN snapshot evidence actually covers.
// Resolution is causal (accountFactId identity, compared fresh at
// resolution time against the evaluation's immutable snapshot evidence),
// never timestamp-based — see ./accountEvaluations.ts's own module
// comment for why a capturedAt/createdAt comparison across two
// independently-committing transactions could never be made sound.
// ---------------------------------------------------------------------

test(
  "a fresh successful production evaluation resolves an evaluation_stale item raised by a fact change that predates its own snapshot",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );

    const evaluation1 = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation1.status, "completed");

    // Raises an open evaluation_stale item (source: evaluation, sourceRef:
    // evaluation1.id) — Unit 1's own mechanism, exercised here through the
    // real production call path.
    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });

    const staleAfterFact = await attentionItemsByReasonCode(account.id, "evaluation_stale");
    assert.equal(staleAfterFact.length, 1);
    assert.equal(staleAfterFact[0]?.status, "open");

    // A fresh official evaluation captures its OWN snapshot strictly AFTER
    // the fact write above committed — the freshness rule must resolve the
    // item.
    const evaluation2 = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation2.status, "completed");

    const [resolved] = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.id, staleAfterFact[0]!.id));
    assert.equal(resolved?.status, "resolved");
    assert.equal(resolved?.resolvedBy, "system:evaluation");
    assert.match(resolved?.resolutionReason ?? "", new RegExp(evaluation2.id));
  },
);

test(
  "a production evaluation does NOT resolve an evaluation_stale item when its own snapshot evidence does not reflect the account's current relevant facts",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile, version } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );
    const evaluatorVersion = await resolveCanonicalEvaluatorVersion(db!);

    const evaluation1 = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation1.status, "completed");

    // A snapshot captured while company.industry is still unset — its
    // evidence will never record an accountFactId for that field.
    const staleSnapshot = await createCurrentAccountSnapshot(db!, account.id);

    // Only now does the fact arrive — findLatestCompletedProductionEvaluation
    // sees evaluation1 (the only completed production evaluation so far),
    // so this raises evaluation_stale against it, via Unit 1's own
    // mechanism, unchanged.
    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });
    const staleItems = await attentionItemsByReasonCode(account.id, "evaluation_stale");
    assert.equal(staleItems.length, 1);
    assert.equal(staleItems[0]?.status, "open");

    // A second evaluation built directly from the STALE (pre-fact)
    // snapshot — simulating an evaluation whose evidence predates a fact
    // change that happened before the evaluation itself was persisted.
    // No timestamp is constructed or compared anywhere in this test; the
    // causal mismatch is real: staleSnapshot's evidence has no
    // company.industry entry, while account_fact_current now does.
    const evaluation2 = await createAccountEvaluation({
      db: db!,
      snapshotId: staleSnapshot.id,
      profileVersionId: version.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "production",
    });
    assert.equal(evaluation2.status, "completed");

    const [stillOpen] = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.id, staleItems[0]!.id));
    assert.equal(
      stillOpen?.status,
      "open",
      "an evaluation whose own snapshot evidence does not match current relevant facts must never resolve evaluation_stale",
    );
  },
);

// ---------------------------------------------------------------------
// Deterministic concurrency coverage — the account-row lock. Two real,
// separately-controlled Postgres connections: one (a raw pg.Client) holds
// SELECT ... FOR UPDATE on the account open, the other runs the real
// service call on the shared pool. "Blocked" is proven by racing the
// service call's own promise against a bounded timeout and asserting it
// has not settled — not by asserting anything about how fast it runs
// once unblocked. No other timing assertion is made.
// ---------------------------------------------------------------------

async function assertStillPending(promise: Promise<unknown>, message: string): Promise<void> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(settled, false, message);
}

test(
  "recordAccountFact blocks while another transaction holds the account's row lock, and proceeds once it is released",
  { skip },
  async () => {
    const account = await makeAccount();

    const holder = new Client({ connectionString: DATABASE_URL });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [account.id]);

    const pending = recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });

    await assertStillPending(
      pending,
      "recordAccountFact must still be blocked while the holder keeps the account row locked",
    );

    await holder.query("ROLLBACK");
    await holder.end();

    const fact = await pending;
    assert.equal(fact.field, "company.industry");
  },
);

test(
  "createAccountEvaluation (production) blocks while another transaction holds the account's row lock, persists nothing until released, and then proceeds",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile, version } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );
    const evaluatorVersion = await resolveCanonicalEvaluatorVersion(db!);
    const snapshot = await createCurrentAccountSnapshot(db!, account.id);

    const holder = new Client({ connectionString: DATABASE_URL });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [account.id]);

    const pending = createAccountEvaluation({
      db: db!,
      snapshotId: snapshot.id,
      profileVersionId: version.id,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "production",
    });

    await assertStillPending(
      pending,
      "createAccountEvaluation must still be blocked while the holder keeps the account row locked",
    );

    // The lock is acquired before evaluateAndPersistFn's own INSERT (see
    // createAccountEvaluation's doc comment) — while blocked, nothing has
    // been persisted yet.
    const rowsWhileBlocked = await db!
      .select()
      .from(schema.accountEvaluations)
      .where(eq(schema.accountEvaluations.snapshotId, snapshot.id));
    assert.equal(rowsWhileBlocked.length, 0);

    await holder.query("ROLLBACK");
    await holder.end();

    const evaluation = await pending;
    assert.equal(evaluation.status, "completed");
  },
);

// ---------------------------------------------------------------------
// 3 — cross-account isolation.
// ---------------------------------------------------------------------

test(
  "resolving one account's evaluation_stale item never touches another account's open attention items",
  { skip },
  async () => {
    const accountA = await makeAccount();
    const accountB = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );

    for (const account of [accountA, accountB]) {
      await runOfficialIcpEvaluationForAccount({
        db: db!,
        accountId: account.id,
        profileId: profile.id,
      });
      await recordAccountFact({
        db: db!,
        accountId: account.id,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.test",
        expectedCurrentFactId: null,
        correctionReason: null,
      });
    }

    const staleB = await attentionItemsByReasonCode(accountB.id, "evaluation_stale");
    assert.equal(staleB.length, 1);
    assert.equal(staleB[0]?.status, "open");

    // Only account A gets a fresh evaluation.
    await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: accountA.id,
      profileId: profile.id,
    });

    const staleAAfter = await openAttentionItems(accountA.id);
    assert.equal(staleAAfter.length, 0, "account A's own staleness must be resolved");

    const [staleBAfter] = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.id, staleB[0]!.id));
    assert.equal(
      staleBAfter?.status,
      "open",
      "account B's staleness must be untouched by account A's evaluation",
    );
  },
);

// ---------------------------------------------------------------------
// 4 — preview evaluations are a complete no-op.
// ---------------------------------------------------------------------

test(
  "a preview evaluation causes zero attention-item changes, even when open evaluation_failed/evaluation_stale items already exist",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );
    const { profile: malformedProfile } = await makeMalformedActiveProfileVersion();

    await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });
    // A failed PRODUCTION evaluation against the malformed profile — opens
    // an evaluation_failed item.
    await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: malformedProfile.id,
    });

    // Capture the complete open-attention-item baseline before the preview
    // runs — deliberately not hard-coded to a specific count. Besides
    // evaluation_stale + evaluation_failed, an open evaluation_missing_inputs
    // item may already legitimately exist here too (GTM V2 Stage 4 Unit 2:
    // syntheticProfileConfigWithIndustryFit's fit rule has no
    // company.industry fact yet at the first evaluation, so that first
    // evaluation's own missingInputs is non-empty).
    const openBefore = await openAttentionItems(account.id);

    await runPreviewIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });

    const openAfter = await openAttentionItems(account.id);
    assert.equal(
      openAfter.length,
      openBefore.length,
      "a preview evaluation must not create, resolve, or otherwise touch any attention item",
    );
    assert.deepEqual(
      new Set(openAfter.map((i) => i.id)),
      new Set(openBefore.map((i) => i.id)),
    );
  },
);

// ---------------------------------------------------------------------
// 5/6/7/8 — evaluation_failed lifecycle.
// ---------------------------------------------------------------------

test(
  "a failed production evaluation creates exactly one open evaluation_failed item",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeMalformedActiveProfileVersion();

    const evaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation.status, "failed");
    assert.ok(evaluation.errorDetail && evaluation.errorDetail.length > 0);

    const failedItems = await attentionItemsByReasonCode(account.id, "evaluation_failed");
    assert.equal(failedItems.length, 1);
    assert.equal(failedItems[0]?.status, "open");
    assert.equal(failedItems[0]?.source, "evaluation");
    assert.equal(failedItems[0]?.sourceRef, null);
    assert.equal(failedItems[0]?.createdBy, "system:evaluation");
  },
);

test(
  "repeated failed production evaluations for the same account collapse into ONE open evaluation_failed item, never a duplicate row or a conflict",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeMalformedActiveProfileVersion();

    const evaluationA = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    const evaluationB = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluationA.status, "failed");
    assert.equal(evaluationB.status, "failed");
    assert.notEqual(
      evaluationA.id,
      evaluationB.id,
      "each failed run persists its own distinct account_evaluations row — no idempotency key exists",
    );

    const failedItems = await attentionItemsByReasonCode(account.id, "evaluation_failed");
    assert.equal(
      failedItems.length,
      1,
      "two independently-failing evaluations must still be exactly one open operational condition",
    );
    assert.equal(failedItems[0]?.status, "open");
  },
);

test(
  "a failed production evaluation does not clear a pre-existing open evaluation_stale item",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );
    const { profile: malformedProfile } = await makeMalformedActiveProfileVersion();

    await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });
    const staleBefore = await attentionItemsByReasonCode(account.id, "evaluation_stale");
    assert.equal(staleBefore.length, 1);
    assert.equal(staleBefore[0]?.status, "open");

    const failed = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: malformedProfile.id,
    });
    assert.equal(failed.status, "failed");

    const [staleAfter] = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.id, staleBefore[0]!.id));
    assert.equal(staleAfter?.status, "open");
  },
);

test(
  "a later successful production evaluation resolves the open evaluation_failed item a prior failed run created",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );
    const { profile: malformedProfile } = await makeMalformedActiveProfileVersion();

    const failed = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: malformedProfile.id,
    });
    assert.equal(failed.status, "failed");
    const failedItems = await attentionItemsByReasonCode(account.id, "evaluation_failed");
    assert.equal(failedItems.length, 1);
    assert.equal(failedItems[0]?.status, "open");

    const succeeded = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(succeeded.status, "completed");

    const [resolved] = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.id, failedItems[0]!.id));
    assert.equal(resolved?.status, "resolved");
    assert.equal(resolved?.resolvedBy, "system:evaluation");
  },
);

// ---------------------------------------------------------------------
// 9/10/11 — evaluation_missing_inputs lifecycle, chained through one
// account's evolving evidence (a fact recorded partway through) rather
// than three independent fixtures.
// ---------------------------------------------------------------------

test(
  "evaluation_missing_inputs: created on first completed evaluation with missing inputs, deduped on replay, resolved once the input is supplied",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );

    // No company.industry fact exists yet — the fit rule's referenced
    // field is genuinely missing.
    const evaluation1 = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation1.status, "completed");
    assert.ok(Array.isArray(evaluation1.missingInputs) && evaluation1.missingInputs.length > 0);

    const missingItemsAfterFirst = await attentionItemsByReasonCode(
      account.id,
      "evaluation_missing_inputs",
    );
    assert.equal(missingItemsAfterFirst.length, 1);
    assert.equal(missingItemsAfterFirst[0]?.status, "open");
    assert.equal(missingItemsAfterFirst[0]?.sourceRef, null);

    // A second run, still with no company.industry fact — must replay into
    // the SAME open item, never a second row.
    const evaluation2 = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation2.status, "completed");
    assert.ok(Array.isArray(evaluation2.missingInputs) && evaluation2.missingInputs.length > 0);

    const missingItemsAfterSecond = await attentionItemsByReasonCode(
      account.id,
      "evaluation_missing_inputs",
    );
    assert.equal(missingItemsAfterSecond.length, 1, "must dedupe to the same open item, not create a second one");
    assert.equal(missingItemsAfterSecond[0]?.id, missingItemsAfterFirst[0]?.id);

    // Now the previously-missing input is supplied.
    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });

    const evaluation3 = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation3.status, "completed");
    assert.deepEqual(evaluation3.missingInputs, []);

    const [resolvedMissingItem] = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.id, missingItemsAfterFirst[0]!.id));
    assert.equal(resolvedMissingItem?.status, "resolved");
    assert.equal(resolvedMissingItem?.resolvedBy, "system:evaluation");
  },
);

// ---------------------------------------------------------------------
// 12 — historical immutability: resolving attention items never mutates
// evaluation history, and resolution never rewrites an item's own
// creation-time fields.
// ---------------------------------------------------------------------

test(
  "resolving an evaluation_stale item preserves every creation-time field verbatim, and never mutates historical account_evaluations rows",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );

    const evaluation1 = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });
    const [staleItem] = await attentionItemsByReasonCode(account.id, "evaluation_stale");
    assert.ok(staleItem);

    await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });

    const [resolvedItem] = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.id, staleItem!.id));
    assert.equal(resolvedItem?.status, "resolved");
    // Every creation-time field is byte-identical to what was captured
    // right after creation — resolution only ever sets status/resolvedAt/
    // resolvedBy/resolutionReason (attention_items_lifecycle_guard is the
    // final DB-level authority for this; this asserts the observable
    // result matches).
    assert.equal(resolvedItem?.accountId, staleItem!.accountId);
    assert.equal(resolvedItem?.reasonCode, staleItem!.reasonCode);
    assert.equal(resolvedItem?.reasonDetail, staleItem!.reasonDetail);
    assert.equal(resolvedItem?.source, staleItem!.source);
    assert.equal(resolvedItem?.sourceRef, staleItem!.sourceRef);
    assert.deepEqual(resolvedItem?.context, staleItem!.context);
    assert.equal(resolvedItem?.createdAt.getTime(), staleItem!.createdAt.getTime());
    assert.equal(resolvedItem?.createdBy, staleItem!.createdBy);

    // The historical (now-superseded) evaluation row is untouched —
    // account_evaluations is insert-only/immutable regardless, this just
    // confirms Unit 2 introduced no update path onto it.
    const [historicalEvaluation] = await db!
      .select()
      .from(schema.accountEvaluations)
      .where(eq(schema.accountEvaluations.id, evaluation1.id));
    assert.equal(historicalEvaluation?.status, evaluation1.status);
    assert.equal(historicalEvaluation?.fitScore, evaluation1.fitScore);
    assert.equal(historicalEvaluation?.createdAt.getTime(), evaluation1.createdAt.getTime());
  },
);

// ---------------------------------------------------------------------
// 13 — transaction atomicity: a lifecycle-effect failure rolls back the
// evaluation row too. Deterministic (no concurrency) — a real
// evaluateAndPersistFn persists a real row inside createAccountEvaluation's
// own transaction, while an injected applyLifecycleEffectsFn deterministically
// throws; the test then proves no row survived.
// ---------------------------------------------------------------------

test(
  "when applyLifecycleEffectsFn throws, the just-persisted account_evaluations row is rolled back, not left orphaned",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFit(),
    );
    const snapshot = await createCurrentAccountSnapshot(db!, account.id);
    const evaluatorVersion = await resolveCanonicalEvaluatorVersion(db!);
    const profileVersionId = (
      await db!
        .select({ id: schema.icpProfileVersions.id })
        .from(schema.icpProfileVersions)
        .where(eq(schema.icpProfileVersions.profileId, profile.id))
        .limit(1)
    )[0]!.id;

    const boom = new Error("simulated lifecycle-effect failure");
    const throwingLifecycleFn: ApplyEvaluationLifecycleEffectsFn = async () => {
      throw boom;
    };

    await assert.rejects(
      createAccountEvaluation(
        {
          db: db!,
          snapshotId: snapshot.id,
          profileVersionId,
          evaluatorVersionId: evaluatorVersion.id,
          evaluationMode: "production",
        },
        undefined,
        throwingLifecycleFn,
      ),
      boom,
    );

    const rows = await db!
      .select()
      .from(schema.accountEvaluations)
      .where(eq(schema.accountEvaluations.snapshotId, snapshot.id));
    assert.equal(
      rows.length,
      0,
      "the evaluation insert must roll back atomically with the failed lifecycle effect",
    );
  },
);
