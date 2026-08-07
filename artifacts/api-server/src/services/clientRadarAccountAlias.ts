// GTM V2 Stage 5, Unit 1 — links a canonical GTM account to Client
// Radar's own account identity, via account_aliases (see
// @workspace/db/schema/accountAliases.ts). Client Radar's account.id
// (its Postgres uuid primary key) is the durable anchor — never
// account_key, which is a workspace-scoped, n8n-derived string with no
// provider-owned uniqueness guarantee of its own. account_key stays only
// inside client_radar_research_runs.accountPayload for display/debugging
// (see ../services/clientRadarResearchRuns.ts).
//
// Concurrency: deliberately NOT a SELECT-then-INSERT — two GTM processes
// syncing different research runs could both observe "no existing alias"
// and both attempt to create one. The database's own partial unique
// index (account_aliases_strong_type_normalized_value_uq, scoped to
// is_strong = true) is the sole arbiter: the INSERT is always attempted
// first, and only when it reports zero rows inserted (a real conflict,
// not an error — onConflictDoNothing) does this re-read to classify
// already_linked vs. conflict. Exact mirror of
// ../services/identityResolution.ts's own planAccountResolution/
// applyAccountPlan shape (read existing strong aliases, insert with the
// same onConflictDoNothing target/where, never update or remap an
// existing strong alias).
//
// This function never writes an attention item itself — a conflict is
// reported back to the caller (see ../services/clientRadarResearchRuns.ts)
// so raising the attention item stays an explicit orchestration decision,
// not something buried in a low-level alias helper.
//
// Only imports from @workspace/db/schema, never @workspace/db itself —
// the database instance is always received via explicit injection,
// mirroring every other service in this package.

import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accountAliases } from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;
// Extracts the exact transaction-handle type db.transaction()'s callback
// receives — same convention as ../services/attentionItems.ts's own Tx
// alias, so this function is callable either with the plain pool or with
// a caller's already-open transaction (see
// ../services/clientRadarResearchRuns.ts, which calls this from inside
// its own db.transaction()).
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const CLIENT_RADAR_ACCOUNT_ID_ALIAS_TYPE = "client_radar_account_id";
export const CLIENT_RADAR_ALIAS_SOURCE = "client_radar";

export interface LinkClientRadarAccountAliasArgs {
  /** The plain pool, or a caller's already-open transaction. */
  db: Db | Tx;
  accountId: string;
  /**
   * Client Radar's account.id (uuid). Callers are expected to have
   * already validated this is a well-formed uuid — see
   * ../lib/clientRadarClient.ts's parseResultAccount, the only production
   * source of this value. This function does not re-validate its shape
   * beyond rejecting a blank string.
   */
  clientRadarAccountId: string;
}

export type LinkClientRadarAccountAliasResult =
  | { outcome: "linked" }
  | { outcome: "already_linked" }
  | { outcome: "conflict"; conflictingAccountId: string };

/**
 * Links accountId to clientRadarAccountId via a strong account_aliases
 * row, or reports why it couldn't:
 *
 *   1. Attempt the INSERT first, with onConflictDoNothing scoped to the
 *      same partial unique index the database enforces
 *      (account_aliases_strong_type_normalized_value_uq). If a row comes
 *      back, this call itself created the link: "linked".
 *   2. Zero rows back means a strong alias for this
 *      (client_radar_account_id, normalizedValue) pair already exists —
 *      re-read it to find out whose. If it already points at accountId,
 *      an earlier call (this one, replayed, or a concurrent racer) already
 *      did this work: "already_linked", not a duplicate insert.
 *   3. If it points at a DIFFERENT account, this Client Radar account is
 *      already strongly claimed elsewhere: "conflict". Never remaps or
 *      updates the existing row — the caller decides how to surface this
 *      (see ../services/clientRadarResearchRuns.ts).
 *
 * Fails closed (throws) if the re-read after a reported conflict finds no
 * matching row at all — that combination is inexplicable (the unique
 * violation proves a matching strong alias exists) and this refuses to
 * invent a result rather than guess (mirrors
 * ../services/attentionItems.ts's createAttentionItem).
 */
export async function linkClientRadarAccountAlias(
  args: LinkClientRadarAccountAliasArgs,
): Promise<LinkClientRadarAccountAliasResult> {
  const { db, accountId, clientRadarAccountId } = args;
  const normalizedValue = clientRadarAccountId.trim();
  if (normalizedValue === "") {
    throw new Error(
      "linkClientRadarAccountAlias: clientRadarAccountId must not be blank.",
    );
  }

  const [inserted] = await db
    .insert(accountAliases)
    .values({
      accountId,
      aliasType: CLIENT_RADAR_ACCOUNT_ID_ALIAS_TYPE,
      rawValue: clientRadarAccountId,
      normalizedValue,
      normalizationStrategy: "exact",
      isStrong: true,
      source: CLIENT_RADAR_ALIAS_SOURCE,
    })
    .onConflictDoNothing({
      target: [accountAliases.aliasType, accountAliases.normalizedValue],
      where: sql`${accountAliases.isStrong} = true`,
    })
    .returning();

  if (inserted) {
    return { outcome: "linked" };
  }

  const [existing] = await db
    .select()
    .from(accountAliases)
    .where(
      and(
        eq(accountAliases.aliasType, CLIENT_RADAR_ACCOUNT_ID_ALIAS_TYPE),
        eq(accountAliases.normalizedValue, normalizedValue),
        eq(accountAliases.isStrong, true),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      `linkClientRadarAccountAlias: insert conflicted for client_radar_account_id "${clientRadarAccountId}" but no existing strong alias was found.`,
    );
  }

  if (existing.accountId === accountId) {
    return { outcome: "already_linked" };
  }

  return { outcome: "conflict", conflictingAccountId: existing.accountId };
}
