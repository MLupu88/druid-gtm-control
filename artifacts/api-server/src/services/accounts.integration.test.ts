// Integration tests for ./accounts.ts's GTM V2 Stage 4, Unit 1 staleness
// read model — listAccounts' latestProductionEvaluation.staleness and
// getAccountById's latestProductionEvaluationStaleness — exercised
// against a real, migrated Postgres instance: real db, real
// account_evaluations/attention_items rows, no fakes. Complements
// ./accounts.test.ts's fake-queue-based unit coverage of the query
// WIRING (shape, batching, empty-input short-circuit) with real SQL
// filtering semantics a fake db cannot prove: that the staleness lookup
// genuinely scopes to the latest production evaluation's own id, never an
// older one's, and genuinely observes a resolution.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed against a real Postgres instance as part of this change (no
// database connection was made).
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/accounts.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import { listAccounts, getAccountById } from "./accounts.js";
import { createAttentionItem, resolveAttentionItem } from "./attentionItems.js";
import {
  runOfficialIcpEvaluationForAccount,
  runPreviewIcpEvaluationForAccount,
} from "./accountEvaluations.js";
import { activateVersion } from "./icpProfiles.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeAccount() {
  const [account] = await db!
    .insert(schema.accounts)
    .values({ accountKey: `dom:accounts-staleness-integration-${crypto.randomUUID()}.example` })
    .returning();
  return account!;
}

function syntheticProfileConfig() {
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

async function makeActiveProfileVersion(config: unknown = syntheticProfileConfig()) {
  const [profile] = await db!
    .insert(schema.icpProfiles)
    .values({ name: `accounts-staleness-integration-${crypto.randomUUID()}` })
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

async function raiseOpenStaleItem(accountId: string, evaluationId: string) {
  const result = await createAttentionItem({
    db: db!,
    accountId,
    reasonCode: "evaluation_stale",
    source: "evaluation",
    sourceRef: evaluationId,
    reasonDetail: "test fixture",
    context: { trigger: "account_fact_changed", evaluationId },
    createdBy: "system:evaluation",
  });
  assert.equal(result.outcome, "created");
  return result.outcome === "created" ? result.item : undefined;
}

// ---------------------------------------------------------------------
// listAccounts
// ---------------------------------------------------------------------

test(
  "listAccounts: an account with no completed production evaluation reports latestProductionEvaluation: null",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion();
    const preview = await runPreviewIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(preview.evaluationMode, "preview");

    const result = await listAccounts({ db: db!, limit: 50, offset: 0, needsAttention: false });
    const item = result.items.find((i) => i.account.id === account.id);
    assert.equal(item?.latestProductionEvaluation, null);
  },
);

test(
  "listAccounts: a completed production evaluation with no open stale item reports staleness: { stale: false, openAttentionItemId: null }",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion();
    const evaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.equal(evaluation.status, "completed");

    const result = await listAccounts({ db: db!, limit: 50, offset: 0, needsAttention: false });
    const item = result.items.find((i) => i.account.id === account.id);
    assert.deepEqual(item?.latestProductionEvaluation?.staleness, {
      stale: false,
      openAttentionItemId: null,
    });
  },
);

test(
  "listAccounts: an open evaluation_stale item matching the latest production evaluation's id reports staleness: { stale: true, openAttentionItemId }",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion();
    const evaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    const item = await raiseOpenStaleItem(account.id, evaluation.id);

    const result = await listAccounts({ db: db!, limit: 50, offset: 0, needsAttention: false });
    const listItem = result.items.find((i) => i.account.id === account.id);
    assert.deepEqual(listItem?.latestProductionEvaluation?.staleness, {
      stale: true,
      openAttentionItemId: item!.id,
    });
  },
);

test(
  "listAccounts: an open stale item for an OLDER completed production evaluation does not mark the newer, current one stale",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion();

    const older = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    await raiseOpenStaleItem(account.id, older.id);

    // Real clock separation so createdAt strictly orders the two rows —
    // matches the same convention already used elsewhere in this package
    // (see ../routes/attentionItems.integration.test.ts's resolve-replay
    // test) for guaranteeing deterministic "newest" ordering.
    await sleep(20);

    const newer = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    assert.notEqual(newer.id, older.id);

    const result = await listAccounts({ db: db!, limit: 50, offset: 0, needsAttention: false });
    const item = result.items.find((i) => i.account.id === account.id);
    assert.equal(item?.latestProductionEvaluation?.id, newer.id);
    assert.deepEqual(item?.latestProductionEvaluation?.staleness, {
      stale: false,
      openAttentionItemId: null,
    });
  },
);

test(
  "listAccounts: a resolved stale item no longer marks the evaluation stale",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion();
    const evaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    const item = await raiseOpenStaleItem(account.id, evaluation.id);

    const beforeResolve = await listAccounts({ db: db!, limit: 50, offset: 0, needsAttention: false });
    assert.equal(
      beforeResolve.items.find((i) => i.account.id === account.id)?.latestProductionEvaluation
        ?.staleness.stale,
      true,
    );

    const resolved = await resolveAttentionItem({
      db: db!,
      attentionItemId: item!.id,
      resolvedBy: "operator@example.test",
      resolutionReason: "reevaluated",
    });
    assert.equal(resolved.kind, "resolved");

    const afterResolve = await listAccounts({ db: db!, limit: 50, offset: 0, needsAttention: false });
    const afterItem = afterResolve.items.find((i) => i.account.id === account.id);
    assert.deepEqual(afterItem?.latestProductionEvaluation?.staleness, {
      stale: false,
      openAttentionItemId: null,
    });
  },
);

test(
  "listAccounts: staleness state across multiple accounts on the same page is independently correct and deterministic under pagination",
  { skip },
  async () => {
    const staleAccount = await makeAccount();
    const freshAccount = await makeAccount();
    const noEvalAccount = await makeAccount();
    const { profile } = await makeActiveProfileVersion();

    const staleEvaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: staleAccount.id,
      profileId: profile.id,
    });
    await raiseOpenStaleItem(staleAccount.id, staleEvaluation.id);

    await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: freshAccount.id,
      profileId: profile.id,
    });

    // noEvalAccount deliberately has no evaluation at all.

    const result = await listAccounts({ db: db!, limit: 500, offset: 0, needsAttention: false });
    const items = new Map(result.items.map((i) => [i.account.id, i]));

    assert.equal(items.get(staleAccount.id)?.latestProductionEvaluation?.staleness.stale, true);
    assert.equal(items.get(freshAccount.id)?.latestProductionEvaluation?.staleness.stale, false);
    assert.equal(items.get(noEvalAccount.id)?.latestProductionEvaluation, null);
  },
);

// ---------------------------------------------------------------------
// getAccountById
// ---------------------------------------------------------------------

test(
  "getAccountById: no completed production evaluation -> latestProductionEvaluationStaleness: null",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion();
    await runPreviewIcpEvaluationForAccount({ db: db!, accountId: account.id, profileId: profile.id });

    const detail = await getAccountById(db!, account.id);
    assert.equal(detail?.latestProductionEvaluationStaleness, null);
  },
);

test(
  "getAccountById: reports the latest production evaluation's staleness without decorating historical rows",
  { skip },
  async () => {
    const account = await makeAccount();
    const { profile } = await makeActiveProfileVersion();
    const evaluation = await runOfficialIcpEvaluationForAccount({
      db: db!,
      accountId: account.id,
      profileId: profile.id,
    });
    const item = await raiseOpenStaleItem(account.id, evaluation.id);

    const detail = await getAccountById(db!, account.id);
    assert.deepEqual(detail?.latestProductionEvaluationStaleness, {
      stale: true,
      openAttentionItemId: item!.id,
    });
    // The per-evaluation rows themselves carry no staleness field at all —
    // never rewritten with a per-row signal (see the module comment on
    // ../services/accounts.ts's AccountEvaluationStaleness).
    for (const evaluationRow of detail!.evaluations) {
      assert.equal("staleness" in evaluationRow, false);
    }
  },
);

test.after(async () => {
  await pool?.end();
});
