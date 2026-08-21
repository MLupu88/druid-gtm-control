// Milestone 3F — unit tests for pure, derived observation subject
// binding. No DB — plain fixtures in, bound observation subsets out. Run
// with: tsx --test src/services/observationSubjectBinding.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeIdentityAliasLookup,
  selectAccountRecordKeys,
  selectFieldObservationsBoundToAccount,
  selectObservationsBoundToAccount,
  buildRecordKeyToAccountIndex,
  lookupAccountForRecord,
  type AccountAliasRow,
  type AccountAliasRowWithAccountId,
  type IdentityLinkObservation,
} from "./observationSubjectBinding.js";

const HUBSPOT_DOMAIN_ALIAS: AccountAliasRow = { aliasType: "domain", normalizedValue: "acme.com" };
const HUBSPOT_EXTERNAL_ID_ALIAS: AccountAliasRow = {
  aliasType: "external_id:hubspot",
  normalizedValue: "12345",
};

const HUBSPOT_DOMAIN_IDENTITY: IdentityLinkObservation = {
  provider: "hubspot",
  sourceRecordId: "12345",
  identityKey: "domain",
  identityValue: "https://WWW.Acme.com/",
};
const HUBSPOT_EXTERNAL_ID_IDENTITY: IdentityLinkObservation = {
  provider: "hubspot",
  sourceRecordId: "12345",
  identityKey: "external_id",
  identityValue: "12345",
};

// ---------------------------------------------------------------------
// 15. HubSpot external_id identity -> existing account alias -> binding
// ---------------------------------------------------------------------
test("a HubSpot external_id identity observation binds via the existing external_id:hubspot alias convention", () => {
  const lookup = computeIdentityAliasLookup(HUBSPOT_EXTERNAL_ID_IDENTITY);
  assert.deepEqual(lookup, { aliasType: "external_id:hubspot", normalizedValue: "12345" });

  const keys = selectAccountRecordKeys([HUBSPOT_EXTERNAL_ID_IDENTITY], [HUBSPOT_EXTERNAL_ID_ALIAS]);
  assert.deepEqual(keys, [{ provider: "hubspot", sourceRecordId: "12345" }]);
});

test("a HubSpot domain identity observation binds after normalizeCompanyDomain, even though its own identityValue is raw/unnormalized", () => {
  const lookup = computeIdentityAliasLookup(HUBSPOT_DOMAIN_IDENTITY);
  assert.deepEqual(lookup, { aliasType: "domain", normalizedValue: "acme.com" });

  const keys = selectAccountRecordKeys([HUBSPOT_DOMAIN_IDENTITY], [HUBSPOT_DOMAIN_ALIAS]);
  assert.deepEqual(keys, [{ provider: "hubspot", sourceRecordId: "12345" }]);
});

// ---------------------------------------------------------------------
// 16. a firmographic/crm observation sharing (provider, sourceRecordId)
//     with a bound identity observation binds to the same account.
// ---------------------------------------------------------------------
test("a firmographic_fact observation sharing HubSpot's provider+sourceRecordId binds to the account resolved via identity", () => {
  const firmographicObservation = {
    id: "obs-industry",
    provider: "hubspot",
    sourceRecordId: "12345",
  };
  const crmObservation = {
    id: "obs-owner",
    provider: "hubspot",
    sourceRecordId: "12345",
  };
  const unrelatedObservation = {
    id: "obs-other-company",
    provider: "hubspot",
    sourceRecordId: "99999",
  };

  const bound = selectFieldObservationsBoundToAccount({
    accountAliases: [HUBSPOT_DOMAIN_ALIAS, HUBSPOT_EXTERNAL_ID_ALIAS],
    identityObservations: [HUBSPOT_DOMAIN_IDENTITY, HUBSPOT_EXTERNAL_ID_IDENTITY],
    fieldObservations: [firmographicObservation, crmObservation, unrelatedObservation],
  });

  assert.deepEqual(
    bound.map((o) => o.id).sort(),
    ["obs-industry", "obs-owner"],
  );
});

// ---------------------------------------------------------------------
// 17. an identity observation whose value matches no known alias remains
//     unbound.
// ---------------------------------------------------------------------
test("an identity observation with no matching account alias stays unbound", () => {
  const unknownDomainIdentity: IdentityLinkObservation = {
    provider: "hubspot",
    sourceRecordId: "77777",
    identityKey: "domain",
    identityValue: "totally-unknown-company.example",
  };
  const keys = selectAccountRecordKeys([unknownDomainIdentity], [HUBSPOT_DOMAIN_ALIAS, HUBSPOT_EXTERNAL_ID_ALIAS]);
  assert.deepEqual(keys, []);

  const bound = selectObservationsBoundToAccount(
    [{ id: "obs-x", provider: "hubspot", sourceRecordId: "77777" }],
    keys,
  );
  assert.deepEqual(bound, []);
});

// ---------------------------------------------------------------------
// 18. no fuzzy matching — a near-miss domain never binds.
// ---------------------------------------------------------------------
test("a similar but not identical domain never binds — no fuzzy matching", () => {
  const nearMissIdentity: IdentityLinkObservation = {
    provider: "hubspot",
    sourceRecordId: "55555",
    identityKey: "domain",
    identityValue: "acme-corp.com",
  };
  const keys = selectAccountRecordKeys([nearMissIdentity], [HUBSPOT_DOMAIN_ALIAS]);
  assert.deepEqual(keys, []);
});

test("no fuzzy matching on external_id either — a near-miss id never binds", () => {
  const nearMissIdentity: IdentityLinkObservation = {
    provider: "hubspot",
    sourceRecordId: "123456",
    identityKey: "external_id",
    identityValue: "123456",
  };
  const keys = selectAccountRecordKeys([nearMissIdentity], [HUBSPOT_EXTERNAL_ID_ALIAS]);
  assert.deepEqual(keys, []);
});

test("an unparseable domain identity value cannot be normalized and stays unbound rather than erroring", () => {
  const unparseable: IdentityLinkObservation = {
    provider: "hubspot",
    sourceRecordId: "1",
    identityKey: "domain",
    identityValue: "   ",
  };
  assert.equal(computeIdentityAliasLookup(unparseable), null);
});

// ---------------------------------------------------------------------
// Client Radar / RB2B: no scalar binding attempted in this slice — the
// primitives are provider-neutral, but a Client Radar client_radar_
// account_id alias or an RB2B behavioral_signal observation simply never
// participates because neither ever supplies an `identity` observation
// (see module comment) — nothing special-cases them, they are just
// absent from the identityObservations input entirely in real usage.
// ---------------------------------------------------------------------
test("a research_intelligence-shaped observation with no identity counterpart is never bound by guesswork", () => {
  const bound = selectFieldObservationsBoundToAccount({
    accountAliases: [HUBSPOT_DOMAIN_ALIAS],
    identityObservations: [],
    fieldObservations: [{ id: "obs-research", provider: "client_radar", sourceRecordId: "ev_1" }],
  });
  assert.deepEqual(bound, []);
});

// ---------------------------------------------------------------------
// LS4 — buildRecordKeyToAccountIndex / lookupAccountForRecord: the
// global (many-accounts-at-once) inverse of the per-account primitives
// above, used by the global cross-account activity feed.
// ---------------------------------------------------------------------

test("buildRecordKeyToAccountIndex resolves a record key to the one account whose alias it matches", () => {
  const aliases: AccountAliasRowWithAccountId[] = [
    { accountId: "account-a", aliasType: "domain", normalizedValue: "acme.com" },
  ];
  const index = buildRecordKeyToAccountIndex([HUBSPOT_DOMAIN_IDENTITY], aliases);

  assert.equal(
    lookupAccountForRecord(index, { provider: "hubspot", sourceRecordId: "12345" }),
    "account-a",
  );
});

test("buildRecordKeyToAccountIndex separates two different accounts' record keys correctly — no cross-account leakage", () => {
  const rb2bIdentityA: IdentityLinkObservation = {
    provider: "rb2b",
    sourceRecordId: "evt-a",
    identityKey: "domain",
    identityValue: "account-a.example",
  };
  const rb2bIdentityB: IdentityLinkObservation = {
    provider: "rb2b",
    sourceRecordId: "evt-b",
    identityKey: "domain",
    identityValue: "account-b.example",
  };
  const aliases: AccountAliasRowWithAccountId[] = [
    { accountId: "account-a", aliasType: "domain", normalizedValue: "account-a.example" },
    { accountId: "account-b", aliasType: "domain", normalizedValue: "account-b.example" },
  ];
  const index = buildRecordKeyToAccountIndex([rb2bIdentityA, rb2bIdentityB], aliases);

  assert.equal(
    lookupAccountForRecord(index, { provider: "rb2b", sourceRecordId: "evt-a" }),
    "account-a",
  );
  assert.equal(
    lookupAccountForRecord(index, { provider: "rb2b", sourceRecordId: "evt-b" }),
    "account-b",
  );
});

test("buildRecordKeyToAccountIndex leaves a record key with no matching alias unresolved", () => {
  const index = buildRecordKeyToAccountIndex([HUBSPOT_DOMAIN_IDENTITY], []);
  assert.equal(
    lookupAccountForRecord(index, { provider: "hubspot", sourceRecordId: "12345" }),
    undefined,
  );
});

test("buildRecordKeyToAccountIndex excludes a record key whose alias value is ambiguously claimed by two accounts — never guessed", () => {
  const aliases: AccountAliasRowWithAccountId[] = [
    { accountId: "account-a", aliasType: "domain", normalizedValue: "acme.com" },
    { accountId: "account-b", aliasType: "domain", normalizedValue: "acme.com" },
  ];
  const index = buildRecordKeyToAccountIndex([HUBSPOT_DOMAIN_IDENTITY], aliases);
  assert.equal(
    lookupAccountForRecord(index, { provider: "hubspot", sourceRecordId: "12345" }),
    undefined,
  );
});
