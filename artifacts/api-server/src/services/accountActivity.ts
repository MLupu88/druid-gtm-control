// M3.5 — RB2B live signal last-mile: minimum truthful Account Workspace
// Activity visibility. Read-only. Reuses the exact same account-subject
// binding primitive Milestone 3F's factResolutionRun.ts already uses
// (./observationSubjectBinding.ts) — no new binding/matching logic, just
// a different observationClass (behavioral_signal instead of
// firmographic_fact/crm_state) and no reconciliation step, since a raw
// activity feed is a list of events, not a scalar fact to resolve (see
// ./factReconciliation.ts's own module comment: behavioral_signal
// observations are never reconciliation candidates).
//
// Deliberately NOT the final ZoomInfo-style People/Activity UX — this is
// the minimum surface needed to prove a real RB2B visitor is visible in
// Mission Control end to end. rawValue is returned as-is (the complete
// validated inbound RB2B DTO, per ../services/rb2bObservationMapping.ts's
// own comment) for the frontend to render without this module inventing
// any provider-specific summarization.

import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accountAliases, accounts, observations } from "@workspace/db/schema";
import {
  selectFieldObservationsBoundToAccount,
  buildRecordKeyToAccountIndex,
  lookupAccountForRecord,
  type IdentityLinkObservation,
  type AccountAliasRowWithAccountId,
} from "./observationSubjectBinding.js";

type Db = NodePgDatabase<typeof schema>;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class AccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super(`account with id "${accountId}" was not found.`);
    this.name = "AccountNotFoundError";
  }
}

export interface AccountActivityItemDTO {
  id: string;
  provider: string;
  eventType: string;
  /** observedAt when the provider supplied one, else importedAt — never fabricated, always one or the other. */
  occurredAt: string;
  importedAt: string;
  /** The complete rawValue this observation was recorded with — provider-neutral, never reshaped here. */
  rawValue: unknown;
}

/**
 * Every behavioral_signal observation bound to this account's strong
 * aliases, newest first, UNBOUNDED (no limit) — the shared primitive
 * behind both getAccountRecentActivity (below, which slices it) and
 * Milestone 4B's ./accountActivitySummary.ts (which aggregates the full
 * set). Bound the same way 3F/3H bind firmographic_fact/crm_state
 * evidence: via the account's identity observations resolving to a
 * (provider, sourceRecordId) this account's aliases actually match —
 * never a fuzzy match, never guessed. Throws AccountNotFoundError for an
 * unknown account, mirroring ../services/accountTruth.ts's identical
 * convention.
 */
export async function getAccountBoundActivity(
  db: Db,
  accountId: string,
): Promise<AccountActivityItemDTO[]> {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  const aliasRows = await db
    .select({
      aliasType: accountAliases.aliasType,
      normalizedValue: accountAliases.normalizedValue,
    })
    .from(accountAliases)
    .where(eq(accountAliases.accountId, accountId));

  const identityRows = await db
    .select({
      provider: observations.provider,
      sourceRecordId: observations.sourceRecordId,
      semanticKey: observations.semanticKey,
      identityValue: observations.identityValue,
    })
    .from(observations)
    .where(
      and(eq(observations.observationClass, "identity"), eq(observations.identitySubjectType, "account")),
    );
  const identityObservations: IdentityLinkObservation[] = identityRows
    .filter((row) => row.identityValue !== null)
    .map((row) => ({
      provider: row.provider,
      sourceRecordId: row.sourceRecordId,
      identityKey: row.semanticKey as "domain" | "external_id",
      identityValue: row.identityValue!,
    }));

  const activityRows = await db
    .select({
      id: observations.id,
      provider: observations.provider,
      sourceRecordId: observations.sourceRecordId,
      semanticKey: observations.semanticKey,
      rawValue: observations.rawValue,
      observedAt: observations.observedAt,
      importedAt: observations.importedAt,
    })
    .from(observations)
    .where(eq(observations.observationClass, "behavioral_signal"));

  const bound = selectFieldObservationsBoundToAccount({
    accountAliases: aliasRows,
    identityObservations,
    fieldObservations: activityRows,
  });

  return bound
    .map(
      (row): AccountActivityItemDTO => ({
        id: row.id,
        provider: row.provider,
        eventType: row.semanticKey,
        occurredAt: (row.observedAt ?? row.importedAt).toISOString(),
        importedAt: row.importedAt.toISOString(),
        rawValue: row.rawValue,
      }),
    )
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
}

/**
 * getAccountBoundActivity, capped to the caller's requested page size —
 * the existing Account Workspace Activity tab's read model. See
 * getAccountBoundActivity for the full binding rule; this adds only the
 * limit/slice concern.
 */
export async function getAccountRecentActivity(
  db: Db,
  accountId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<AccountActivityItemDTO[]> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));
  const all = await getAccountBoundActivity(db, accountId);
  return all.slice(0, boundedLimit);
}

// ---------------------------------------------------------------------
// LS4 — Global cross-account Recent Activity for Overview. Extends this
// same module rather than building a second activity model: identical
// "visible activity" rule as getAccountRecentActivity above (only
// behavioral_signal observations are ever user-facing activity —
// identity observations, including RB2B's companion domain-identity
// observation recorded alongside each behavioral_signal event, are used
// purely as binding evidence and never themselves appear as a row here,
// so the companion identity write is never double-counted as a second
// visit), just resolved against every account's aliases at once instead
// of one pre-selected account's. See
// ./observationSubjectBinding.ts's buildRecordKeyToAccountIndex for the
// exact binding rule (including its "ambiguous binding -> excluded,
// never guessed" behavior, which applies here identically).
// ---------------------------------------------------------------------

const GLOBAL_DEFAULT_LIMIT = 20;
const GLOBAL_MAX_LIMIT = 100;

export interface GlobalActivityItemDTO extends AccountActivityItemDTO {
  accountId: string;
  /** Null when the account has never had a company_name recorded — never fabricated. */
  accountName: string | null;
  /** Null when the account has never had a company_domain recorded — never fabricated. */
  companyDomain: string | null;
}

/**
 * Every behavioral_signal observation that resolves to SOME canonical
 * account (via the same alias-binding mechanism getAccountRecentActivity
 * uses, just applied globally), newest first, across all accounts. An
 * observation whose (provider, sourceRecordId) resolves to no account —
 * or ambiguously to more than one — is simply absent, exactly like the
 * per-account path: never guessed, never attached to the wrong account.
 */
export async function getGlobalRecentActivity(
  db: Db,
  limit: number = GLOBAL_DEFAULT_LIMIT,
): Promise<GlobalActivityItemDTO[]> {
  const boundedLimit = Math.max(1, Math.min(limit, GLOBAL_MAX_LIMIT));

  const aliasRows: AccountAliasRowWithAccountId[] = await db
    .select({
      accountId: accountAliases.accountId,
      aliasType: accountAliases.aliasType,
      normalizedValue: accountAliases.normalizedValue,
    })
    .from(accountAliases);

  const identityRows = await db
    .select({
      provider: observations.provider,
      sourceRecordId: observations.sourceRecordId,
      semanticKey: observations.semanticKey,
      identityValue: observations.identityValue,
    })
    .from(observations)
    .where(
      and(eq(observations.observationClass, "identity"), eq(observations.identitySubjectType, "account")),
    );
  const identityObservations: IdentityLinkObservation[] = identityRows
    .filter((row) => row.identityValue !== null)
    .map((row) => ({
      provider: row.provider,
      sourceRecordId: row.sourceRecordId,
      identityKey: row.semanticKey as "domain" | "external_id",
      identityValue: row.identityValue!,
    }));

  const recordKeyToAccountId = buildRecordKeyToAccountIndex(identityObservations, aliasRows);

  const activityRows = await db
    .select({
      id: observations.id,
      provider: observations.provider,
      sourceRecordId: observations.sourceRecordId,
      semanticKey: observations.semanticKey,
      rawValue: observations.rawValue,
      observedAt: observations.observedAt,
      importedAt: observations.importedAt,
    })
    .from(observations)
    .where(eq(observations.observationClass, "behavioral_signal"));

  const boundRows = activityRows
    .map((row) => ({ row, accountId: lookupAccountForRecord(recordKeyToAccountId, row) }))
    .filter(
      (entry): entry is { row: (typeof activityRows)[number]; accountId: string } =>
        entry.accountId !== undefined,
    );

  const distinctAccountIds = [...new Set(boundRows.map((entry) => entry.accountId))];
  const accountRows = distinctAccountIds.length
    ? await db
        .select({ id: accounts.id, companyName: accounts.companyName, companyDomain: accounts.companyDomain })
        .from(accounts)
        .where(inArray(accounts.id, distinctAccountIds))
    : [];
  const accountById = new Map(accountRows.map((a) => [a.id, a]));

  return boundRows
    .map(({ row, accountId }): GlobalActivityItemDTO => {
      const account = accountById.get(accountId);
      return {
        id: row.id,
        provider: row.provider,
        eventType: row.semanticKey,
        occurredAt: (row.observedAt ?? row.importedAt).toISOString(),
        importedAt: row.importedAt.toISOString(),
        rawValue: row.rawValue,
        accountId,
        accountName: account?.companyName ?? null,
        companyDomain: account?.companyDomain ?? null,
      };
    })
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    .slice(0, boundedLimit);
}
