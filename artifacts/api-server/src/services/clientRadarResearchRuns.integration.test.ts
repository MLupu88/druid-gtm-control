// Integration tests for ./clientRadarResearchRuns.ts's
// persistCompletedClientRadarResult — specifically the guarantee a fake
// queue db (see ./clientRadarResearchRuns.test.ts) cannot prove: that its
// single db.transaction() is a REAL Postgres transaction, so a failure
// occurring after the research-run UPDATE has already executed still
// rolls that UPDATE back, and the Client Radar account-id alias never
// commits partially.
//
// Failure injection: linkClientRadarAccountAlias's own blank-
// clientRadarAccountId guard (see ./clientRadarAccountAlias.ts) is used
// to force the "unexpected error" branch, deliberately NOT a raw Postgres
// constraint violation. Every value linkClientRadarAccountAlias's INSERT
// actually writes is either fixed by the function itself (aliasType,
// normalizationStrategy, isStrong, source) or read live from the
// database (accountId, which is always a valid existing account by
// construction — client_radar_research_runs.accountId is itself FK-
// enforced with onDelete: cascade, so there is no way to leave a
// dangling reference without also deleting the research run row this
// test needs to observe). The unique-index conflict path is handled
// gracefully by design (never throws) — that leaves the blank-input
// guard as the only reachable, deterministic "genuine unexpected error"
// this call path can produce without a test-only hook or a production
// code change. persistCompletedClientRadarResult's own doc comment
// already classifies this exact guard as the same class of failure as a
// real programming/DB error — both simply propagate out of the
// db.transaction() callback and roll back identically.
//
// Requires DATABASE_URL to point at a Postgres instance with migrations
// already applied (`pnpm --filter @workspace/db run migrate`). SKIPS
// itself (does not fail) when DATABASE_URL is unset. This file was NOT
// executed against a real Postgres instance as part of this change (no
// database connection was made).
//
// Run with: DATABASE_URL=postgres://... tsx --test src/services/clientRadarResearchRuns.integration.test.ts

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";
import type { ClientRadarResultAccount } from "../lib/clientRadarClient.js";
import { persistCompletedClientRadarResult } from "./clientRadarResearchRuns.js";

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const { Pool } = pg;
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

async function makeAccount(): Promise<string> {
  const [account] = await db!
    .insert(schema.accounts)
    .values({
      accountKey: `dom:client-radar-research-runs-integration-${crypto.randomUUID()}.example`,
    })
    .returning();
  return account!.id;
}

async function makeRunningResearchRun(accountId: string): Promise<string> {
  const [run] = await db!
    .insert(schema.clientRadarResearchRunsTable)
    .values({
      accountId,
      clientRadarRunId: `cr_run_${crypto.randomUUID()}`,
      status: "running",
    })
    .returning();
  return run!.id;
}

async function loadResearchRun(researchRunId: string) {
  const [row] = await db!
    .select()
    .from(schema.clientRadarResearchRunsTable)
    .where(eq(schema.clientRadarResearchRunsTable.id, researchRunId))
    .limit(1);
  return row;
}

async function loadStrongAliasesFor(accountId: string, clientRadarAccountId: string) {
  return db!
    .select()
    .from(schema.accountAliases)
    .where(
      and(
        eq(schema.accountAliases.accountId, accountId),
        eq(schema.accountAliases.aliasType, "client_radar_account_id"),
        eq(schema.accountAliases.normalizedValue, clientRadarAccountId),
        eq(schema.accountAliases.isStrong, true),
      ),
    );
}

function completedResult(overrides: Partial<ClientRadarResultAccount> = {}): ClientRadarResultAccount {
  return {
    company: "Integration Test Co",
    domain: "integration-test.example",
    country: "US",
    industry: "Software",
    account: { id: crypto.randomUUID(), account_key: "integration-test-co" },
    clientRadarAccountId: crypto.randomUUID(),
    evidence: {
      items: [{ id: "ev_1", source_type: "web", title: "Test evidence", url: null, content: null, created_at: new Date().toISOString() }],
      total: 1,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 1. Successful completed-result persistence.
// ---------------------------------------------------------------------

test(
  "completed result: run status/payload update AND the Client Radar account alias both commit, both belonging to the intended account",
  { skip },
  async () => {
    const accountId = await makeAccount();
    const researchRunId = await makeRunningResearchRun(accountId);
    const clientRadarAccountId = crypto.randomUUID();
    const result = completedResult({
      clientRadarAccountId,
      account: { id: clientRadarAccountId, account_key: "acme-integration" },
    });

    const returned = await persistCompletedClientRadarResult(db!, researchRunId, new Date(), result);

    assert.equal(returned.status, "completed");
    assert.equal(returned.accountId, accountId);
    assert.deepEqual(returned.accountPayload, result.account);
    assert.deepEqual(returned.evidencePayload, result.evidence.items);

    // Re-read independently — the returned row alone doesn't prove the
    // UPDATE actually committed.
    const persistedRun = await loadResearchRun(researchRunId);
    assert.equal(persistedRun?.status, "completed");
    assert.equal(persistedRun?.accountId, accountId);
    assert.deepEqual(persistedRun?.accountPayload, result.account);

    const aliases = await loadStrongAliasesFor(accountId, clientRadarAccountId);
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0]?.accountId, accountId);
    assert.equal(aliases[0]?.source, "client_radar");
  },
);

// ---------------------------------------------------------------------
// 2. Unexpected alias-link failure rolls back the whole local completion
//    transaction — the run UPDATE, though already executed inside the
//    transaction, must not be visible afterward.
// ---------------------------------------------------------------------

test(
  "an unexpected alias-link failure rolls back the run's status/payload update and commits no alias row",
  { skip },
  async () => {
    const accountId = await makeAccount();
    const researchRunId = await makeRunningResearchRun(accountId);
    const beforeRun = await loadResearchRun(researchRunId);
    assert.equal(beforeRun?.status, "running");
    assert.equal(beforeRun?.accountPayload, null);

    // clientRadarAccountId: "   " passes clientRadarClient.ts's own
    // (bypassed here — this calls persistCompletedClientRadarResult
    // directly, not through HTTP parsing) UUID validation is irrelevant;
    // what matters is that linkClientRadarAccountAlias's own blank guard
    // throws AFTER the run UPDATE (executed first, inside the same
    // transaction) and BEFORE any COMMIT.
    const distinctiveAccountPayload = { id: "should-never-be-visible", marker: crypto.randomUUID() };
    const result = completedResult({
      clientRadarAccountId: "   ",
      account: distinctiveAccountPayload,
    });

    await assert.rejects(
      () => persistCompletedClientRadarResult(db!, researchRunId, new Date(), result),
      /clientRadarAccountId must not be blank/,
    );

    const afterRun = await loadResearchRun(researchRunId);
    // The run UPDATE that ran first inside the transaction must be fully
    // rolled back — status and payload exactly as they were before this
    // call, not left in some intermediate "completed with no payload"
    // state and not carrying the distinctive marker.
    assert.equal(afterRun?.status, "running");
    assert.equal(afterRun?.accountPayload, null);
    assert.equal(afterRun?.evidencePayload, null);
    assert.equal(afterRun?.completedAt, null);
    assert.notDeepEqual(afterRun?.accountPayload, distinctiveAccountPayload);

    // No alias row of any kind exists for this account — the failed
    // insert attempt inside the rolled-back transaction left nothing
    // behind (this also incidentally proves the blank value never made
    // it into a persisted normalizedValue: the guard threw before any
    // SQL for it was ever issued).
    const [anyAlias] = await db!
      .select()
      .from(schema.accountAliases)
      .where(eq(schema.accountAliases.accountId, accountId))
      .limit(1);
    assert.equal(anyAlias, undefined);
  },
);
