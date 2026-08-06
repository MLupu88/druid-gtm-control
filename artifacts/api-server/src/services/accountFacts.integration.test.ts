// Integration tests for ./accountFacts.ts, its interaction with
// ./icpEvaluationResolvers.ts's v2 snapshot builder, and
// ./mqlDecisionReadiness.ts's v2 evidence resolver — exercised end-to-end
// against a real, migrated Postgres instance: real db, real triggers/
// constraints (lib/db/drizzle/0007_account_facts_immutability.sql and the
// composite FK/UNIQUE constraints in
// lib/db/drizzle/0006_add_account_facts.sql), real services — no fakes
// anywhere in this file.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed as part of this change (no Postgres instance was started) —
// see the accompanying report for the exact command to run it.
//
// Mirrors the "build our own pool/drizzle instance rather than import
// @workspace/db's singleton" pattern already used throughout this
// package's other *.integration.test.ts files. No truncation or row
// deletion anywhere — isolation comes from crypto.randomUUID()-suffixed
// fixture values, and account_facts/account_snapshots/account_evaluations
// are immutable/insert-only by trigger regardless.
//
// Run with: tsx --test src/services/accountFacts.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { recordAccountFact, StaleFactCorrectionError } from "./accountFacts.js";
import { activateVersion } from "./icpProfiles.js";
import {
  runOfficialIcpEvaluationForAccount,
  runPreviewIcpEvaluationForAccount,
} from "./accountEvaluations.js";
import {
  createCurrentAccountSnapshot,
  resolveCanonicalEvaluatorVersion,
} from "./icpEvaluationResolvers.js";
import { deriveMqlDecisionReadiness } from "./mqlDecisionReadiness.js";
import {
  createAccountDecision,
  EvaluationNotDecisionReadyError,
} from "./accountDecisions.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function assertIsRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${context} must be an object`,
  );
}

function assertIsArray(
  value: unknown,
  context: string,
): asserts value is unknown[] {
  assert.ok(Array.isArray(value), `${context} must be an array`);
}

// Local mirror of ./accountFacts.ts's findPgConstraintErrorInfo — not
// imported (that helper is a private production internal, not exported
// solely to make this test's job easier). drizzle-orm wraps the raw `pg`
// DatabaseError (which carries `code`/`constraint` directly) inside a
// DrizzleQueryError, exposed only via `.cause` — so a plain `err.code`
// read here would miss it, same reason the production code needed the
// same walk. Bounded by a depth limit and identity-based cycle detection
// so a malformed/self-referential cause chain can never loop forever.
const MAX_ERROR_CAUSE_DEPTH = 5;

function findPgErrorCode(err: unknown): string | undefined {
  const visited = new Set<unknown>();
  let current: unknown = err;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    if (visited.has(current)) return undefined;
    visited.add(current);

    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;

    current = candidate.cause;
  }
  return undefined;
}

async function assertRejectsWithPgCode(
  fn: () => Promise<unknown>,
  expectedCode: string,
  context: string,
): Promise<void> {
  try {
    await fn();
    assert.fail(`${context}: expected a rejection, got none`);
  } catch (err) {
    assert.ok(err instanceof Error, `${context}: expected an Error`);
    assert.equal(findPgErrorCode(err), expectedCode, context);
  }
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
      accountKey: `dom:account-facts-integration-${crypto.randomUUID()}.example`,
      ...overrides,
    })
    .returning();
  return account!;
}

async function makeRootFact(
  accountId: string,
  field: string,
  value: string,
) {
  const [fact] = await db!
    .insert(schema.accountFacts)
    .values({
      accountId,
      field,
      value,
      source: "manual-operator-v1",
      recordedBy: "operator@example.test",
    })
    .returning();
  return fact!;
}

function syntheticProfileConfigWithIndustryFitAndIntent() {
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
    intent: {
      rules: [
        {
          id: "intent_distinct_sources",
          description: "At least 2 distinct engagement sources",
          points: 10,
          condition: { op: "gte", field: "engagement.distinctSourceCount", value: 2 },
        },
      ],
      tiers: [{ code: "floor", minScore: 0 }],
    },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

async function makeActiveProfileVersion(config: unknown) {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `account-facts-integration-${crypto.randomUUID()}` })
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

// A fit config referencing both company.industry AND company.region, used
// only by the concurrent-dedup test below (GTM V2 Stage 4, Unit 1), which
// needs two distinct account-fact fields both provably relevant to the
// SAME evaluation.
function syntheticProfileConfigWithIndustryAndRegionFit() {
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
        {
          id: "fit_region_us",
          description: "Region is US",
          points: 5,
          condition: { op: "eq", field: "company.region", value: "us" },
        },
      ],
      tiers: [{ code: "base", minScore: 0 }],
    },
    intent: { rules: [], tiers: [{ code: "floor", minScore: 0 }] },
    actionability: { rules: [] },
    eligibility: { hardDisqualifiers: [], restrictions: [] },
  };
}

// ---------------------------------------------------------------------
// GTM V2 Stage 4, Unit 1 — evaluation staleness signal, exercised through
// the real production call path (recordAccountFact) against a real,
// migrated Postgres instance.
// ---------------------------------------------------------------------

test(
  "recordAccountFact raises an open evaluation_stale attention item for a fit-referenced field, and a second, different triggering field against the same evaluation dedupes to the same open item",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFitAndIntent(),
    );

    const evaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation.status, "completed");
    assert.equal(evaluation.evaluationMode, "production");

    const firstFact = await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });

    const openAfterFirst = await db!
      .select()
      .from(schema.attentionItems)
      .where(
        and(
          eq(schema.attentionItems.accountId, account.id),
          eq(schema.attentionItems.status, "open"),
        ),
      );
    assert.equal(openAfterFirst.length, 1);
    assert.equal(openAfterFirst[0]?.reasonCode, "evaluation_stale");
    assert.equal(openAfterFirst[0]?.source, "evaluation");
    assert.equal(openAfterFirst[0]?.sourceRef, evaluation.id);
    assert.equal(openAfterFirst[0]?.createdBy, "system:evaluation");

    // A correction to a DIFFERENT value on the same referenced field,
    // still targeting the same still-current evaluation — must dedupe to
    // the same open item, never create a second one.
    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Insurance",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: firstFact.id,
      correctionReason: "corrected",
    });

    const openAfterSecond = await db!
      .select()
      .from(schema.attentionItems)
      .where(
        and(
          eq(schema.attentionItems.accountId, account.id),
          eq(schema.attentionItems.status, "open"),
        ),
      );
    assert.equal(
      openAfterSecond.length,
      1,
      "a repeated trigger against the same evaluation must dedupe to one open item",
    );
    assert.equal(openAfterSecond[0]?.id, openAfterFirst[0]?.id);
  },
);

test(
  "recordAccountFact does not raise an attention item for a field the evaluation's fit config never referenced",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFitAndIntent(), // fit only references company.industry
    );
    const evaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation.status, "completed");

    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.country",
      value: "Germany",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });

    const openItems = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.accountId, account.id));
    assert.equal(openItems.length, 0);
  },
);

test(
  "recordAccountFact does not raise an attention item when the account has only a preview evaluation, never a completed production one",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFitAndIntent(),
    );

    const preview = await runPreviewIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(preview.evaluationMode, "preview");

    await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });

    const openItems = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.accountId, account.id));
    assert.equal(openItems.length, 0);
  },
);

test(
  "recordAccountFact does not raise an attention item when the account's only production evaluation failed",
  { skip },
  async () => {
    const account = await makeAccount();
    const { version } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFitAndIntent(),
    );
    const snapshot = await createCurrentAccountSnapshot(db!, account.id);
    const evaluatorVersion = await resolveCanonicalEvaluatorVersion(db!);

    await db!.insert(schema.accountEvaluations).values({
      accountId: account.id,
      snapshotId: snapshot.id,
      profileVersionId: version.id,
      profileConfigSnapshot: version.config,
      evaluatorVersionId: evaluatorVersion.id,
      evaluationMode: "production",
      status: "failed",
      errorDetail: "synthetic failure for test fixture purposes",
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

    const openItems = await db!
      .select()
      .from(schema.attentionItems)
      .where(eq(schema.attentionItems.accountId, account.id));
    assert.equal(openItems.length, 0);
  },
);

test(
  "concurrent recordAccountFact calls for two different referenced fields racing against the same evaluation: exactly one open item exists afterward, and BOTH fact writes commit (the dedup race never poisons either caller's transaction)",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryAndRegionFit(),
    );
    const evaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation.status, "completed");

    const [industryResult, regionResult] = await Promise.all([
      recordAccountFact({
        db: db!,
        accountId: account.id,
        field: "company.industry",
        value: "Banking",
        recordedBy: "operator@example.test",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
      recordAccountFact({
        db: db!,
        accountId: account.id,
        field: "company.region",
        value: "us",
        recordedBy: "operator@example.test",
        expectedCurrentFactId: null,
        correctionReason: null,
      }),
    ]);

    // Both fact writes must have succeeded — the attention-item dedup race
    // must never roll back the fact write itself, in either direction.
    assert.equal(industryResult.field, "company.industry");
    assert.equal(regionResult.field, "company.region");

    const facts = await db!
      .select()
      .from(schema.accountFacts)
      .where(eq(schema.accountFacts.accountId, account.id));
    assert.equal(facts.length, 2, "both concurrent fact writes must have committed");

    const openItems = await db!
      .select()
      .from(schema.attentionItems)
      .where(
        and(
          eq(schema.attentionItems.accountId, account.id),
          eq(schema.attentionItems.status, "open"),
        ),
      );
    assert.equal(
      openItems.length,
      1,
      "the concurrent dedup race must converge to exactly one open item, not two",
    );
    assert.equal(openItems[0]?.sourceRef, evaluation.id);
  },
);

// ---------------------------------------------------------------------
// account_facts immutability
// ---------------------------------------------------------------------

test("account_facts rejects UPDATE (insert-only)", { skip }, async () => {
  const account = await makeAccount();
  const fact = await makeRootFact(account.id, "company.industry", "Banking");

  await assert.rejects(() =>
    db!
      .update(schema.accountFacts)
      .set({ value: "Insurance" })
      .where(eq(schema.accountFacts.id, fact.id)),
  );
});

test("account_facts rejects DELETE (insert-only)", { skip }, async () => {
  const account = await makeAccount();
  const fact = await makeRootFact(account.id, "company.industry", "Banking");

  await assert.rejects(() =>
    db!.delete(schema.accountFacts).where(eq(schema.accountFacts.id, fact.id)),
  );
});

// ---------------------------------------------------------------------
// Composite FK / UNIQUE integrity
// ---------------------------------------------------------------------

test("rejects a second root assertion for the same (account, field)", { skip }, async () => {
  const account = await makeAccount();
  await makeRootFact(account.id, "company.industry", "Banking");

  await assertRejectsWithPgCode(
    () => makeRootFact(account.id, "company.industry", "Insurance"),
    "23505",
    "second root assertion",
  );
});

test("rejects supersedes_fact_id referencing a fact belonging to a different field (composite self-FK)", { skip }, async () => {
  const account = await makeAccount();
  const industryFact = await makeRootFact(account.id, "company.industry", "Banking");

  await assert.rejects(() =>
    db!.insert(schema.accountFacts).values({
      accountId: account.id,
      field: "company.country", // different field than industryFact
      value: "Germany",
      source: "manual-operator-v1",
      recordedBy: "operator@example.test",
      supersedesFactId: industryFact.id,
      correctionReason: "should be rejected by the composite FK",
    }),
  );
});

test("rejects two competing corrections of the same predecessor (UNIQUE(supersedes_fact_id))", { skip }, async () => {
  const account = await makeAccount();
  const root = await makeRootFact(account.id, "company.industry", "Banking");

  await db!.insert(schema.accountFacts).values({
    accountId: account.id,
    field: "company.industry",
    value: "Insurance",
    source: "manual-operator-v1",
    recordedBy: "operator@example.test",
    supersedesFactId: root.id,
    correctionReason: "first correction",
  });

  await assertRejectsWithPgCode(
    () =>
      db!.insert(schema.accountFacts).values({
        accountId: account.id,
        field: "company.industry",
        value: "Healthcare",
        source: "manual-operator-v1",
        recordedBy: "operator@example.test",
        supersedesFactId: root.id, // same predecessor, second time
        correctionReason: "second, competing correction",
      }),
    "23505",
    "competing correction",
  );
});

test("account_fact_current rejects a fact_id belonging to a different account/field (composite FK)", { skip }, async () => {
  const account = await makeAccount();
  const otherAccount = await makeAccount();
  const fact = await makeRootFact(otherAccount.id, "company.industry", "Banking");

  await assert.rejects(() =>
    db!.insert(schema.accountFactCurrent).values({
      accountId: account.id, // different account than fact.accountId
      field: "company.industry",
      factId: fact.id,
    }),
  );
});

// ---------------------------------------------------------------------
// Narrow value CHECK constraints
// ---------------------------------------------------------------------

test("rejects a correction_reason present without supersedes_fact_id", { skip }, async () => {
  const account = await makeAccount();
  await assert.rejects(() =>
    db!.insert(schema.accountFacts).values({
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      source: "manual-operator-v1",
      recordedBy: "operator@example.test",
      correctionReason: "should be rejected — no supersedesFactId",
    }),
  );
});

test("rejects a correction (supersedes_fact_id set) with a blank correction_reason", { skip }, async () => {
  const account = await makeAccount();
  const root = await makeRootFact(account.id, "company.industry", "Banking");

  await assert.rejects(() =>
    db!.insert(schema.accountFacts).values({
      accountId: account.id,
      field: "company.industry",
      value: "Insurance",
      source: "manual-operator-v1",
      recordedBy: "operator@example.test",
      supersedesFactId: root.id,
      correctionReason: "   ",
    }),
  );
});

test("rejects a value longer than the evaluator's NonBlankString maximum (500)", { skip }, async () => {
  const account = await makeAccount();
  await assert.rejects(() =>
    db!.insert(schema.accountFacts).values({
      accountId: account.id,
      field: "company.industry",
      value: "x".repeat(501),
      source: "manual-operator-v1",
      recordedBy: "operator@example.test",
    }),
  );
});

test("rejects an out-of-vocabulary company.region value at the database layer, bypassing application validation", { skip }, async () => {
  const account = await makeAccount();
  await assert.rejects(() =>
    db!.insert(schema.accountFacts).values({
      accountId: account.id,
      field: "company.region",
      value: "apac", // application layer would already reject this; DB CHECK is the backstop
      source: "manual-operator-v1",
      recordedBy: "operator@example.test",
    }),
  );
});

// ---------------------------------------------------------------------
// recordAccountFact — real concurrency race
// ---------------------------------------------------------------------

test("two concurrent corrections of the same current fact: exactly one succeeds, the other gets StaleFactCorrectionError, and no orphan row is left behind", { skip }, async () => {
  const account = await makeAccount();
  const root = await recordAccountFact({
    db: db!,
    accountId: account.id,
    field: "company.industry",
    value: "Banking",
    recordedBy: "operator@example.test",
    expectedCurrentFactId: null,
    correctionReason: null,
  });

  const attempt = () =>
    recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Insurance",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: root.id,
      correctionReason: "racing correction",
    });

  const results = await Promise.allSettled([attempt(), attempt()]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one correction should win");
  assert.equal(rejected.length, 1, "exactly one correction should lose");
  assert.ok(
    (rejected[0] as PromiseRejectedResult).reason instanceof StaleFactCorrectionError,
  );

  const allRows = await db!
    .select()
    .from(schema.accountFacts)
    .where(eq(schema.accountFacts.accountId, account.id));
  // The root assertion + exactly the ONE winning correction — the
  // loser's transaction must have rolled back completely, leaving no
  // orphan row.
  assert.equal(allRows.length, 2);
});

// ---------------------------------------------------------------------
// Full acceptance flow: operator confirms company.industry -> resolves
// the fit condition in a new v2 snapshot -> intent remains unresolved ->
// MQL stays blocked.
// ---------------------------------------------------------------------

test(
  "acceptance: confirming company.industry resolves the fit condition via frozen v2 evidence; intent stays unresolved; Promote to MQL remains blocked",
  { skip },
  async () => {
    const account = await makeAccount({
      companyName: "Acme Bank",
      companyDomain: "acme-bank.example",
    });
    const { profile } = await makeActiveProfileVersion(
      syntheticProfileConfigWithIndustryFitAndIntent(),
    );

    // Before: no facts recorded yet.
    const before = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(before.status, "completed");

    const [beforeSnapshot] = await db!
      .select()
      .from(schema.accountSnapshots)
      .where(eq(schema.accountSnapshots.id, before.snapshotId))
      .limit(1);
    assert.equal(beforeSnapshot!.source, "gtm-account-current-state-v2");

    const beforeReadiness = deriveMqlDecisionReadiness(before, beforeSnapshot!);
    assert.equal(beforeReadiness.ready, false);
    assert.ok(
      beforeReadiness.reasons.some(
        (r) => r.code === "required_condition_unresolved" && r.dimension === "fit",
      ),
      "company.industry fit condition should be unresolved before any fact is confirmed",
    );

    // Operator confirms company.industry = Banking.
    const fact = await recordAccountFact({
      db: db!,
      accountId: account.id,
      field: "company.industry",
      value: "Banking",
      recordedBy: "operator@example.test",
      expectedCurrentFactId: null,
      correctionReason: null,
    });
    assert.equal(fact.value, "Banking");
    assert.equal(fact.recordedBy, "operator@example.test");
    assert.ok(fact.observedAt instanceof Date);
    assert.ok(fact.recordedAt instanceof Date);

    // New official evaluation: the snapshot must freeze the exact fact id
    // and provenance.
    const after = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    const [afterSnapshot] = await db!
      .select()
      .from(schema.accountSnapshots)
      .where(eq(schema.accountSnapshots.id, after.snapshotId))
      .limit(1);
    assert.equal(afterSnapshot!.source, "gtm-account-current-state-v2");

    assertIsRecord(afterSnapshot!.rawInput, "afterSnapshot.rawInput");
    const rawInput = afterSnapshot!.rawInput as Record<string, unknown>;
    assertIsArray(rawInput.evidence, "rawInput.evidence");
    assert.equal(rawInput.evidence.length, 1);
    assertIsRecord(rawInput.evidence[0], "rawInput.evidence[0]");
    assert.equal(rawInput.evidence[0]!.accountFactId, fact.id);
    assert.equal(rawInput.evidence[0]!.field, "company.industry");
    assert.equal(rawInput.evidence[0]!.value, "Banking");

    const afterReadiness = deriveMqlDecisionReadiness(after, afterSnapshot!);
    // The industry fit condition is now resolved from evidence.
    assert.ok(
      !afterReadiness.reasons.some(
        (r) => r.code === "required_condition_unresolved" && r.dimension === "fit",
      ),
      "company.industry fit condition should now be resolved",
    );
    // Unrelated fallback fields (e.g. company.employeeRange, never
    // confirmed) must never be marked evidence-backed.
    assertIsRecord(afterSnapshot!.normalizedInput, "afterSnapshot.normalizedInput");
    const normalizedInput = afterSnapshot!.normalizedInput as Record<string, unknown>;
    assertIsRecord(normalizedInput.company, "normalizedInput.company");
    assert.equal((normalizedInput.company as Record<string, unknown>).employeeRange, null);
    // Intent remains unresolved — manual company facts never touch it.
    assert.ok(
      afterReadiness.reasons.some(
        (r) => r.code === "required_condition_unresolved" && r.dimension === "intent",
      ),
      "the intent condition (engagement.distinctSourceCount) must remain unresolved",
    );
    assert.equal(afterReadiness.ready, false);

    // Promote to MQL remains blocked at the backend enforcement layer.
    await assert.rejects(
      () =>
        createAccountDecision({
          db: db!,
          idempotencyKey: crypto.randomUUID(),
          accountEvaluationId: after.id,
          routingOutput: "mql",
          createdBy: "operator@example.test",
        }),
      EvaluationNotDecisionReadyError,
    );
  },
);
