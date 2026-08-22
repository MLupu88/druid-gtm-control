// Milestone 4C — read-only history of persisted resolved_facts rows for
// one account, used ONLY as a canonical-truth time series for Why Now
// change detection (see ./accountWhyNow.ts). This is deliberately a
// DIFFERENT read than ./accountTruth.ts's getAccountCanonicalTruth:
// that function always recomputes fresh from live observations/
// account_facts and NEVER reads resolved_facts (see its own module
// comment) — "what do we know right now" stays that live recompute,
// unchanged. This module answers a different question: "what did
// Mission Control's canonical understanding look like over time,"
// which can only come from the persisted snapshot ledger.
//
// HONEST LIMITATION, not a bug: resolved_facts rows are written
// exclusively as a byproduct of running an ICP evaluation (see
// factResolutionRun.ts's resolveAccountCanonicalField, called only from
// canonicalFactEvaluatorInput.ts during evaluation). This module reads
// resolved_facts purely as a plain historical ledger — its own columns
// only, no join to account_evaluations/account_snapshots, no evaluation
// semantics, no scoring coupling — but because evaluations are
// irregular and human-triggered, an account that has never been
// evaluated will have NO history here, and change detection will
// honestly find nothing to report for it. That is the correct, expected
// behavior, not a defect to work around with a second write path.

import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accounts, resolvedFacts, type ResolvedFactCanonicalField } from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;

export class AccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super(`account with id "${accountId}" was not found.`);
    this.name = "AccountNotFoundError";
  }
}

export interface ResolvedFactHistoryEntry {
  canonicalField: ResolvedFactCanonicalField;
  resolutionState: "single_source" | "agreement" | "conflict" | "unresolved";
  canonicalValue: unknown;
  resolvedAt: string;
}

/**
 * Every resolved_facts row ever written for this account, oldest first —
 * a real value only when canonicalValue is non-null (see the CHECK
 * constraint on resolvedFacts.ts). Throws AccountNotFoundError for an
 * unknown account, matching every other per-account read model.
 */
export async function getResolvedFactHistory(
  db: Db,
  accountId: string,
): Promise<ResolvedFactHistoryEntry[]> {
  const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  const rows = await db
    .select({
      canonicalField: resolvedFacts.canonicalField,
      resolutionState: resolvedFacts.resolutionState,
      canonicalValue: resolvedFacts.canonicalValue,
      resolvedAt: resolvedFacts.resolvedAt,
    })
    .from(resolvedFacts)
    .where(eq(resolvedFacts.accountId, accountId))
    .orderBy(asc(resolvedFacts.resolvedAt));

  return rows.map((row) => ({
    canonicalField: row.canonicalField as ResolvedFactCanonicalField,
    resolutionState: row.resolutionState,
    canonicalValue: row.canonicalValue,
    resolvedAt: row.resolvedAt.toISOString(),
  }));
}
