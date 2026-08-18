// Provider-neutral canonical account identity planning and persistence.
//
// This module owns the single account-resolution policy shared by signal
// resolution and identity-bootstrap callers. It evaluates every supplied
// strong company identifier together, never binds on company name alone,
// reuses legacy domain-backed accounts, reports conflicting identifiers
// instead of guessing, and writes accounts/strong aliases atomically inside
// a transaction supplied by its caller.

import { createHash } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  accounts,
  accountAliases,
  type Account,
  type AccountAlias,
} from "@workspace/db/schema";
import type { SignalCompanyV1 } from "@workspace/identity";

type Db = NodePgDatabase<typeof schema>;
export type CanonicalAccountResolutionTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function canonicalSourceKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface CompanyIdentifierPair {
  aliasType: string;
  normalizedValue: string;
  rawValue: string;
  identifierType: "domain" | "external_id";
  source?: string;
}

function comparePairs(a: CompanyIdentifierPair, b: CompanyIdentifierPair): number {
  return (
    a.aliasType.localeCompare(b.aliasType) ||
    a.normalizedValue.localeCompare(b.normalizedValue) ||
    a.rawValue.localeCompare(b.rawValue)
  );
}

/** Every strong company identifier, sorted deterministically. Company name is never included. */
export function buildCompanyIdentifierPairs(
  company: SignalCompanyV1,
): CompanyIdentifierPair[] {
  const pairs: CompanyIdentifierPair[] = [];
  if (company.domain) {
    pairs.push({
      aliasType: "domain",
      normalizedValue: company.domain,
      rawValue: company.domain,
      identifierType: "domain",
    });
  }
  for (const [rawSource, value] of Object.entries(company.externalIds)) {
    const source = canonicalSourceKey(rawSource);
    pairs.push({
      aliasType: `external_id:${source}`,
      normalizedValue: value,
      rawValue: value,
      identifierType: "external_id",
      source,
    });
  }
  return pairs.sort(comparePairs);
}

export function buildExternalAccountKey(
  canonicalSource: string,
  externalId: string,
): string {
  const canonical = JSON.stringify([canonicalSource, externalId]);
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `ext:v1:${hash}`;
}

export function buildAccountKey(
  domain: string | null,
  externalIds: Record<string, string>,
  signalSource: string,
): string {
  if (domain) return `dom:${domain}`;

  const entries = Object.entries(externalIds)
    .map(([rawSource, value]) => ({ source: canonicalSourceKey(rawSource), value }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.value.localeCompare(b.value));
  const canonicalSignalSource = canonicalSourceKey(signalSource);
  const aligned = entries.find((entry) => entry.source === canonicalSignalSource);
  const chosen = aligned ?? entries[0];
  if (!chosen) {
    throw new Error("buildAccountKey: no domain or external identifier available.");
  }
  return buildExternalAccountKey(chosen.source, chosen.value);
}

export interface AccountCandidateMatch {
  entityType: "account";
  identifierType: "domain" | "external_id";
  matchedId: string;
  source?: string;
}

function buildAccountConflictCandidates(
  aliasRows: AccountAlias[],
  directRows: Account[],
): AccountCandidateMatch[] {
  const byAccount = new Map<string, AccountCandidateMatch>();
  for (const row of aliasRows) {
    const isDomain = row.aliasType === "domain";
    const candidate: AccountCandidateMatch = {
      entityType: "account",
      identifierType: isDomain ? "domain" : "external_id",
      matchedId: row.accountId,
      ...(isDomain ? {} : { source: row.aliasType.slice("external_id:".length) }),
    };
    const existing = byAccount.get(row.accountId);
    if (!existing || (isDomain && existing.identifierType !== "domain")) {
      byAccount.set(row.accountId, candidate);
    }
  }
  for (const row of directRows) {
    if (!byAccount.has(row.id)) {
      byAccount.set(row.id, {
        entityType: "account",
        identifierType: "domain",
        matchedId: row.id,
      });
    }
  }
  return [...byAccount.values()].sort((a, b) => a.matchedId.localeCompare(b.matchedId));
}

export type AccountResolution =
  | {
      outcome: "unresolved";
      reasonToken: "no_strong_company_identity" | "account_identifier_conflict";
      candidateMatches: AccountCandidateMatch[] | null;
    }
  | {
      outcome: "resolved";
      accountId: string;
      matchAction: "matched" | "created";
      methodToken: "account_domain" | "account_external_id" | "account_created";
    };

export type AccountPlan =
  | {
      outcome: "unresolved";
      reasonToken: "no_strong_company_identity" | "account_identifier_conflict";
      candidateMatches: AccountCandidateMatch[] | null;
    }
  | {
      outcome: "matched";
      accountId: string;
      methodToken: "account_domain" | "account_external_id";
      missingAliasPairs: CompanyIdentifierPair[];
    }
  | {
      outcome: "create";
      accountKey: string;
      companyDomain: string | null;
      companyName: string | null;
      aliasPairs: CompanyIdentifierPair[];
      methodToken: "account_created";
    };

function aliasPairKey(aliasType: string, normalizedValue: string): string {
  return `${aliasType} ${normalizedValue}`;
}

function aliasInsertValues(
  accountId: string,
  pair: CompanyIdentifierPair,
  source: string,
) {
  return {
    accountId,
    aliasType: pair.aliasType,
    rawValue: pair.rawValue,
    normalizedValue: pair.normalizedValue,
    normalizationStrategy:
      pair.identifierType === "domain" ? ("domain" as const) : ("exact" as const),
    isStrong: true,
    source,
  };
}

export async function planCanonicalAccountResolution(
  tx: CanonicalAccountResolutionTx,
  company: SignalCompanyV1,
  source: string,
): Promise<AccountPlan> {
  const pairs = buildCompanyIdentifierPairs(company);
  if (pairs.length === 0) {
    return {
      outcome: "unresolved",
      reasonToken: "no_strong_company_identity",
      candidateMatches: null,
    };
  }

  const aliasRows = await tx
    .select()
    .from(accountAliases)
    .where(
      and(
        eq(accountAliases.isStrong, true),
        or(
          ...pairs.map((pair) =>
            and(
              eq(accountAliases.aliasType, pair.aliasType),
              eq(accountAliases.normalizedValue, pair.normalizedValue),
            ),
          ),
        ),
      ),
    );

  let directRows: Account[] = [];
  if (company.domain) {
    const domain = company.domain;
    directRows = await tx
      .select()
      .from(accounts)
      .where(
        or(
          eq(accounts.accountKey, `dom:${domain}`),
          eq(accounts.accountKey, domain),
          eq(accounts.companyDomain, domain),
        ),
      );
  }

  const distinctAccountIds = new Set<string>([
    ...aliasRows.map((row) => row.accountId),
    ...directRows.map((row) => row.id),
  ]);

  if (distinctAccountIds.size > 1) {
    return {
      outcome: "unresolved",
      reasonToken: "account_identifier_conflict",
      candidateMatches: buildAccountConflictCandidates(aliasRows, directRows),
    };
  }

  if (distinctAccountIds.size === 1) {
    const accountId = [...distinctAccountIds][0]!;
    const methodToken =
      directRows.length > 0 || aliasRows.some((row) => row.aliasType === "domain")
        ? "account_domain"
        : "account_external_id";
    const matchedKeys = new Set(
      aliasRows.map((row) => aliasPairKey(row.aliasType, row.normalizedValue)),
    );
    const missingAliasPairs = pairs.filter(
      (pair) => !matchedKeys.has(aliasPairKey(pair.aliasType, pair.normalizedValue)),
    );
    return { outcome: "matched", accountId, methodToken, missingAliasPairs };
  }

  return {
    outcome: "create",
    accountKey: buildAccountKey(company.domain, company.externalIds, source),
    companyDomain: company.domain,
    companyName: company.name,
    aliasPairs: pairs,
    methodToken: "account_created",
  };
}

export function finalizeCanonicalAccountResolution(
  plan: Extract<AccountPlan, { outcome: "matched" | "create" }>,
  accountId: string,
): AccountResolution {
  return {
    outcome: "resolved",
    accountId,
    matchAction: plan.outcome === "create" ? "created" : "matched",
    methodToken: plan.outcome === "create" ? "account_created" : plan.methodToken,
  };
}

export interface ApplyCanonicalAccountResolutionHooks {
  beforeAccountAliasInsert?: () => Promise<void>;
}

export async function applyCanonicalAccountResolutionPlan(
  tx: CanonicalAccountResolutionTx,
  plan: AccountPlan,
  source: string,
  hooks: ApplyCanonicalAccountResolutionHooks = {},
): Promise<{ accountId: string | null; resolution: AccountResolution }> {
  if (plan.outcome === "unresolved") {
    return {
      accountId: null,
      resolution: {
        outcome: "unresolved",
        reasonToken: plan.reasonToken,
        candidateMatches: plan.candidateMatches,
      },
    };
  }

  if (plan.outcome === "matched") {
    if (plan.missingAliasPairs.length > 0) {
      await tx
        .insert(accountAliases)
        .values(
          plan.missingAliasPairs.map((pair) => aliasInsertValues(plan.accountId, pair, source)),
        )
        .onConflictDoNothing({
          target: [accountAliases.aliasType, accountAliases.normalizedValue],
          where: sql`${accountAliases.isStrong} = true`,
        });
    }
    return {
      accountId: plan.accountId,
      resolution: finalizeCanonicalAccountResolution(plan, plan.accountId),
    };
  }

  await hooks.beforeAccountAliasInsert?.();
  const [createdAccount] = await tx
    .insert(accounts)
    .values({
      accountKey: plan.accountKey,
      companyDomain: plan.companyDomain,
      companyName: plan.companyName,
    })
    .returning();
  if (!createdAccount) {
    // Preserve resolveSignal's pre-extraction failure behavior exactly.
    throw new Error("identityResolution: insert into accounts returned no row.");
  }
  await tx
    .insert(accountAliases)
    .values(plan.aliasPairs.map((pair) => aliasInsertValues(createdAccount.id, pair, source)));

  return {
    accountId: createdAccount.id,
    resolution: finalizeCanonicalAccountResolution(plan, createdAccount.id),
  };
}

const MAX_ERROR_CAUSE_DEPTH = 5;
const ACCOUNT_RACE_CONSTRAINTS = new Set([
  "accounts_account_key_unique",
  "account_aliases_strong_type_normalized_value_uq",
]);

export function isCanonicalAccountRaceViolation(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) return false;
    visited.add(current);
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "40P01") return true;
    if (
      candidate.code === "23505" &&
      typeof candidate.constraint === "string" &&
      ACCOUNT_RACE_CONSTRAINTS.has(candidate.constraint)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
