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

import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accounts,
  accountEvaluations,
  accountDecisions,
  type Account,
  type AccountEvaluation,
  type AccountDecision,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------
// List read-model. Deliberately excludes every jsonb column
// (profileConfigSnapshot, eligibilityRestrictions, hardDisqualifiers,
// scoreComponents, matchedRules, missingInputs) — list rows use scalar
// stored columns only, per the agreed contract. The detail endpoint
// (getAccountById) returns full rows instead.
// ---------------------------------------------------------------------

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
>;

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

export interface AccountListItem {
  account: Account;
  latestEvaluation: AccountEvaluationSummary | null;
  latestProductionEvaluation: AccountEvaluationSummary | null;
  /** The account's most recent decision across all of its evaluations, or null if none exists yet. */
  latestDecision: AccountDecisionSummary | null;
}

export interface ListAccountsArgs {
  db: Db;
  limit: number;
  offset: number;
}

export interface AccountListResult {
  items: AccountListItem[];
  total: number;
}

/**
 * Lists canonical accounts, deterministically ordered (updatedAt desc,
 * id desc), each paired with its newest evaluation (any mode), its newest
 * production evaluation (if any), and its newest decision (if any). Runs
 * exactly five queries total regardless of how many accounts are on the
 * page — one count, one page of accounts, one DISTINCT ON query each for
 * "latest" and "latest production" evaluations, and one DISTINCT ON query
 * for the latest decision — all scoped to just this page's account ids.
 * No per-account querying (no N+1).
 */
export async function listAccounts(
  args: ListAccountsArgs,
): Promise<AccountListResult> {
  const { db, limit, offset } = args;

  const [totalRow] = await db.select({ value: count() }).from(accounts);
  const total = Number(totalRow?.value ?? 0);

  const accountRows = await db
    .select()
    .from(accounts)
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
  const [latestRows, latestProductionRows, latestDecisionRows] =
    await Promise.all([
      db
        .selectDistinctOn(
          [accountEvaluations.accountId],
          EVALUATION_SUMMARY_COLUMNS,
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
          EVALUATION_SUMMARY_COLUMNS,
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
    ]);

  const latestByAccountId = new Map(
    latestRows.map((row) => [row.accountId, row]),
  );
  const latestProductionByAccountId = new Map(
    latestProductionRows.map((row) => [row.accountId, row]),
  );
  const latestDecisionByAccountId = new Map(
    latestDecisionRows.map(({ accountId, ...decision }) => [
      accountId,
      decision,
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
  }));

  return { items, total };
}

// ---------------------------------------------------------------------
// Detail read-model — full, exact stored rows (unlike the list summary
// above). No recomputation: evaluations are returned exactly as persisted.
// ---------------------------------------------------------------------

export interface AccountDetail {
  account: Account;
  /** Ordered by createdAt descending, then id descending. */
  evaluations: AccountEvaluation[];
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

  const evaluations = await db
    .select()
    .from(accountEvaluations)
    .where(eq(accountEvaluations.accountId, accountId))
    .orderBy(desc(accountEvaluations.createdAt), desc(accountEvaluations.id));

  return { account, evaluations };
}
