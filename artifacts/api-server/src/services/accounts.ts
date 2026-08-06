// Application service for canonical accounts read access (Package 3.1).
// Deliberately contains no HTTP-specific logic (no req/res, no status
// codes, no query/param parsing) — see ../routes/accounts.ts for the HTTP
// boundary that wraps this.
//
// Only imports from @workspace/db/schema, never @workspace/db itself — the
// database instance is always received via explicit injection, mirroring
// ../services/icpProfiles.ts and ../services/accountEvaluations.ts. This
// is a read-only slice: no row here is ever inserted, updated, or deleted.
//
// No evaluation logic is computed or re-run — every value returned is a
// stored column read verbatim from accounts/account_evaluations.
// mqlDecisionReadiness is the one exception, on the same footing as
// intentConfigured below: both are derived at read time from a row's own
// already-persisted data (profileConfigSnapshot, plus — for
// mqlDecisionReadiness — its referenced account_snapshots row), never
// re-running the evaluator itself.

import { and, count, desc, eq, inArray, min, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accounts,
  accountEvaluations,
  accountDecisions,
  accountSnapshots,
  attentionItems,
  type Account,
  type AccountEvaluation,
  type AccountDecision,
  type AccountSnapshot,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  isIntentConfigured,
  IcpProfileConfigV1Schema,
  type MqlDecisionReadiness,
} from "@workspace/evaluator";
import { deriveMqlDecisionReadiness } from "./mqlDecisionReadiness.js";

type Db = NodePgDatabase<typeof schema>;

// accountId and rawInput are required by mqlDecisionReadiness.ts's
// gtm-account-current-state-v2 resolver (envelope.account.id must match
// the snapshot's own accountId, and rawInput carries the frozen evidence
// envelope itself) — kept in this narrow projection alongside source/
// normalizedInput rather than fetching full rows, preserving this
// function's one-query-regardless-of-row-count batching.
type SnapshotForReadiness = Pick<
  AccountSnapshot,
  "id" | "accountId" | "source" | "rawInput" | "normalizedInput"
>;

const SNAPSHOT_READINESS_COLUMNS = {
  id: accountSnapshots.id,
  accountId: accountSnapshots.accountId,
  source: accountSnapshots.source,
  rawInput: accountSnapshots.rawInput,
  normalizedInput: accountSnapshots.normalizedInput,
} as const;

/** Batch-fetches just the columns deriveMqlDecisionReadiness needs for a set of snapshot ids, keyed by id — one query regardless of how many evaluations reference them, never per-row. */
async function loadSnapshotsForReadiness(
  db: Db,
  snapshotIds: string[],
): Promise<Map<string, SnapshotForReadiness>> {
  if (snapshotIds.length === 0) return new Map();
  const rows = await db
    .select(SNAPSHOT_READINESS_COLUMNS)
    .from(accountSnapshots)
    .where(inArray(accountSnapshots.id, snapshotIds));
  return new Map(rows.map((row) => [row.id, row]));
}

// ---------------------------------------------------------------------
// List read-model. Deliberately excludes every jsonb column
// (profileConfigSnapshot, eligibilityRestrictions, hardDisqualifiers,
// scoreComponents, matchedRules, missingInputs) — list rows use scalar
// stored columns only, per the agreed contract. The detail endpoint
// (getAccountById) returns full rows instead.
// ---------------------------------------------------------------------

// intentConfigured is DERIVED at read time from the row's own
// profileConfigSnapshot (see toEvaluationSummary below) — never a stored
// column, so no database migration was needed to add it. The raw
// snapshot itself is discarded before the summary leaves this module, so
// list responses still never carry a jsonb config payload.
export type AccountEvaluationSummary = Pick<
  AccountEvaluation,
  | "id"
  | "accountId"
  | "snapshotId"
  | "profileVersionId"
  | "evaluatorVersionId"
  | "evaluationMode"
  | "status"
  | "errorDetail"
  | "fitScore"
  | "fitTier"
  | "intentScore"
  | "intentTier"
  | "identityResolutionLevel"
  | "identityConfidence"
  | "actionabilityScore"
  | "eligibilityOutcome"
  | "createdAt"
  | "createdBy"
> & {
  /** Whether the profile config this evaluation actually ran against had at least one configured intent rule — see @workspace/evaluator's isIntentConfigured. False means intentTier necessarily resolved to the profile's fallback band, never a real evaluated buying-intent signal. */
  intentConfigured: boolean;
  /** Server-derived, authoritative result of @workspace/evaluator's evaluateMqlDecisionReadiness (via ./mqlDecisionReadiness.ts's deriveMqlDecisionReadiness) — whether this evaluation has enough evidence-backed, action-relevant fit/intent condition resolution to support a Promote to MQL decision. The frontend must render this verbatim, never recompute it. */
  mqlDecisionReadiness: MqlDecisionReadiness;
};

// Selected once and reused for both DISTINCT ON queries below, so the two
// query shapes can never accidentally drift apart.
const EVALUATION_SUMMARY_COLUMNS = {
  id: accountEvaluations.id,
  accountId: accountEvaluations.accountId,
  snapshotId: accountEvaluations.snapshotId,
  profileVersionId: accountEvaluations.profileVersionId,
  evaluatorVersionId: accountEvaluations.evaluatorVersionId,
  evaluationMode: accountEvaluations.evaluationMode,
  status: accountEvaluations.status,
  errorDetail: accountEvaluations.errorDetail,
  fitScore: accountEvaluations.fitScore,
  fitTier: accountEvaluations.fitTier,
  intentScore: accountEvaluations.intentScore,
  intentTier: accountEvaluations.intentTier,
  identityResolutionLevel: accountEvaluations.identityResolutionLevel,
  identityConfidence: accountEvaluations.identityConfidence,
  actionabilityScore: accountEvaluations.actionabilityScore,
  eligibilityOutcome: accountEvaluations.eligibilityOutcome,
  createdAt: accountEvaluations.createdAt,
  createdBy: accountEvaluations.createdBy,
} as const;

// Query-only superset of EVALUATION_SUMMARY_COLUMNS: adds
// profileConfigSnapshot so toEvaluationSummary has something to derive
// intentConfigured from. Never returned to a caller as-is — the raw
// snapshot is stripped back off before the row leaves this module.
const EVALUATION_SUMMARY_QUERY_COLUMNS = {
  ...EVALUATION_SUMMARY_COLUMNS,
  profileConfigSnapshot: accountEvaluations.profileConfigSnapshot,
} as const;

// profileConfigSnapshot is jsonb (`unknown` at the type level). Every row
// SHOULD have been written by evaluateAndPersist() from a config that
// already passed IcpProfileConfigV1Schema validation (see
// lib/db/src/schema/accountEvaluations.ts's `.notNull()` column and own
// module comment) — but this re-validates rather than blindly asserting
// the type, since a false/silent default here would risk showing "Intent
// not configured" for corrupted or otherwise-unexpected stored data
// instead of surfacing the problem.
function toEvaluationSummary<
  T extends {
    profileConfigSnapshot: unknown;
    status: AccountEvaluation["status"];
    evaluationMode: AccountEvaluation["evaluationMode"];
  },
>(
  row: T,
  snapshot: SnapshotForReadiness | undefined,
): Omit<T, "profileConfigSnapshot"> & {
  intentConfigured: boolean;
  mqlDecisionReadiness: MqlDecisionReadiness;
} {
  const { profileConfigSnapshot, ...rest } = row;
  const parsed = IcpProfileConfigV1Schema.safeParse(profileConfigSnapshot);
  if (!parsed.success) {
    throw new Error(
      "Persisted account evaluation contains an invalid profileConfigSnapshot",
    );
  }
  const mqlDecisionReadiness = deriveMqlDecisionReadiness(
    {
      status: row.status,
      evaluationMode: row.evaluationMode,
      profileConfigSnapshot,
    },
    snapshot ?? null,
  );
  return {
    ...rest,
    intentConfigured: isIntentConfigured(parsed.data),
    mqlDecisionReadiness,
  };
}

// Compact summary of an account's most recent canonical decision (any
// routingOutput, any referenced evaluation) — just enough for the
// frontend to decide whether a resolved queue row should still count as
// "needs attention" (see NeedsAttentionView) without a per-row decisions
// fetch. The full decision row (routingReason, gate, etc.) is still only
// available via the decision-history endpoint.
export type AccountDecisionSummary = Pick<
  AccountDecision,
  "id" | "routingOutput" | "createdAt"
>;

// GTM V2 Stage 3, Unit 3 — attention_items is the sole source of truth for
// this; there is no stored attention flag on accounts anywhere. null means
// zero open attention_items rows for the account (never
// { openCount: 0, ... } — there is nothing to report an oldest-open
// timestamp or reason codes for in that case). reasonCodes is the distinct
// set of open items' reasonCode values, sorted ascending — deterministic
// regardless of insertion order or how Postgres happened to return them.
export interface AccountAttentionSummary {
  openCount: number;
  oldestOpenAttentionAt: Date;
  reasonCodes: string[];
}

export interface AccountListItem {
  account: Account;
  latestEvaluation: AccountEvaluationSummary | null;
  latestProductionEvaluation: AccountEvaluationSummary | null;
  /** The account's most recent decision across all of its evaluations, or null if none exists yet. */
  latestDecision: AccountDecisionSummary | null;
  /** Derived at read time from attention_items — never a stored column. See AccountAttentionSummary. */
  attention: AccountAttentionSummary | null;
}

export interface ListAccountsArgs {
  db: Db;
  limit: number;
  offset: number;
  /** When true, restricts the base account query (and its count) to accounts with at least one open attention_items row. Applied via EXISTS, before pagination — never a post-fetch filter, so pagination.total and limit/offset stay correct against the filtered set. */
  needsAttention: boolean;
}

export interface AccountListResult {
  items: AccountListItem[];
  total: number;
}

/**
 * Lists canonical accounts, deterministically ordered (updatedAt desc,
 * id desc), each paired with its newest evaluation (any mode), its newest
 * production evaluation (if any), its newest decision (if any), and its
 * open-attention-items summary (if any). Runs exactly six queries total
 * regardless of how many accounts are on the page — one count, one page of
 * accounts, one DISTINCT ON query each for "latest" and "latest
 * production" evaluations, one DISTINCT ON query for the latest decision,
 * and one GROUP BY aggregate query for open attention items — all scoped
 * to just this page's account ids. No per-account querying (no N+1); the
 * attention aggregate is skipped entirely when the page is empty (see the
 * early return below).
 */
export async function listAccounts(
  args: ListAccountsArgs,
): Promise<AccountListResult> {
  const { db, limit, offset, needsAttention } = args;

  // EXISTS against attention_items_open_account_idx (account_id) WHERE
  // status = 'open' — the same partial index the write-path service
  // (../services/attentionItems.ts) relies on for its own open-item
  // lookups. Applied identically to the count and page queries below so
  // pagination.total always matches the actual filtered set; undefined
  // (the needsAttention=false case) is drizzle's normal "no filter" value
  // for .where(), matching this file's existing optional-filter pattern.
  //
  // Built as a raw sql fragment rather than drizzle's exists(db.select()...)
  // helper — that helper needs a full query-builder object (one
  // implementing getSQL()), which a correlated subquery referencing the
  // outer accounts.id doesn't cleanly express through drizzle's typed
  // query builder anyway. Table/column objects interpolated into a sql
  // template render as identifiers, not bound values (same convention
  // schema/attentionItems.ts's own CHECK constraints use).
  const openAttentionExistsFilter = needsAttention
    ? sql`EXISTS (SELECT 1 FROM ${attentionItems} WHERE ${and(
        eq(attentionItems.accountId, accounts.id),
        eq(attentionItems.status, "open"),
      )})`
    : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(accounts)
    .where(openAttentionExistsFilter);
  const total = Number(totalRow?.value ?? 0);

  const accountRows = await db
    .select()
    .from(accounts)
    .where(openAttentionExistsFilter)
    .orderBy(desc(accounts.updatedAt), desc(accounts.id))
    .limit(limit)
    .offset(offset);

  if (accountRows.length === 0) {
    return { items: [], total };
  }

  const accountIds = accountRows.map((a) => a.id);

  // DISTINCT ON (account_id) — combined with the matching ORDER BY, this
  // is Postgres's native "one row per account_id, the newest by
  // createdAt/id" — no application-side grouping needed.
  const [latestRows, latestProductionRows, latestDecisionRows, attentionAggRows] =
    await Promise.all([
      db
        .selectDistinctOn(
          [accountEvaluations.accountId],
          EVALUATION_SUMMARY_QUERY_COLUMNS,
        )
        .from(accountEvaluations)
        .where(inArray(accountEvaluations.accountId, accountIds))
        .orderBy(
          accountEvaluations.accountId,
          desc(accountEvaluations.createdAt),
          desc(accountEvaluations.id),
        ),
      db
        .selectDistinctOn(
          [accountEvaluations.accountId],
          EVALUATION_SUMMARY_QUERY_COLUMNS,
        )
        .from(accountEvaluations)
        .where(
          and(
            inArray(accountEvaluations.accountId, accountIds),
            eq(accountEvaluations.evaluationMode, "production"),
          ),
        )
        .orderBy(
          accountEvaluations.accountId,
          desc(accountEvaluations.createdAt),
          desc(accountEvaluations.id),
        ),
      // account_decisions carries no direct account_id column, only
      // accountEvaluationId — the join to account_evaluations is required
      // to scope this by account, same as listAccountDecisions in
      // ../services/accountDecisions.ts.
      db
        .selectDistinctOn([accountEvaluations.accountId], {
          accountId: accountEvaluations.accountId,
          id: accountDecisions.id,
          routingOutput: accountDecisions.routingOutput,
          createdAt: accountDecisions.createdAt,
        })
        .from(accountDecisions)
        .innerJoin(
          accountEvaluations,
          eq(accountDecisions.accountEvaluationId, accountEvaluations.id),
        )
        .where(inArray(accountEvaluations.accountId, accountIds))
        .orderBy(
          accountEvaluations.accountId,
          desc(accountDecisions.createdAt),
          desc(accountDecisions.id),
        ),
      // One GROUP BY per account_id — count()/min() aggregate every open
      // item regardless of how many exist, so an account can never appear
      // more than once here (satisfies "one row per account" even when
      // multiple open items exist). array_agg(DISTINCT ...) dedupes
      // reasonCode server-side; the ascending .sort() below (not an
      // in-aggregate ORDER BY) is what makes the array's order
      // deterministic, since array_agg with no ORDER BY has no
      // guaranteed row order.
      db
        .select({
          accountId: attentionItems.accountId,
          openCount: count(),
          oldestOpenAttentionAt: min(attentionItems.createdAt),
          reasonCodes: sql<string[]>`array_agg(distinct ${attentionItems.reasonCode})`,
        })
        .from(attentionItems)
        .where(
          and(
            inArray(attentionItems.accountId, accountIds),
            eq(attentionItems.status, "open"),
          ),
        )
        .groupBy(attentionItems.accountId),
    ]);

  const snapshotById = await loadSnapshotsForReadiness(db, [
    ...new Set([
      ...latestRows.map((row) => row.snapshotId),
      ...latestProductionRows.map((row) => row.snapshotId),
    ]),
  ]);

  const latestByAccountId = new Map(
    latestRows.map((row) => [
      row.accountId,
      toEvaluationSummary(row, snapshotById.get(row.snapshotId)),
    ]),
  );
  const latestProductionByAccountId = new Map(
    latestProductionRows.map((row) => [
      row.accountId,
      toEvaluationSummary(row, snapshotById.get(row.snapshotId)),
    ]),
  );
  const latestDecisionByAccountId = new Map(
    latestDecisionRows.map(({ accountId, ...decision }) => [
      accountId,
      decision,
    ]),
  );

  // count() is a Postgres bigint, which node-postgres returns as a string
  // (not a JS number) to avoid precision loss — normalize it explicitly
  // here rather than trust drizzle's SQL<number> compile-time type, same
  // gotcha as the `total` count above.
  const attentionByAccountId = new Map(
    attentionAggRows.map((row) => [
      row.accountId,
      {
        openCount: Number(row.openCount),
        // Non-null by construction: a GROUP BY row only exists here when
        // openCount >= 1, and created_at is NOT NULL, so MIN() over a
        // non-empty group can never itself be null.
        oldestOpenAttentionAt: row.oldestOpenAttentionAt!,
        reasonCodes: [...row.reasonCodes].sort(),
      } satisfies AccountAttentionSummary,
    ]),
  );

  const items: AccountListItem[] = accountRows.map((account) => ({
    account,
    latestEvaluation: latestByAccountId.get(account.id) ?? null,
    // May be the exact same evaluation as latestEvaluation above — returned
    // normally, with no deduplication/nulling special-case.
    latestProductionEvaluation:
      latestProductionByAccountId.get(account.id) ?? null,
    latestDecision: latestDecisionByAccountId.get(account.id) ?? null,
    attention: attentionByAccountId.get(account.id) ?? null,
  }));

  return { items, total };
}

// ---------------------------------------------------------------------
// Detail read-model — full, exact stored rows (unlike the list summary
// above). No recomputation: evaluations are returned exactly as persisted.
// ---------------------------------------------------------------------

// AccountEvaluation + mqlDecisionReadiness only — every other stored field
// is still returned exactly as persisted (see the module comment above),
// this is the one derived addition, on the same footing as
// AccountEvaluationSummary.mqlDecisionReadiness above.
export type AccountEvaluationDetail = AccountEvaluation & {
  mqlDecisionReadiness: MqlDecisionReadiness;
};

export interface AccountDetail {
  account: Account;
  /** Ordered by createdAt descending, then id descending. */
  evaluations: AccountEvaluationDetail[];
}

export async function getAccountById(
  db: Db,
  accountId: string,
): Promise<AccountDetail | undefined> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) return undefined;

  const evaluationRows = await db
    .select()
    .from(accountEvaluations)
    .where(eq(accountEvaluations.accountId, accountId))
    .orderBy(desc(accountEvaluations.createdAt), desc(accountEvaluations.id));

  const snapshotById = await loadSnapshotsForReadiness(
    db,
    [...new Set(evaluationRows.map((row) => row.snapshotId))],
  );

  const evaluations: AccountEvaluationDetail[] = evaluationRows.map((row) => ({
    ...row,
    mqlDecisionReadiness: deriveMqlDecisionReadiness(
      row,
      snapshotById.get(row.snapshotId) ?? null,
    ),
  }));

  return { account, evaluations };
}
