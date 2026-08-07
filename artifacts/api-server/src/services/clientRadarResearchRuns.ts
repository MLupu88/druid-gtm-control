// Application service for Client Radar research runs — starts a research
// request for a canonical account, polls its status, and persists the
// completed result. Deliberately contains no HTTP-specific logic of its
// own (no req/res, no status codes, no header/body parsing); every
// outbound call to Client Radar goes through ../lib/clientRadarClient,
// which owns all HTTP concerns (auth header, timeout, JSON parsing,
// response validation). See ../routes (not yet built) for the HTTP
// boundary that will wrap this.
//
// Only imports from @workspace/db/schema, never @workspace/db itself —
// the database instance is always received via explicit injection,
// mirroring ../services/accounts.ts and ../services/accountDecisions.ts.
//
// Each client_radar_research_runs row is one complete research attempt —
// there is no separate event-log table (see
// lib/db/src/schema/clientRadarResearchRuns.ts). Status transitions
// happen in place on the same row, from "submitting" through to a
// terminal "completed"/"failed"/"cancelled" outcome.

import { and, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accounts,
  clientRadarResearchRunsTable,
  type ClientRadarResearchRun,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  submitClientRadarResearch,
  getClientRadarResearchStatus,
  getClientRadarResearchResult,
  type ClientRadarResultAccount,
} from "../lib/clientRadarClient";
import { linkClientRadarAccountAlias } from "./clientRadarAccountAlias";
import { createAttentionItem } from "./attentionItems";

type Db = NodePgDatabase<typeof schema>;
// Extracts the exact transaction-handle type db.transaction()'s callback
// receives — same convention as ../services/attentionItems.ts's and
// ../services/clientRadarAccountAlias.ts's own Tx alias.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type ResearchRunStatus = ClientRadarResearchRun["status"];

// Mirrors the partial unique index's WHERE predicate
// (client_radar_research_runs_one_active_per_account) — kept in sync by
// hand since the index predicate isn't introspectable from here.
const ACTIVE_STATUSES: ResearchRunStatus[] = ["submitting", "queued", "running"];
const TERMINAL_STATUSES: ResearchRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class AccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super(`account with id "${accountId}" does not exist.`);
    this.name = "AccountNotFoundError";
  }
}

export class AccountResearchInputError extends Error {
  constructor(public readonly accountId: string) {
    super(
      `account "${accountId}" has neither a usable companyName nor companyDomain to submit for Client Radar research.`,
    );
    this.name = "AccountResearchInputError";
  }
}

export class ActiveResearchRunExistsError extends Error {
  constructor(
    public readonly accountId: string,
    public readonly existingRun: ClientRadarResearchRun,
  ) {
    super(
      `account "${accountId}" already has an active Client Radar research run (id="${existingRun.id}", status="${existingRun.status}").`,
    );
    this.name = "ActiveResearchRunExistsError";
  }
}

export class ResearchRunNotFoundError extends Error {
  constructor(public readonly researchRunId: string) {
    super(
      `client_radar_research_runs row with id "${researchRunId}" does not exist.`,
    );
    this.name = "ResearchRunNotFoundError";
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function presentString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed !== "" ? trimmed : undefined;
}

async function loadResearchRunById(
  db: Db,
  researchRunId: string,
): Promise<ClientRadarResearchRun | undefined> {
  const [row] = await db
    .select()
    .from(clientRadarResearchRunsTable)
    .where(eq(clientRadarResearchRunsTable.id, researchRunId))
    .limit(1);
  return row;
}

async function loadLatestActiveRun(
  db: Db,
  accountId: string,
): Promise<ClientRadarResearchRun | undefined> {
  const [row] = await db
    .select()
    .from(clientRadarResearchRunsTable)
    .where(
      and(
        eq(clientRadarResearchRunsTable.accountId, accountId),
        inArray(clientRadarResearchRunsTable.status, ACTIVE_STATUSES),
      ),
    )
    .orderBy(
      desc(clientRadarResearchRunsTable.createdAt),
      desc(clientRadarResearchRunsTable.id),
    )
    .limit(1);
  return row;
}

// ---------------------------------------------------------------------
// Start — creates the local "submitting" row and dispatches to Client
// Radar. The outbound HTTP call is never wrapped in a database
// transaction: it's a non-rollback-able side effect, so it must run after
// the local row is durably committed, not inside a transaction that could
// still roll back afterward (mirrors start-scan.ts's n8n dispatch, the
// closest existing precedent for this exact shape).
// ---------------------------------------------------------------------

export interface StartClientRadarResearchArgs {
  db: Db;
  accountId: string;
}

/**
 * Loads the canonical account, resolves a company value to submit
 * (trimmed companyName, falling back to trimmed companyDomain), and
 * race-safely inserts a new "submitting" row via a plain
 * onConflictDoNothing() insert — the partial unique index
 * (client_radar_research_runs_one_active_per_account) is the actual
 * arbiter; an app-level pre-check here would leave a TOCTOU gap under
 * concurrent calls, so the insert itself is the only safe guard.
 */
export async function startClientRadarResearch(
  args: StartClientRadarResearchArgs,
): Promise<ClientRadarResearchRun> {
  const { db, accountId } = args;

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  const company =
    presentString(account.companyName) ?? presentString(account.companyDomain);
  if (!company) {
    throw new AccountResearchInputError(accountId);
  }
  const domain = presentString(account.companyDomain);

  const [inserted] = await db
    .insert(clientRadarResearchRunsTable)
    .values({ accountId })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    const existing = await loadLatestActiveRun(db, accountId);
    if (!existing) {
      throw new Error(
        `startClientRadarResearch: insert conflicted for account "${accountId}" but no active row was found.`,
      );
    }
    throw new ActiveResearchRunExistsError(accountId, existing);
  }

  return submitAndPersist(db, inserted, { company, domain });
}

async function submitAndPersist(
  db: Db,
  run: ClientRadarResearchRun,
  input: { company: string; domain: string | undefined },
): Promise<ClientRadarResearchRun> {
  let response: Awaited<ReturnType<typeof submitClientRadarResearch>>;
  try {
    response = await submitClientRadarResearch({
      company: input.company,
      domain: input.domain,
    });
  } catch (err) {
    // Never persists credentials/headers/env values — err.message comes
    // from ClientRadarApiError (already scrubbed) or a plain Error.
    const message =
      err instanceof Error
        ? err.message
        : "Failed to submit research request to Client Radar.";
    const now = new Date();
    const [failedRun] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        status: "failed",
        failedAt: now,
        lastError: message,
        updatedAt: now,
      })
      .where(eq(clientRadarResearchRunsTable.id, run.id))
      .returning();
    return failedRun;
  }

  const now = new Date();

  if (response.status === "queued" || response.status === "running") {
    const [updated] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        clientRadarRunId: response.run_id,
        status: response.status,
        submittedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(clientRadarResearchRunsTable.id, run.id))
      .returning();
    return updated;
  }

  if (response.status === "failed" || response.status === "cancelled") {
    const [updated] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        clientRadarRunId: response.run_id,
        status: response.status,
        submittedAt: now,
        ...(response.status === "failed" ? { failedAt: now } : {}),
        lastError: response.message ?? null,
        updatedAt: now,
      })
      .where(eq(clientRadarResearchRunsTable.id, run.id))
      .returning();
    return updated;
  }

  // response.status === "completed" — unexpected this early (submission
  // just started the run), but handled safely rather than assumed
  // impossible: persist the transition, then reuse the same result-sync
  // path a later poll would have taken.
  const [updated] = await db
    .update(clientRadarResearchRunsTable)
    .set({
      clientRadarRunId: response.run_id,
      status: "completed",
      submittedAt: now,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(clientRadarResearchRunsTable.id, run.id))
    .returning();

  return syncClientRadarResearchResult(db, updated.id);
}

// ---------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------

export async function getLatestClientRadarResearchRun(
  db: Db,
  accountId: string,
): Promise<ClientRadarResearchRun | undefined> {
  const [row] = await db
    .select()
    .from(clientRadarResearchRunsTable)
    .where(eq(clientRadarResearchRunsTable.accountId, accountId))
    .orderBy(
      desc(clientRadarResearchRunsTable.createdAt),
      desc(clientRadarResearchRunsTable.id),
    )
    .limit(1);
  return row;
}

// ---------------------------------------------------------------------
// Refresh — polls the Client Radar status endpoint for a non-terminal
// run. Terminal rows (completed/failed/cancelled) and rows still
// "submitting" (no remote run id has been assigned yet) are no-ops.
// ---------------------------------------------------------------------

/**
 * Polls Client Radar's status endpoint for a local row and persists the
 * result. Cancelled has no dedicated terminal timestamp column (unlike
 * completed/failed) — updatedAt, which every branch below sets, is the
 * only recorded terminal time for it.
 */
export async function refreshClientRadarResearchRun(
  db: Db,
  researchRunId: string,
): Promise<ClientRadarResearchRun> {
  const run = await loadResearchRunById(db, researchRunId);
  if (!run) {
    throw new ResearchRunNotFoundError(researchRunId);
  }

  if (TERMINAL_STATUSES.includes(run.status)) {
    return run;
  }

  if (run.status === "submitting") {
    return run;
  }

  if (!run.clientRadarRunId) {
    const now = new Date();
    const [failedRun] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        status: "failed",
        failedAt: now,
        lastError:
          "Research run is no longer submitting but has no Client Radar run id — cannot poll status.",
        updatedAt: now,
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();
    return failedRun;
  }

  let response: Awaited<ReturnType<typeof getClientRadarResearchStatus>>;
  try {
    response = await getClientRadarResearchStatus(run.clientRadarRunId);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to poll Client Radar research status.";
    const now = new Date();
    const [updated] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        lastPolledAt: now,
        updatedAt: now,
        lastError: message,
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();
    return updated;
  }

  const now = new Date();

  if (response.status === "queued" || response.status === "running") {
    const [updated] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        status: response.status,
        lastPolledAt: now,
        updatedAt: now,
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();
    return updated;
  }

  if (response.status === "failed") {
    const lastError =
      response.message ??
      response.data.error_code ??
      "Client Radar research run failed.";
    const [updated] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        status: "failed",
        failedAt: now,
        lastPolledAt: now,
        updatedAt: now,
        lastError,
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();
    return updated;
  }

  if (response.status === "cancelled") {
    const [updated] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        status: "cancelled",
        lastPolledAt: now,
        updatedAt: now,
        ...(response.message ? { lastError: response.message } : {}),
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();
    return updated;
  }

  // response.status === "completed"
  const [updated] = await db
    .update(clientRadarResearchRunsTable)
    .set({
      status: "completed",
      completedAt: now,
      lastPolledAt: now,
      updatedAt: now,
    })
    .where(eq(clientRadarResearchRunsTable.id, researchRunId))
    .returning();

  return syncClientRadarResearchResult(db, updated.id);
}

// ---------------------------------------------------------------------
// Result sync — fetches and persists the account/evidence payload for a
// completed run. Independently exported (not just an internal helper of
// refresh) so a caller can (re)fetch/backfill the payload for an
// already-completed row without going through the status endpoint again.
// ---------------------------------------------------------------------

const CLIENT_RADAR_IDENTITY_CONFLICT_REASON_CODE = "client_radar_identity_conflict";

/**
 * Raises (or replays into) an open client_radar_identity_conflict
 * attention item when linkClientRadarAccountAlias reports that Client
 * Radar's account.id is already strongly aliased to a DIFFERENT GTM
 * account. sourceRef is the Client Radar account id (not this research
 * run's id), so repeated syncs — of this run or any later run for the
 * same GTM account that resolves to the same conflicting Client Radar
 * account — dedupe onto the same open item rather than raising a new one
 * each time (see ../services/attentionItems.ts's createAttentionItem,
 * whose own dedup key is exactly (accountId, reasonCode, source,
 * sourceRef)). context deliberately carries only small, stable
 * identifiers an operator needs to investigate — never the raw research
 * payload. Always called with the SAME open transaction the run's
 * completion update ran in, relying on createAttentionItem's
 * nested-transaction/savepoint support — a genuine (non-dedup) failure
 * here propagates out and rolls back the completion write too.
 */
async function raiseClientRadarIdentityConflictAttention(
  tx: Tx,
  accountId: string,
  clientRadarAccountId: string,
  conflictingAccountId: string,
  researchRunId: string,
): Promise<void> {
  await createAttentionItem({
    db: tx,
    accountId,
    reasonCode: CLIENT_RADAR_IDENTITY_CONFLICT_REASON_CODE,
    reasonDetail: null,
    source: "client_radar",
    sourceRef: clientRadarAccountId,
    context: {
      clientRadarAccountId,
      conflictingAccountId,
      researchRunId,
    },
    createdBy: "system:client_radar",
  });
}

/**
 * Assumes exactly one account per run: startClientRadarResearch always
 * submits a single company (companies: [company]), so a completed result
 * is expected to carry exactly one entry in response.accounts. If that
 * invariant is ever violated, this persists a failed row with a safe
 * consistency error rather than silently picking one entry.
 */
export async function syncClientRadarResearchResult(
  db: Db,
  researchRunId: string,
): Promise<ClientRadarResearchRun> {
  const run = await loadResearchRunById(db, researchRunId);
  if (!run) {
    throw new ResearchRunNotFoundError(researchRunId);
  }

  if (!run.clientRadarRunId) {
    const now = new Date();
    const [failedRun] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        status: "failed",
        failedAt: now,
        lastError:
          "Cannot retrieve Client Radar research result without a Client Radar run id.",
        updatedAt: now,
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();
    return failedRun;
  }

  const response = await getClientRadarResearchResult(run.clientRadarRunId);
  const now = new Date();

  if (response.status !== "completed") {
    const [updated] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        status: response.status,
        lastPolledAt: now,
        updatedAt: now,
        ...(response.status === "failed" ? { failedAt: now } : {}),
        ...(response.message ? { lastError: response.message } : {}),
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();
    return updated;
  }

  if (response.accounts.length !== 1) {
    const [failedRun] = await db
      .update(clientRadarResearchRunsTable)
      .set({
        status: "failed",
        failedAt: now,
        lastError: `Client Radar completed result returned ${response.accounts.length} accounts; expected exactly 1.`,
        updatedAt: now,
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();
    return failedRun;
  }

  const [result] = response.accounts;
  return persistCompletedClientRadarResult(db, researchRunId, now, result);
}

/**
 * Local completion work only — the outbound HTTP fetch that produced
 * `result` must already have happened before this is called (mirrors
 * this file's own startClientRadarResearch/submitAndPersist convention:
 * a non-rollback-able side effect must run before, never inside, a
 * transaction that could still roll back afterward). Persists
 * accountPayload/evidencePayload and links the Client Radar account-id
 * alias (or raises its conflict attention item) atomically in one
 * db.transaction() — extracted from ../services/clientRadarResearchRuns.ts's
 * syncClientRadarResearchResult specifically so this local-only logic is
 * directly testable without mocking the HTTP layer (see
 * ./clientRadarResearchRuns.test.ts). An unexpected error from
 * linkClientRadarAccountAlias or createAttentionItem (a real
 * programming/DB error, not the expected conflict outcome) propagates out
 * of this callback and rolls back the payload update too — the run is
 * never left "completed" with a payload but a half-attempted, unrecorded
 * identity link.
 */
export async function persistCompletedClientRadarResult(
  db: Db,
  researchRunId: string,
  now: Date,
  result: ClientRadarResultAccount,
): Promise<ClientRadarResearchRun> {
  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(clientRadarResearchRunsTable)
      .set({
        status: "completed",
        completedAt: now,
        lastPolledAt: now,
        updatedAt: now,
        accountPayload: result.account,
        evidencePayload: result.evidence.items,
        lastError: null,
      })
      .where(eq(clientRadarResearchRunsTable.id, researchRunId))
      .returning();

    if (!updated) {
      throw new Error(
        `persistCompletedClientRadarResult: update to client_radar_research_runs returned no row for id "${researchRunId}".`,
      );
    }

    // result.clientRadarAccountId is null exactly when Client Radar
    // returned no account for this company yet — nothing to link, and
    // that is not a failure (see ../lib/clientRadarClient.ts's
    // ClientRadarResultAccount doc comment).
    if (result.clientRadarAccountId) {
      const aliasResult = await linkClientRadarAccountAlias({
        db: tx,
        accountId: updated.accountId,
        clientRadarAccountId: result.clientRadarAccountId,
      });

      // linked / already_linked: the identity link exists (or already
      // did) — nothing further to do. The completed research payload
      // persists either way; only a genuine conflict withholds the
      // alias, never accountFacts (this function never touches
      // accountFacts) and never the run's own completed status.
      if (aliasResult.outcome === "conflict") {
        await raiseClientRadarIdentityConflictAttention(
          tx,
          updated.accountId,
          result.clientRadarAccountId,
          aliasResult.conflictingAccountId,
          updated.id,
        );
      }
    }

    return updated;
  });
}
