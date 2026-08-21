// RB2B -> HubSpot context link (minimal current slice).
//
// This is signal-triggered HubSpot CONTEXT, not a bulk HubSpot import: it
// runs once, after an RB2B-resolved canonical Account already exists, and
// only ever reuses existing machinery —
// ../lib/hubSpotClient.ts's searchHubSpotCompaniesByDomain (new, read-only)
// for the domain lookup, and ../services/hubSpotCompanySync.ts (unmodified)
// for identity/observation persistence once exactly one company matches.
// No new scoring/evaluation logic and no second canonical-account system
// are introduced here.
//
// The domain actually searched is always read back from the account's own
// stored companyDomain column, never taken on faith from a caller-supplied
// value — a caller cannot make this function search a domain that isn't
// the resolved account's own canonical domain (see loadAccountDomain
// below and its call site in refreshHubSpotContextForAccount).
//
// HubSpot enrichment is additive, never gating: every branch below returns
// a normal result, not a thrown error, for every expected non-match
// outcome (not_found/ambiguous/skipped) and every recoverable provider
// failure (not-configured/timeout/non-2xx/malformed response) — the
// already-resolved RB2B account is never touched, rolled back, or
// invalidated by anything in this module. Only a genuinely unexpected
// error (a real bug, not a documented provider-shaped failure) propagates,
// mirroring ../routes/hubSpotCompanySync.ts's own catch list.
//
// Only imports from ../lib/hubSpotClient.js, ./hubSpotCompanySync.js,
// ./canonicalAccountResolution.js (types only), and @workspace/db/schema —
// never @workspace/db itself; the database instance is a constructor
// argument, mirroring every other service in this package.

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { accounts } from "@workspace/db/schema";
import {
  HubSpotApiError,
  HubSpotCompanyArchivedError,
  HubSpotCompanyDomainUnavailableError,
  HubSpotNotConfiguredError,
  HubSpotResponseError,
  searchHubSpotCompaniesByDomain,
  type HubSpotCompanyDomainSearchResult,
} from "../lib/hubSpotClient.js";
import {
  InvalidHubSpotCompanyDomainError,
  InvalidHubSpotCompanyIdError,
  InvalidHubSpotCompanyNameError,
} from "./hubSpotCompanyIdentity.js";
import { syncHubSpotCompany, type SyncHubSpotCompanyResult } from "./hubSpotCompanySync.js";
import type { AccountCandidateMatch } from "./canonicalAccountResolution.js";

type Db = NodePgDatabase<typeof schema>;

export class AccountNotFoundError extends Error {
  constructor() {
    super("The account was not found.");
    this.name = "AccountNotFoundError";
  }
}

export type RefreshHubSpotContextLookupStatus =
  | "matched"
  | "not_found"
  | "ambiguous"
  | "skipped"
  | "failed";
export type RefreshHubSpotContextSyncStatus = "synced" | "skipped" | "failed";

export type RefreshHubSpotContextConflict =
  | {
      /** Mirrors bootstrapHubSpotCompanyIdentity's own conflict: the matched HubSpot company's identifiers resolve to more than one existing canonical account. */
      code: "account_identifier_conflict";
      candidateMatches: AccountCandidateMatch[];
    }
  | {
      /** The matched HubSpot company resolved (matched or created) to a DIFFERENT canonical account than the RB2B-resolved one — never silently merged. */
      code: "canonical_account_mismatch";
      rb2bAccountId: string;
      hubspotAccountId: string;
    };

export interface RefreshHubSpotContextResult {
  accountId: string;
  hubspot: {
    lookupStatus: RefreshHubSpotContextLookupStatus;
    companyId: string | null;
    syncStatus: RefreshHubSpotContextSyncStatus;
    conflict: RefreshHubSpotContextConflict | null;
  };
}

function skippedResult(accountId: string): RefreshHubSpotContextResult {
  return {
    accountId,
    hubspot: { lookupStatus: "skipped", companyId: null, syncStatus: "skipped", conflict: null },
  };
}

function failedLookupResult(accountId: string): RefreshHubSpotContextResult {
  return {
    accountId,
    hubspot: { lookupStatus: "failed", companyId: null, syncStatus: "skipped", conflict: null },
  };
}

export type LoadAccountDomainFn = (
  accountId: string,
) => Promise<{ companyDomain: string | null } | undefined>;

export type SearchHubSpotCompaniesFn = (
  domain: string,
) => Promise<HubSpotCompanyDomainSearchResult>;

export type SyncHubSpotCompanyFn = (args: {
  companyId: string;
}) => Promise<SyncHubSpotCompanyResult>;

export interface RefreshHubSpotContextArgs {
  db: Db;
  accountId: string;
  loadAccountDomainFn?: LoadAccountDomainFn;
  searchHubSpotCompaniesFn?: SearchHubSpotCompaniesFn;
  syncHubSpotCompanyFn?: SyncHubSpotCompanyFn;
}

// Errors HubSpot's own sync/adapter path (../services/hubSpotCompanySync.ts
// via ../services/hubSpotCompanyIdentity.ts) is already documented to
// raise for a provider-shaped failure — see ../routes/hubSpotCompanySync.ts's
// own catch list, which this mirrors. Anything else is treated as a real
// bug and propagates.
function isRecoverableHubSpotSyncError(error: unknown): boolean {
  return (
    error instanceof HubSpotNotConfiguredError ||
    error instanceof HubSpotApiError ||
    error instanceof HubSpotResponseError ||
    error instanceof HubSpotCompanyArchivedError ||
    error instanceof HubSpotCompanyDomainUnavailableError ||
    error instanceof InvalidHubSpotCompanyDomainError ||
    error instanceof InvalidHubSpotCompanyIdError ||
    error instanceof InvalidHubSpotCompanyNameError
  );
}

/**
 * Reads back the account's own canonical domain from its stored
 * accounts.companyDomain column — the same column
 * ../services/canonicalAccountResolution.ts treats as authoritative for
 * domain matching. This is the ONLY source of the domain actually
 * searched; see the module comment on why a caller-supplied domain is
 * never trusted directly.
 */
async function loadAccountDomain(
  db: Db,
  accountId: string,
): Promise<{ companyDomain: string | null } | undefined> {
  const [account] = await db
    .select({ companyDomain: accounts.companyDomain })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  return account;
}

/**
 * Signal-triggered HubSpot context refresh for one already-resolved
 * canonical Account (see the module comment above). Never throws for any
 * outcome this slice documents as non-fatal — see D in the design prompt
 * this implements: not_found, ambiguous, a recoverable HubSpot failure, and
 * a canonical-identity conflict all return a normal result with the
 * already-existing RB2B account untouched.
 */
export async function refreshHubSpotContextForAccount(
  args: RefreshHubSpotContextArgs,
): Promise<RefreshHubSpotContextResult> {
  const { db, accountId } = args;
  const loadAccountDomainFn = args.loadAccountDomainFn ?? ((id) => loadAccountDomain(db, id));
  const searchHubSpotCompaniesFn = args.searchHubSpotCompaniesFn ?? searchHubSpotCompaniesByDomain;
  const syncHubSpotCompanyFn =
    args.syncHubSpotCompanyFn ?? ((syncArgs) => syncHubSpotCompany({ db, ...syncArgs }));

  const account = await loadAccountDomainFn(accountId);
  if (!account) {
    throw new AccountNotFoundError();
  }
  if (!account.companyDomain) {
    return skippedResult(accountId);
  }

  let searchResult: HubSpotCompanyDomainSearchResult;
  try {
    searchResult = await searchHubSpotCompaniesFn(account.companyDomain);
  } catch (error) {
    if (error instanceof HubSpotNotConfiguredError) {
      return skippedResult(accountId);
    }
    if (error instanceof HubSpotApiError || error instanceof HubSpotResponseError) {
      return failedLookupResult(accountId);
    }
    throw error;
  }

  if (searchResult.outcome === "not_found") {
    return {
      accountId,
      hubspot: { lookupStatus: "not_found", companyId: null, syncStatus: "skipped", conflict: null },
    };
  }
  if (searchResult.outcome === "ambiguous") {
    return {
      accountId,
      hubspot: { lookupStatus: "ambiguous", companyId: null, syncStatus: "skipped", conflict: null },
    };
  }

  const { companyId } = searchResult;

  let syncResult: SyncHubSpotCompanyResult;
  try {
    syncResult = await syncHubSpotCompanyFn({ companyId });
  } catch (error) {
    if (isRecoverableHubSpotSyncError(error)) {
      return {
        accountId,
        hubspot: { lookupStatus: "matched", companyId, syncStatus: "failed", conflict: null },
      };
    }
    throw error;
  }

  if (syncResult.outcome === "conflict") {
    return {
      accountId,
      hubspot: {
        lookupStatus: "matched",
        companyId,
        syncStatus: "skipped",
        conflict: {
          code: "account_identifier_conflict",
          candidateMatches: syncResult.candidateMatches,
        },
      },
    };
  }

  if (syncResult.accountId !== accountId) {
    return {
      accountId,
      hubspot: {
        lookupStatus: "matched",
        companyId,
        syncStatus: "skipped",
        conflict: {
          code: "canonical_account_mismatch",
          rb2bAccountId: accountId,
          hubspotAccountId: syncResult.accountId,
        },
      },
    };
  }

  return {
    accountId,
    hubspot: { lookupStatus: "matched", companyId, syncStatus: "synced", conflict: null },
  };
}
