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

import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accountAliases, accounts, observations } from "@workspace/db/schema";
import {
  selectFieldObservationsBoundToAccount,
  type IdentityLinkObservation,
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
 * aliases, newest first. Bound the same way 3F/3H bind firmographic_fact/
 * crm_state evidence: via the account's identity observations resolving
 * to a (provider, sourceRecordId) this account's aliases actually match
 * — never a fuzzy match, never guessed. Throws AccountNotFoundError for
 * an unknown account, mirroring ../services/accountTruth.ts's identical
 * convention.
 */
export async function getAccountRecentActivity(
  db: Db,
  accountId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<AccountActivityItemDTO[]> {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));

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
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0))
    .slice(0, boundedLimit);
}
