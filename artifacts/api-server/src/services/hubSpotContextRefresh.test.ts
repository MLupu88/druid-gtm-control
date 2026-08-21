// RB2B -> HubSpot context link (minimal current slice) — unit tests. No
// database of any kind — real or fake — is ever constructed here: every
// dependency (loadAccountDomainFn/searchHubSpotCompaniesFn/
// syncHubSpotCompanyFn) is injected directly, mirroring
// ./hubSpotCompanySync.test.ts's `const db = {} as Db;` placeholder
// pattern.

import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  HubSpotApiError,
  HubSpotCompanyArchivedError,
  HubSpotCompanyDomainUnavailableError,
  HubSpotNotConfiguredError,
  HubSpotResponseError,
  type HubSpotCompanyDomainSearchResult,
} from "../lib/hubSpotClient.js";
import {
  AccountNotFoundError,
  refreshHubSpotContextForAccount,
  type LoadAccountDomainFn,
  type SearchHubSpotCompaniesFn,
  type SyncHubSpotCompanyFn,
} from "./hubSpotContextRefresh.js";
import type { SyncHubSpotCompanyResult } from "./hubSpotCompanySync.js";
import type { AccountCandidateMatch } from "./canonicalAccountResolution.js";

type Db = NodePgDatabase<typeof schema>;
const db = {} as Db;

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ACCOUNT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const unusedSearchFn: SearchHubSpotCompaniesFn = async () => {
  throw new Error("search must not run");
};
const unusedSyncFn: SyncHubSpotCompanyFn = async () => {
  throw new Error("sync must not run");
};

function loadDomain(companyDomain: string | null): LoadAccountDomainFn {
  return async (accountId) => {
    assert.equal(accountId, ACCOUNT_ID);
    return { companyDomain };
  };
}

const MATCHED_SYNC_RESULT: SyncHubSpotCompanyResult = {
  outcome: "matched",
  accountId: ACCOUNT_ID,
  source: "hubspot",
  attachedAliasTypes: [],
  observations: [],
};

test("an account with no stored domain is skipped without ever calling HubSpot", async () => {
  const result = await refreshHubSpotContextForAccount({
    db,
    accountId: ACCOUNT_ID,
    loadAccountDomainFn: loadDomain(null),
    searchHubSpotCompaniesFn: unusedSearchFn,
    syncHubSpotCompanyFn: unusedSyncFn,
  });
  assert.deepEqual(result, {
    accountId: ACCOUNT_ID,
    hubspot: { lookupStatus: "skipped", companyId: null, syncStatus: "skipped", conflict: null },
  });
});

test("an unknown account throws AccountNotFoundError", async () => {
  await assert.rejects(
    () =>
      refreshHubSpotContextForAccount({
        db,
        accountId: ACCOUNT_ID,
        loadAccountDomainFn: async () => undefined,
        searchHubSpotCompaniesFn: unusedSearchFn,
        syncHubSpotCompanyFn: unusedSyncFn,
      }),
    AccountNotFoundError,
  );
});

test("the account's own stored domain is what gets searched, never a caller-supplied value", async () => {
  let searchedDomain: string | undefined;
  await refreshHubSpotContextForAccount({
    db,
    accountId: ACCOUNT_ID,
    loadAccountDomainFn: loadDomain("acme.com"),
    searchHubSpotCompaniesFn: async (domain) => {
      searchedDomain = domain;
      return { outcome: "not_found" };
    },
    syncHubSpotCompanyFn: unusedSyncFn,
  });
  assert.equal(searchedDomain, "acme.com");
});

test("not_found is non-fatal and never syncs", async () => {
  const result = await refreshHubSpotContextForAccount({
    db,
    accountId: ACCOUNT_ID,
    loadAccountDomainFn: loadDomain("acme.com"),
    searchHubSpotCompaniesFn: async () => ({ outcome: "not_found" }),
    syncHubSpotCompanyFn: unusedSyncFn,
  });
  assert.deepEqual(result.hubspot, {
    lookupStatus: "not_found",
    companyId: null,
    syncStatus: "skipped",
    conflict: null,
  });
});

test("ambiguous is non-fatal, never syncs, and never picks a company", async () => {
  const result = await refreshHubSpotContextForAccount({
    db,
    accountId: ACCOUNT_ID,
    loadAccountDomainFn: loadDomain("acme.com"),
    searchHubSpotCompaniesFn: async () => ({ outcome: "ambiguous", companyIds: ["1", "2"] }),
    syncHubSpotCompanyFn: unusedSyncFn,
  });
  assert.deepEqual(result.hubspot, {
    lookupStatus: "ambiguous",
    companyId: null,
    syncStatus: "skipped",
    conflict: null,
  });
});

for (const error of [
  new HubSpotNotConfiguredError(),
  new HubSpotApiError(502),
  new HubSpotResponseError(),
]) {
  const expectedStatus = error instanceof HubSpotNotConfiguredError ? "skipped" : "failed";
  test(`a ${error.constructor.name} from the domain search is non-fatal (lookupStatus: ${expectedStatus})`, async () => {
    const result = await refreshHubSpotContextForAccount({
      db,
      accountId: ACCOUNT_ID,
      loadAccountDomainFn: loadDomain("acme.com"),
      searchHubSpotCompaniesFn: async () => {
        throw error;
      },
      syncHubSpotCompanyFn: unusedSyncFn,
    });
    assert.equal(result.hubspot.lookupStatus, expectedStatus);
    assert.equal(result.hubspot.syncStatus, "skipped");
    assert.equal(result.hubspot.conflict, null);
  });
}

test("an unexpected (non-provider) search error propagates rather than being swallowed", async () => {
  await assert.rejects(
    () =>
      refreshHubSpotContextForAccount({
        db,
        accountId: ACCOUNT_ID,
        loadAccountDomainFn: loadDomain("acme.com"),
        searchHubSpotCompaniesFn: async () => {
          throw new Error("a real bug");
        },
        syncHubSpotCompanyFn: unusedSyncFn,
      }),
    /a real bug/,
  );
});

test("exactly one match reuses the existing HubSpot company sync path by company id", async () => {
  let syncedCompanyId: string | undefined;
  const result = await refreshHubSpotContextForAccount({
    db,
    accountId: ACCOUNT_ID,
    loadAccountDomainFn: loadDomain("acme.com"),
    searchHubSpotCompaniesFn: async () => ({ outcome: "matched", companyId: "hs-1" }),
    syncHubSpotCompanyFn: async ({ companyId }) => {
      syncedCompanyId = companyId;
      return MATCHED_SYNC_RESULT;
    },
  });
  assert.equal(syncedCompanyId, "hs-1");
  assert.deepEqual(result.hubspot, {
    lookupStatus: "matched",
    companyId: "hs-1",
    syncStatus: "synced",
    conflict: null,
  });
});

test("a sync outcome for a DIFFERENT canonical account returns an explicit conflict, never a silent merge", async () => {
  const result = await refreshHubSpotContextForAccount({
    db,
    accountId: ACCOUNT_ID,
    loadAccountDomainFn: loadDomain("acme.com"),
    searchHubSpotCompaniesFn: async () => ({ outcome: "matched", companyId: "hs-1" }),
    syncHubSpotCompanyFn: async () => ({ ...MATCHED_SYNC_RESULT, accountId: OTHER_ACCOUNT_ID }),
  });
  assert.deepEqual(result.hubspot, {
    lookupStatus: "matched",
    companyId: "hs-1",
    syncStatus: "skipped",
    conflict: {
      code: "canonical_account_mismatch",
      rb2bAccountId: ACCOUNT_ID,
      hubspotAccountId: OTHER_ACCOUNT_ID,
    },
  });
});

test("the sync path's own identifier conflict is surfaced verbatim, not treated as a failure", async () => {
  const candidateMatches: AccountCandidateMatch[] = [
    { entityType: "account", identifierType: "domain", matchedId: OTHER_ACCOUNT_ID },
  ];
  const result = await refreshHubSpotContextForAccount({
    db,
    accountId: ACCOUNT_ID,
    loadAccountDomainFn: loadDomain("acme.com"),
    searchHubSpotCompaniesFn: async () => ({ outcome: "matched", companyId: "hs-1" }),
    syncHubSpotCompanyFn: async () => ({
      outcome: "conflict",
      code: "account_identifier_conflict",
      source: "hubspot",
      candidateMatches,
      observations: [],
    }),
  });
  assert.deepEqual(result.hubspot, {
    lookupStatus: "matched",
    companyId: "hs-1",
    syncStatus: "skipped",
    conflict: { code: "account_identifier_conflict", candidateMatches },
  });
});

for (const error of [
  new HubSpotNotConfiguredError(),
  new HubSpotApiError(502),
  new HubSpotResponseError(),
  new HubSpotCompanyArchivedError(),
  new HubSpotCompanyDomainUnavailableError(),
]) {
  test(`a ${error.constructor.name} from the HubSpot sync path is non-fatal (syncStatus: failed)`, async () => {
    const result = await refreshHubSpotContextForAccount({
      db,
      accountId: ACCOUNT_ID,
      loadAccountDomainFn: loadDomain("acme.com"),
      searchHubSpotCompaniesFn: async () => ({ outcome: "matched", companyId: "hs-1" }),
      syncHubSpotCompanyFn: async () => {
        throw error;
      },
    });
    assert.deepEqual(result.hubspot, {
      lookupStatus: "matched",
      companyId: "hs-1",
      syncStatus: "failed",
      conflict: null,
    });
  });
}

test("an unexpected (non-provider) sync error propagates rather than being swallowed", async () => {
  await assert.rejects(
    () =>
      refreshHubSpotContextForAccount({
        db,
        accountId: ACCOUNT_ID,
        loadAccountDomainFn: loadDomain("acme.com"),
        searchHubSpotCompaniesFn: async () => ({ outcome: "matched", companyId: "hs-1" }),
        syncHubSpotCompanyFn: async () => {
          throw new Error("a real bug");
        },
      }),
    /a real bug/,
  );
});
