// Company-only HubSpot identity bootstrap.
//
// This service performs no HubSpot/network calls and creates no signal or
// identity-resolution event. It supplies a HubSpot company id plus a domain
// to the same provider-neutral canonical account policy resolveSignal uses.

import { and, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accountAliases } from "@workspace/db/schema";
import { normalizeCompanyDomain, type SignalCompanyV1 } from "@workspace/identity";
import {
  applyCanonicalAccountResolutionPlan,
  buildCompanyIdentifierPairs,
  isCanonicalAccountRaceViolation,
  planCanonicalAccountResolution,
  type AccountCandidateMatch,
  type CompanyIdentifierPair,
} from "./canonicalAccountResolution.js";

type Db = NodePgDatabase<typeof schema>;

export const HUBSPOT_IDENTITY_SOURCE = "hubspot" as const;
const HUBSPOT_ALIAS_TYPE = "external_id:hubspot";
const MAX_BOOTSTRAP_ATTEMPTS = 5;
const MAX_IDENTITY_STRING_LENGTH = 500;

export class InvalidHubSpotCompanyIdError extends Error {
  constructor() {
    super("hubspotCompanyId must be a non-blank string no longer than 500 characters.");
    this.name = "InvalidHubSpotCompanyIdError";
  }
}

export class InvalidHubSpotCompanyDomainError extends Error {
  constructor() {
    super("companyDomain must normalize to a valid non-blank canonical domain.");
    this.name = "InvalidHubSpotCompanyDomainError";
  }
}

export class InvalidHubSpotCompanyNameError extends Error {
  constructor() {
    super("companyName must be null or a non-blank string no longer than 500 characters.");
    this.name = "InvalidHubSpotCompanyNameError";
  }
}

function isCanonicalDomainShape(value: string): boolean {
  return (
    value === value.trim().toLowerCase() &&
    !value.includes("://") &&
    !/[/?#]/.test(value) &&
    !value.startsWith("www.")
  );
}

export interface NormalizeHubSpotCompanyIdentityInputArgs {
  hubspotCompanyId: string;
  companyDomain: string;
  companyName?: string | null;
}

export interface NormalizedHubSpotCompanyIdentityInput {
  hubspotCompanyId: string;
  company: SignalCompanyV1;
}

export function normalizeHubSpotCompanyIdentityInput(
  args: NormalizeHubSpotCompanyIdentityInputArgs,
): NormalizedHubSpotCompanyIdentityInput {
  const hubspotCompanyId = args.hubspotCompanyId.trim();
  if (
    hubspotCompanyId === "" ||
    hubspotCompanyId.length > MAX_IDENTITY_STRING_LENGTH
  ) {
    throw new InvalidHubSpotCompanyIdError();
  }

  // Normalize exactly once with the shared identity helper, then enforce
  // the same canonical shape the signals/account_aliases database checks use.
  const companyDomain = normalizeCompanyDomain(args.companyDomain);
  if (
    companyDomain === null ||
    companyDomain.length > MAX_IDENTITY_STRING_LENGTH ||
    !isCanonicalDomainShape(companyDomain)
  ) {
    throw new InvalidHubSpotCompanyDomainError();
  }

  let companyName: string | null = null;
  if (args.companyName !== undefined && args.companyName !== null) {
    companyName = args.companyName.trim();
    if (companyName === "" || companyName.length > MAX_IDENTITY_STRING_LENGTH) {
      throw new InvalidHubSpotCompanyNameError();
    }
  }

  return {
    hubspotCompanyId,
    company: {
      domain: companyDomain,
      name: companyName,
      externalIds: { [HUBSPOT_IDENTITY_SOURCE]: hubspotCompanyId },
    },
  };
}

export interface BootstrapHubSpotCompanyIdentityArgs
  extends NormalizeHubSpotCompanyIdentityInputArgs {
  db: Db;
  /** Test-only bounded-retry override. */
  maxAttempts?: number;
}

export type BootstrapHubSpotCompanyIdentityResult =
  | {
      outcome: "matched" | "created";
      accountId: string;
      source: typeof HUBSPOT_IDENTITY_SOURCE;
      attachedAliasTypes: Array<"domain" | typeof HUBSPOT_ALIAS_TYPE>;
    }
  | {
      outcome: "conflict";
      code: "account_identifier_conflict";
      source: typeof HUBSPOT_IDENTITY_SOURCE;
      candidateMatches: AccountCandidateMatch[];
    };

class ConcurrentAliasOwnershipConflictError extends Error {
  constructor(readonly candidateMatches: AccountCandidateMatch[]) {
    super("A strong company identifier was concurrently claimed by another account.");
    this.name = "ConcurrentAliasOwnershipConflictError";
  }
}

function candidateMatchesForAliasRows(
  rows: Array<{ accountId: string; aliasType: string }>,
): AccountCandidateMatch[] {
  const byAccount = new Map<string, AccountCandidateMatch>();
  for (const row of rows) {
    const isDomain = row.aliasType === "domain";
    const candidate: AccountCandidateMatch = {
      entityType: "account",
      identifierType: isDomain ? "domain" : "external_id",
      matchedId: row.accountId,
      ...(isDomain ? {} : { source: HUBSPOT_IDENTITY_SOURCE }),
    };
    const existing = byAccount.get(row.accountId);
    if (!existing || (isDomain && existing.identifierType !== "domain")) {
      byAccount.set(row.accountId, candidate);
    }
  }
  return [...byAccount.values()].sort((a, b) => a.matchedId.localeCompare(b.matchedId));
}

async function verifyAliasOwnership(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  accountId: string,
  pairs: CompanyIdentifierPair[],
): Promise<void> {
  const rows = await tx
    .select({
      accountId: accountAliases.accountId,
      aliasType: accountAliases.aliasType,
      normalizedValue: accountAliases.normalizedValue,
    })
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

  if (rows.some((row) => row.accountId !== accountId)) {
    throw new ConcurrentAliasOwnershipConflictError(candidateMatchesForAliasRows(rows));
  }
  const found = new Set(rows.map((row) => `${row.aliasType}\u0000${row.normalizedValue}`));
  if (
    pairs.some(
      (pair) => !found.has(`${pair.aliasType}\u0000${pair.normalizedValue}`),
    )
  ) {
    throw new Error("hubSpotCompanyIdentity: expected strong alias was not persisted.");
  }
}

export async function bootstrapHubSpotCompanyIdentity(
  args: BootstrapHubSpotCompanyIdentityArgs,
): Promise<BootstrapHubSpotCompanyIdentityResult> {
  const { company } = normalizeHubSpotCompanyIdentityInput(args);
  const { db, maxAttempts = MAX_BOOTSTRAP_ATTEMPTS } = args;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("bootstrapHubSpotCompanyIdentity: maxAttempts must be a positive integer.");
  }
  const pairs = buildCompanyIdentifierPairs(company);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const plan = await planCanonicalAccountResolution(
          tx,
          company,
          HUBSPOT_IDENTITY_SOURCE,
        );
        if (plan.outcome === "unresolved") {
          if (plan.reasonToken !== "account_identifier_conflict") {
            throw new Error(
              "hubSpotCompanyIdentity: required strong identifiers produced no account plan.",
            );
          }
          return {
            outcome: "conflict" as const,
            code: "account_identifier_conflict" as const,
            source: HUBSPOT_IDENTITY_SOURCE,
            candidateMatches: plan.candidateMatches ?? [],
          };
        }

        const attachedAliasTypes = (
          plan.outcome === "create" ? plan.aliasPairs : plan.missingAliasPairs
        ).map((pair) => pair.aliasType as "domain" | typeof HUBSPOT_ALIAS_TYPE);

        const applied = await applyCanonicalAccountResolutionPlan(
          tx,
          plan,
          HUBSPOT_IDENTITY_SOURCE,
        );
        if (applied.accountId === null || applied.resolution.outcome !== "resolved") {
          throw new Error("hubSpotCompanyIdentity: resolved account plan produced no account.");
        }

        await verifyAliasOwnership(tx, applied.accountId, pairs);

        return {
          outcome: applied.resolution.matchAction,
          accountId: applied.accountId,
          source: HUBSPOT_IDENTITY_SOURCE,
          attachedAliasTypes,
        };
      });
    } catch (error) {
      if (error instanceof ConcurrentAliasOwnershipConflictError) {
        return {
          outcome: "conflict",
          code: "account_identifier_conflict",
          source: HUBSPOT_IDENTITY_SOURCE,
          candidateMatches: error.candidateMatches,
        };
      }
      if (isCanonicalAccountRaceViolation(error) && attempt < maxAttempts) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("bootstrapHubSpotCompanyIdentity: attempts exhausted unexpectedly.");
}
