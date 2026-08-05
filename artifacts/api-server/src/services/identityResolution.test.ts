// Unit tests for the runtime identity-resolution service.
//
// Two kinds of coverage:
//  - Pure-function tests (buildAccountKey, buildExternalAccountKey,
//    selectPersonExternalIdForPersistence, composeBinding,
//    isSemanticallyEquivalent, buildCompanyIdentifierPairs) — no
//    database of any kind, real or fake.
//  - Orchestration tests against resolveSignal() itself, using a fake
//    queue-based query-chain db — same shape as
//    ../services/accountFacts.test.ts's makeFakeDb, extended with
//    .for() (row-lock hint) since resolveSignal locks the signal row via
//    SELECT ... FOR UPDATE. Real Postgres concurrency (row locks, actual
//    unique-constraint/deadlock races) is NOT exercised here — see
//    ../routes/signalResolution.integration.test.ts for that.
//
// Run with: tsx --test src/services/identityResolution.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import type { NormalizedSignalV1 } from "@workspace/identity";
import {
  resolveSignal,
  buildAccountKey,
  buildExternalAccountKey,
  selectPersonExternalIdForPersistence,
  buildCompanyIdentifierPairs,
  composeBinding,
  isSemanticallyEquivalent,
  RESOLVER_VERSION,
  type AccountResolution,
  type PersonResolution,
} from "./identityResolution.js";

type Db = NodePgDatabase<typeof schema>;

const SIGNAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const LEGACY_ACCOUNT_ID = "66666666-6666-4666-8666-666666666666";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PERSON_ID = "44444444-4444-4444-8444-444444444444";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";

// ---------------------------------------------------------------------
// Pure-function tests
// ---------------------------------------------------------------------

test("buildAccountKey uses the dom: prefix convention (not a bare domain) when a domain exists", () => {
  assert.equal(buildAccountKey("acme.com", { hubspot: "123" }, "hubspot"), "dom:acme.com");
});

test("buildAccountKey (external-only) delegates to buildExternalAccountKey using the source-aligned entry", () => {
  const key = buildAccountKey(null, { salesforce: "SF-1", hubspot: "HS-1" }, "hubspot");
  assert.equal(key, buildExternalAccountKey("hubspot", "HS-1"));
});

test("buildAccountKey (external-only) falls back to the lexicographically-first source key when none aligns", () => {
  const key = buildAccountKey(null, { zendesk: "Z-1", acme: "A-1" }, "some-other-source");
  assert.equal(key, buildExternalAccountKey("acme", "A-1"));
});

test("buildExternalAccountKey: swapped delimiter placement across source/value produces different keys", () => {
  const key1 = buildExternalAccountKey("a:b", "c");
  const key2 = buildExternalAccountKey("a", "b:c");
  assert.notEqual(key1, key2);
});

test("buildExternalAccountKey: the same tuple always produces the same key", () => {
  assert.equal(buildExternalAccountKey("hubspot", "123"), buildExternalAccountKey("hubspot", "123"));
});

test("buildExternalAccountKey: very long source/id values still produce a fixed-length, well-formed key", () => {
  const key = buildExternalAccountKey("x".repeat(5000), "y".repeat(5000));
  assert.match(key, /^ext:v1:[0-9a-f]{64}$/);
});

test("buildExternalAccountKey: format is ext:v1:<64-hex-char sha256>", () => {
  const key = buildExternalAccountKey("hubspot", "123");
  assert.match(key, /^ext:v1:[0-9a-f]{64}$/);
});

test("selectPersonExternalIdForPersistence prefers the source-aligned entry", () => {
  assert.deepEqual(
    selectPersonExternalIdForPersistence("hubspot", { salesforce: "SF-1", hubspot: "HS-1" }),
    { source: "hubspot", value: "HS-1" },
  );
});

test("selectPersonExternalIdForPersistence uses the sole entry when none aligns", () => {
  assert.deepEqual(selectPersonExternalIdForPersistence("hubspot", { salesforce: "SF-1" }), {
    source: "salesforce",
    value: "SF-1",
  });
});

test("selectPersonExternalIdForPersistence returns null for multiple non-aligned entries", () => {
  assert.equal(
    selectPersonExternalIdForPersistence("hubspot", { salesforce: "SF-1", zendesk: "Z-1" }),
    null,
  );
});

test("selectPersonExternalIdForPersistence returns null when no external ids exist", () => {
  assert.equal(selectPersonExternalIdForPersistence("hubspot", {}), null);
});

test("buildCompanyIdentifierPairs never includes company name", () => {
  const pairs = buildCompanyIdentifierPairs({
    domain: "acme.com",
    name: "Acme Inc",
    externalIds: { HubSpot: "123" },
  });
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((p) => p.aliasType !== "name"));
});

test("buildCompanyIdentifierPairs is empty for name-only or fully empty company evidence", () => {
  assert.deepEqual(buildCompanyIdentifierPairs({ domain: null, name: "Acme Inc", externalIds: {} }), []);
  assert.deepEqual(buildCompanyIdentifierPairs({ domain: null, name: null, externalIds: {} }), []);
});

test("buildCompanyIdentifierPairs returns a deterministic, insertion-order-independent sort", () => {
  const companyA = { domain: null, name: null, externalIds: { zzz: "1", aaa: "2" } };
  const companyB = { domain: null, name: null, externalIds: { aaa: "2", zzz: "1" } };
  const pairsA = buildCompanyIdentifierPairs(companyA);
  const pairsB = buildCompanyIdentifierPairs(companyB);
  assert.deepEqual(pairsA, pairsB);
  assert.equal(pairsA[0]!.source, "aaa");
  assert.equal(pairsA[1]!.source, "zzz");
});

test("buildCompanyIdentifierPairs sorts the domain pair before external_id pairs (aliasType ordering)", () => {
  const pairs = buildCompanyIdentifierPairs({ domain: "acme.com", name: null, externalIds: { hubspot: "1" } });
  assert.equal(pairs[0]!.aliasType, "domain");
  assert.equal(pairs[1]!.aliasType, "external_id:hubspot");
});

function resolvedAccount(overrides: Partial<Extract<AccountResolution, { outcome: "resolved" }>> = {}): AccountResolution {
  return { outcome: "resolved", accountId: ACCOUNT_ID, matchAction: "matched", methodToken: "account_domain", ...overrides };
}

test("composeBinding: unresolved account short-circuits to outcome=unresolved/resolutionLevel=anonymous", () => {
  const binding = composeBinding(
    { outcome: "unresolved", reasonToken: "no_strong_company_identity", candidateMatches: null },
    { attempted: false },
    "anonymous",
  );
  assert.equal(binding.outcome, "unresolved");
  assert.equal(binding.resolutionLevel, "anonymous");
  assert.equal(binding.accountId, null);
  assert.equal(binding.personId, null);
  assert.equal(binding.confidence, "low");
  assert.equal(binding.resolutionMethod, "no_strong_company_identity");
});

test("composeBinding: account resolved, person not attempted -> account_resolved/company", () => {
  const binding = composeBinding(resolvedAccount(), { attempted: false }, "company");
  assert.equal(binding.outcome, "account_resolved");
  assert.equal(binding.resolutionLevel, "company");
  assert.equal(binding.personId, null);
  assert.equal(binding.personMatchAction, null);
  assert.equal(binding.confidence, "high");
  assert.equal(binding.resolutionMethod, "account_domain");
});

test("composeBinding: account resolved, person conflict -> account_resolved (not unresolved), high confidence", () => {
  const personResolution: PersonResolution = {
    attempted: true,
    outcome: "unresolved",
    reasonToken: "person_identifier_conflict",
    candidateMatches: null,
  };
  const binding = composeBinding(resolvedAccount({ matchAction: "created", methodToken: "account_created" }), personResolution, "contact");
  assert.equal(binding.outcome, "account_resolved");
  assert.equal(binding.resolutionLevel, "company");
  assert.equal(binding.personId, null);
  assert.equal(binding.reason, "person_identifier_conflict");
  assert.equal(binding.resolutionMethod, "account_created+person_identifier_conflict");
  assert.equal(binding.confidence, "high");
});

test("composeBinding: person resolved with observedResolutionLevel known_crm_contact -> resolutionLevel known_crm_contact", () => {
  const personResolution: PersonResolution = {
    attempted: true,
    outcome: "resolved",
    personId: PERSON_ID,
    matchAction: "matched",
    methodToken: "person_work_email",
  };
  const binding = composeBinding(resolvedAccount(), personResolution, "known_crm_contact");
  assert.equal(binding.outcome, "person_resolved");
  assert.equal(binding.resolutionLevel, "known_crm_contact");
  assert.equal(binding.resolutionMethod, "account_domain+person_work_email");
});

test("composeBinding: person resolved with observedResolutionLevel contact -> resolutionLevel contact", () => {
  const personResolution: PersonResolution = {
    attempted: true,
    outcome: "resolved",
    personId: PERSON_ID,
    matchAction: "created",
    methodToken: "person_created",
  };
  const binding = composeBinding(resolvedAccount({ matchAction: "created", methodToken: "account_created" }), personResolution, "contact");
  assert.equal(binding.resolutionLevel, "contact");
  assert.equal(binding.resolutionMethod, "account_created+person_created");
});

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "account_resolved" as const,
    resolutionLevel: "company" as const,
    accountId: ACCOUNT_ID,
    personId: null,
    reason: null,
    candidateMatches: null,
    ...overrides,
  };
}

test("isSemanticallyEquivalent: ignores accountMatchAction/personMatchAction differences (created vs matched)", () => {
  const latest = baseEvent();
  const candidate = composeBinding(resolvedAccount({ matchAction: "matched" }), { attempted: false }, "company");
  assert.ok(isSemanticallyEquivalent(latest, candidate));
});

test("isSemanticallyEquivalent: unresolved -> unresolved with the same reason and no candidates is equivalent", () => {
  const latest = baseEvent({
    outcome: "unresolved",
    resolutionLevel: "anonymous",
    accountId: null,
    reason: "no_strong_company_identity",
  });
  const candidate = composeBinding(
    { outcome: "unresolved", reasonToken: "no_strong_company_identity", candidateMatches: null },
    { attempted: false },
    "anonymous",
  );
  assert.ok(isSemanticallyEquivalent(latest, candidate));
});

test("isSemanticallyEquivalent: unresolved -> resolved (new evidence) is NOT equivalent", () => {
  const latest = baseEvent({
    outcome: "unresolved",
    resolutionLevel: "anonymous",
    accountId: null,
    reason: "no_strong_company_identity",
  });
  const candidate = composeBinding(resolvedAccount(), { attempted: false }, "company");
  assert.equal(isSemanticallyEquivalent(latest, candidate), false);
});

test("isSemanticallyEquivalent: account_resolved -> person_resolved is NOT equivalent", () => {
  const latest = baseEvent();
  const personResolution: PersonResolution = {
    attempted: true,
    outcome: "resolved",
    personId: PERSON_ID,
    matchAction: "matched",
    methodToken: "person_work_email",
  };
  const candidate = composeBinding(resolvedAccount(), personResolution, "contact");
  assert.equal(isSemanticallyEquivalent(latest, candidate), false);
});

test("isSemanticallyEquivalent: unresolved conflict with a genuinely different candidate set is NOT equivalent", () => {
  const latest = baseEvent({
    outcome: "unresolved",
    resolutionLevel: "anonymous",
    accountId: null,
    reason: "account_identifier_conflict",
    candidateMatches: [{ entityType: "account", identifierType: "domain", matchedId: ACCOUNT_ID }],
  });
  const candidate = composeBinding(
    {
      outcome: "unresolved",
      reasonToken: "account_identifier_conflict",
      candidateMatches: [
        { entityType: "account", identifierType: "domain", matchedId: ACCOUNT_ID },
        { entityType: "account", identifierType: "external_id", matchedId: OTHER_ACCOUNT_ID, source: "hubspot" },
      ],
    },
    { attempted: false },
    "anonymous",
  );
  assert.equal(isSemanticallyEquivalent(latest, candidate), false);
});

// ---------------------------------------------------------------------
// Fake db — a queue of canned responses, one per root select()/insert()
// call, consumed in call order. Same shape as
// ../services/accountFacts.test.ts's makeFakeDb, extended with .for()
// (resolveSignal locks the signal row via SELECT ... FOR UPDATE) and
// stub update()/delete() methods that throw immediately — this service
// must never issue either against any table, and a thrown "not
// supported" error is a much louder failure than a silent no-op would be.
// ---------------------------------------------------------------------

interface FakeQueryChain {
  from(...args: unknown[]): FakeQueryChain;
  where(...args: unknown[]): FakeQueryChain;
  orderBy(...args: unknown[]): FakeQueryChain;
  limit(...args: unknown[]): FakeQueryChain;
  for(...args: unknown[]): FakeQueryChain;
  values(...args: unknown[]): FakeQueryChain;
  onConflictDoNothing(...args: unknown[]): FakeQueryChain;
  onConflictDoUpdate(...args: unknown[]): FakeQueryChain;
  returning(...args: unknown[]): FakeQueryChain;
  then(resolve: (value: unknown) => void, reject?: (error: unknown) => void): void;
}

interface FakeDbSurface {
  select(...args: unknown[]): FakeQueryChain;
  insert(...args: unknown[]): FakeQueryChain;
  update(...args: unknown[]): never;
  delete(...args: unknown[]): never;
  transaction<T>(cb: (tx: FakeDbSurface) => Promise<T>): Promise<T>;
}

function makeFakeDb(queue: unknown[]): { db: Db; calls: string[] } {
  let i = 0;
  const calls: string[] = [];

  function chain(): FakeQueryChain {
    const result: FakeQueryChain = {
      from: (...args) => record("from", args, result),
      where: (...args) => record("where", args, result),
      orderBy: (...args) => record("orderBy", args, result),
      limit: (...args) => record("limit", args, result),
      for: (...args) => record("for", args, result),
      values: (...args) => record("values", args, result),
      onConflictDoNothing: (...args) => record("onConflictDoNothing", args, result),
      onConflictDoUpdate: (...args) => record("onConflictDoUpdate", args, result),
      returning: (...args) => record("returning", args, result),
      then: (resolve, reject) => {
        const next = queue[i++];
        if (typeof next === "function") {
          try {
            resolve((next as () => unknown)());
          } catch (err) {
            (reject ?? (() => {}))(err);
          }
          return;
        }
        Promise.resolve(next).then(resolve, reject);
      },
    };
    return result;
  }

  function record(method: string, _args: unknown[], chainResult: FakeQueryChain): FakeQueryChain {
    calls.push(method);
    return chainResult;
  }

  const fakeDb: FakeDbSurface = {
    select: (...args) => {
      calls.push("select");
      return chain();
    },
    insert: (...args) => {
      calls.push("insert");
      return chain();
    },
    update: () => {
      throw new Error("identityResolution must never call db.update()");
    },
    delete: () => {
      throw new Error("identityResolution must never call db.delete()");
    },
    transaction: async (cb) => cb(fakeDb),
  };

  return { db: fakeDb as unknown as Db, calls };
}

function pgUniqueViolation(constraint: string): Error & { code: string; constraint: string } {
  const err = new Error(`duplicate key value violates unique constraint "${constraint}"`) as Error & {
    code: string;
    constraint: string;
  };
  err.code = "23505";
  err.constraint = constraint;
  return err;
}

// Mimics drizzle-orm's real wrapping: a DrizzleQueryError with no
// code/constraint of its own, whose `.cause` is the raw pg
// DatabaseError-shaped object that actually carries them.
function wrappedPgError(inner: Error): Error {
  const wrapper = new Error(`Failed query: ...`) as Error & { cause?: unknown };
  wrapper.name = "DrizzleQueryError";
  wrapper.cause = inner;
  return wrapper;
}

function pgDeadlock(): Error & { code: string } {
  // Real Postgres deadlock errors carry SQLSTATE 40P01 and no
  // `constraint` field at all — there's no single "losing" constraint,
  // just a lock-ordering cycle.
  const err = new Error("deadlock detected") as Error & { code: string };
  err.code = "40P01";
  return err;
}

function syntheticNormalizedSignal(overrides: Partial<NormalizedSignalV1> = {}): NormalizedSignalV1 {
  return {
    schemaVersion: "v1",
    source: "hubspot",
    sourceEventId: "evt_123",
    occurredAt: "2026-01-01T00:00:00Z",
    signalType: "page_view",
    observedResolutionLevel: "anonymous",
    company: { domain: null, name: null, externalIds: {} },
    person: null,
    activity: {
      pageUrl: null,
      signalDetail: null,
      formName: null,
      formStep: null,
      campaignId: null,
      campaignName: null,
      utm: null,
      clickIds: null,
    },
    sourceMetadata: null,
    ...overrides,
  };
}

function syntheticSignalRow(normalizedPayload: NormalizedSignalV1, overrides: Record<string, unknown> = {}) {
  return {
    id: SIGNAL_ID,
    source: normalizedPayload.source,
    sourceEventId: normalizedPayload.sourceEventId,
    occurredAt: new Date(normalizedPayload.occurredAt),
    signalType: normalizedPayload.signalType,
    observedResolutionLevel: normalizedPayload.observedResolutionLevel,
    companyDomain: normalizedPayload.company.domain,
    companyName: normalizedPayload.company.name,
    campaignId: normalizedPayload.activity.campaignId,
    campaignName: normalizedPayload.activity.campaignName,
    schemaVersion: "v1",
    rawPayload: {},
    normalizedPayload,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function syntheticAlias(overrides: Record<string, unknown> = {}) {
  return {
    id: "alias-1",
    accountId: ACCOUNT_ID,
    aliasType: "domain",
    rawValue: "acme.com",
    normalizedValue: "acme.com",
    normalizationStrategy: "domain",
    isStrong: true,
    source: "hubspot",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function syntheticAccountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    accountKey: "dom:acme.com",
    companyDomain: "acme.com",
    companyName: "Acme Inc",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function syntheticPersonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PERSON_ID,
    fullName: "Jane Doe",
    workEmail: "jane@acme.com",
    linkedinUrl: null,
    externalId: null,
    externalIdSource: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function syntheticEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    signalId: SIGNAL_ID,
    outcome: "account_resolved",
    resolutionLevel: "company",
    resolutionMethod: "account_domain",
    confidence: "high",
    resolverVersion: RESOLVER_VERSION,
    candidateMatches: null,
    accountId: ACCOUNT_ID,
    accountMatchAction: "matched",
    personId: null,
    personMatchAction: null,
    matchedAliasType: null,
    matchedAliasValue: null,
    reason: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Orchestration scenarios
// ---------------------------------------------------------------------

test("signal not found -> kind: signal_not_found, no further queries", async () => {
  const { db } = makeFakeDb([[]]);
  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.deepEqual(result, { kind: "signal_not_found" });
});

test("domain account match: existing alias, no missing aliases, no person -> account_resolved/matched", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "acme.com", name: "Acme Inc", externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });

  const { db } = makeFakeDb([
    [signalRow], // select signals FOR UPDATE
    [], // select latest identity_resolution_events
    [alias], // select account_aliases matching domain
    [], // select accounts (legacy/bootstrap compatibility lookup)
    [syntheticEventRow()], // insert identity_resolution_events
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.status, "resolved");
  assert.equal(result.event.accountId, ACCOUNT_ID);
  assert.equal(result.event.accountMatchAction, "matched");
  assert.equal(result.event.outcome, "account_resolved");
});

test("account external-ID match (no domain -> no compatibility lookup): method token reflects it", async () => {
  const normalized = syntheticNormalizedSignal({
    company: { domain: null, name: null, externalIds: { hubspot: "12345" } },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({
    aliasType: "external_id:hubspot",
    rawValue: "12345",
    normalizedValue: "12345",
    normalizationStrategy: "exact",
  });

  const { db, calls } = makeFakeDb([
    [signalRow],
    [],
    [alias],
    [syntheticEventRow({ resolutionMethod: "account_external_id" })],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.resolutionMethod, "account_external_id");
  assert.equal(result.event.accountMatchAction, "matched");
  // No domain -> the legacy/bootstrap compatibility lookup never runs:
  // exactly 2 selects (aliases + latest event) plus the signal lock.
  assert.equal(calls.filter((c) => c === "select").length, 3);
});

test("no-match account creation: new domain creates account + alias", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "newco.com", name: "NewCo", externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [], // no existing alias matches
    [], // no legacy/bootstrap account matches account_key/company_domain either
    [syntheticAccountRow({ id: ACCOUNT_ID, accountKey: "dom:newco.com", companyDomain: "newco.com", companyName: "NewCo" })], // insert accounts
    [{}], // insert account_aliases
    [syntheticEventRow({ accountMatchAction: "created", resolutionMethod: "account_created" })], // insert event
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.accountMatchAction, "created");
  assert.equal(result.event.resolutionMethod, "account_created");
});

test("company-name-only: unresolved, no account created, no alias/account queries at all", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: null, name: "Acme Inc", externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);

  const { db, calls } = makeFakeDb([
    [signalRow],
    [],
    [
      syntheticEventRow({
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        accountId: null,
        accountMatchAction: null,
        resolutionMethod: "no_strong_company_identity",
        reason: "no_strong_company_identity",
        confidence: "low",
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "unresolved");
  assert.equal(result.event.accountId, null);
  assert.equal(calls.filter((c) => c === "select" || c === "insert").length, 3);
});

test("no-company-evidence unresolved: fully anonymous signal", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: null, name: null, externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [
      syntheticEventRow({
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        accountId: null,
        accountMatchAction: null,
        resolutionMethod: "no_strong_company_identity",
        reason: "no_strong_company_identity",
        confidence: "low",
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "unresolved");
});

test("conflicting account identifiers: domain and external id alias-match different accounts -> unresolved", async () => {
  const normalized = syntheticNormalizedSignal({
    company: { domain: "acme.com", name: null, externalIds: { hubspot: "999" } },
  });
  const signalRow = syntheticSignalRow(normalized);
  const domainAlias = syntheticAlias({ accountId: ACCOUNT_ID, aliasType: "domain", normalizedValue: "acme.com" });
  const externalAlias = syntheticAlias({
    accountId: OTHER_ACCOUNT_ID,
    aliasType: "external_id:hubspot",
    rawValue: "999",
    normalizedValue: "999",
    normalizationStrategy: "exact",
  });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [domainAlias, externalAlias],
    [], // compatibility lookup finds nothing additional
    [
      syntheticEventRow({
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        accountId: null,
        accountMatchAction: null,
        resolutionMethod: "account_identifier_conflict",
        reason: "account_identifier_conflict",
        confidence: "low",
        candidateMatches: [
          { entityType: "account", identifierType: "domain", matchedId: ACCOUNT_ID },
          { entityType: "account", identifierType: "external_id", matchedId: OTHER_ACCOUNT_ID, source: "hubspot" },
        ],
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "unresolved");
  assert.equal(result.event.reason, "account_identifier_conflict");
});

// ---------------------------------------------------------------------
// CORRECTION 1 — legacy/bootstrap account compatibility
// ---------------------------------------------------------------------

test("legacy dom:<domain> account with no alias is reused; its missing domain alias is attached; no duplicate account is created", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "acme.com", name: "Acme New", externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  const legacyAccount = syntheticAccountRow({ id: LEGACY_ACCOUNT_ID, accountKey: "dom:acme.com", companyDomain: "acme.com", companyName: "Acme Legacy" });

  const { db, calls } = makeFakeDb([
    [signalRow],
    [],
    [], // no account_aliases row exists yet — this account predates Unit 3
    [legacyAccount], // found via accounts.account_key = "dom:acme.com"
    [{}], // insert the missing domain alias onto the legacy account
    [syntheticEventRow({ accountId: LEGACY_ACCOUNT_ID, accountMatchAction: "matched", resolutionMethod: "account_domain" })],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.accountId, LEGACY_ACCOUNT_ID);
  assert.equal(result.event.accountMatchAction, "matched");
  // Exactly one insert into accounts would have consumed a queue slot
  // this test never provided — the fact that resolution succeeded with
  // only the two queued inserts (alias, event) proves no account row was
  // created.
  assert.equal(calls.filter((c) => c === "insert").length, 2);
});

test("legacy bare-domain account key is also reused for compatibility", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "acme.com", name: null, externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  const legacyAccount = syntheticAccountRow({ id: LEGACY_ACCOUNT_ID, accountKey: "acme.com", companyDomain: "acme.com" });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [],
    [legacyAccount], // found via accounts.account_key = "acme.com" (bare)
    [{}],
    [syntheticEventRow({ accountId: LEGACY_ACCOUNT_ID, accountMatchAction: "matched" })],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.accountId, LEGACY_ACCOUNT_ID);
  assert.equal(result.event.accountMatchAction, "matched");
});

test("two existing accounts sharing the same company_domain produce an unresolved account_identifier_conflict", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "acme.com", name: null, externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  const accountA = syntheticAccountRow({ id: ACCOUNT_ID, accountKey: "dom:acme.com", companyDomain: "acme.com" });
  const accountB = syntheticAccountRow({ id: OTHER_ACCOUNT_ID, accountKey: "some-other-legacy-key", companyDomain: "acme.com" });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [], // no aliases at all
    [accountA, accountB], // both match company_domain = "acme.com"
    [
      syntheticEventRow({
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        accountId: null,
        accountMatchAction: null,
        resolutionMethod: "account_identifier_conflict",
        reason: "account_identifier_conflict",
        confidence: "low",
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "unresolved");
  assert.equal(result.event.reason, "account_identifier_conflict");
});

test("alias-matched account conflicting with a legacy direct-account candidate also produces unresolved conflict", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "acme.com", name: null, externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ accountId: ACCOUNT_ID, aliasType: "domain", normalizedValue: "acme.com" });
  const legacyAccount = syntheticAccountRow({ id: OTHER_ACCOUNT_ID, accountKey: "dom:acme.com", companyDomain: "acme.com" });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [alias], // alias points to ACCOUNT_ID
    [legacyAccount], // direct compatibility lookup finds a DIFFERENT account
    [
      syntheticEventRow({
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        accountId: null,
        accountMatchAction: null,
        resolutionMethod: "account_identifier_conflict",
        reason: "account_identifier_conflict",
        confidence: "low",
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "unresolved");
  assert.equal(result.event.reason, "account_identifier_conflict");
});

// ---------------------------------------------------------------------
// Person resolution (unaffected in shape by Correction 1, but every
// domain-bearing signal below now also queues the compatibility select)
// ---------------------------------------------------------------------

test("email person match: account resolves, person matches by work email -> person_resolved/contact", async () => {
  const normalized = syntheticNormalizedSignal({
    observedResolutionLevel: "contact",
    company: { domain: "acme.com", name: "Acme Inc", externalIds: {} },
    person: { fullName: "Jane Doe", workEmail: "jane@acme.com", title: null, linkedinUrl: null, externalIds: {} },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });
  const personRow = syntheticPersonRow({ workEmail: "jane@acme.com" });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [alias], // account alias lookup
    [], // account compatibility lookup
    [personRow], // people lookup by email
    [{}], // account_people upsert
    [syntheticEventRow({ outcome: "person_resolved", resolutionLevel: "contact", personId: PERSON_ID, personMatchAction: "matched", resolutionMethod: "account_domain+person_work_email" })],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "person_resolved");
  assert.equal(result.event.personId, PERSON_ID);
  assert.equal(result.event.resolutionLevel, "contact");
});

test("provider external-ID person match", async () => {
  const normalized = syntheticNormalizedSignal({
    observedResolutionLevel: "known_crm_contact",
    company: { domain: "acme.com", name: null, externalIds: {} },
    person: { fullName: null, workEmail: null, title: null, linkedinUrl: null, externalIds: { hubspot: "p-1" } },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });
  const personRow = syntheticPersonRow({ workEmail: null, externalId: "p-1", externalIdSource: "hubspot" });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [alias],
    [],
    [personRow],
    [{}],
    [syntheticEventRow({ outcome: "person_resolved", resolutionLevel: "known_crm_contact", personId: PERSON_ID, personMatchAction: "matched", resolutionMethod: "account_domain+person_external_id" })],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.resolutionLevel, "known_crm_contact");
  assert.equal(result.event.personMatchAction, "matched");
});

test("new person from email: no existing match -> creates person", async () => {
  const normalized = syntheticNormalizedSignal({
    observedResolutionLevel: "contact",
    company: { domain: "acme.com", name: null, externalIds: {} },
    person: { fullName: "Jane Doe", workEmail: "jane@acme.com", title: "VP Eng", linkedinUrl: null, externalIds: {} },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [alias],
    [],
    [], // no existing person match
    [syntheticPersonRow({ workEmail: "jane@acme.com" })], // insert people
    [{}], // account_people upsert
    [syntheticEventRow({ outcome: "person_resolved", resolutionLevel: "contact", personId: PERSON_ID, personMatchAction: "created", resolutionMethod: "account_domain+person_created" })],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.personMatchAction, "created");
});

test("new person from sole/source-aligned external id (no email)", async () => {
  const normalized = syntheticNormalizedSignal({
    observedResolutionLevel: "known_crm_contact",
    company: { domain: "acme.com", name: null, externalIds: {} },
    person: { fullName: "Jane Doe", workEmail: null, title: null, linkedinUrl: null, externalIds: { hubspot: "p-9" } },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [alias],
    [],
    [],
    [syntheticPersonRow({ workEmail: null, externalId: "p-9", externalIdSource: "hubspot" })],
    [{}],
    [syntheticEventRow({ outcome: "person_resolved", resolutionLevel: "known_crm_contact", personId: PERSON_ID, personMatchAction: "created", resolutionMethod: "account_domain+person_created" })],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.personMatchAction, "created");
  assert.equal(result.event.personId, PERSON_ID);
});

test("multiple non-source-aligned external ids without email do not create a person -> account_resolved", async () => {
  const normalized = syntheticNormalizedSignal({
    observedResolutionLevel: "contact",
    company: { domain: "acme.com", name: null, externalIds: {} },
    person: {
      fullName: "Jane Doe",
      workEmail: null,
      title: null,
      linkedinUrl: null,
      externalIds: { salesforce: "SF-1", zendesk: "Z-1" },
    },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [alias],
    [],
    [], // no existing person matches either external id
    [
      syntheticEventRow({
        outcome: "account_resolved",
        resolutionLevel: "company",
        personId: null,
        personMatchAction: null,
        resolutionMethod: "account_domain+no_strong_person_identity",
        reason: "no_strong_person_identity",
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "account_resolved");
  assert.equal(result.event.personId, null);
});

test("full-name-only does not create a person -> account_resolved", async () => {
  const normalized = syntheticNormalizedSignal({
    observedResolutionLevel: "contact",
    company: { domain: "acme.com", name: null, externalIds: {} },
    person: { fullName: "Jane Doe", workEmail: null, title: null, linkedinUrl: "https://linkedin.com/in/jane", externalIds: {} },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });

  const { db, calls } = makeFakeDb([
    [signalRow],
    [],
    [alias],
    [],
    [
      syntheticEventRow({
        outcome: "account_resolved",
        personId: null,
        personMatchAction: null,
        resolutionMethod: "account_domain+no_strong_person_identity",
        reason: "no_strong_person_identity",
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "account_resolved");
  assert.equal(result.event.personId, null);
  // No `people` select/insert at all — fullName/linkedin alone never
  // even queries the people table.
  assert.equal(calls.filter((c) => c === "select").length, 4);
});

test("conflicting person identifiers falls back to account_resolved (retains resolved account)", async () => {
  const normalized = syntheticNormalizedSignal({
    observedResolutionLevel: "contact",
    company: { domain: "acme.com", name: null, externalIds: {} },
    person: { fullName: null, workEmail: "jane@acme.com", title: null, linkedinUrl: null, externalIds: { hubspot: "p-1" } },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });
  const emailMatch = syntheticPersonRow({ id: PERSON_ID, workEmail: "jane@acme.com" });
  const externalIdMatch = syntheticPersonRow({
    id: OTHER_PERSON_ID,
    workEmail: null,
    externalId: "p-1",
    externalIdSource: "hubspot",
  });

  const { db } = makeFakeDb([
    [signalRow],
    [],
    [alias],
    [],
    [emailMatch, externalIdMatch],
    [
      syntheticEventRow({
        outcome: "account_resolved",
        personId: null,
        personMatchAction: null,
        resolutionMethod: "account_domain+person_identifier_conflict",
        reason: "person_identifier_conflict",
        candidateMatches: [
          { entityType: "person", identifierType: "work_email", matchedId: PERSON_ID },
          { entityType: "person", identifierType: "external_id", matchedId: OTHER_PERSON_ID, source: "hubspot" },
        ],
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.event.outcome, "account_resolved");
  assert.equal(result.event.accountId, ACCOUNT_ID);
  assert.equal(result.event.personId, null);
  assert.equal(result.event.reason, "person_identifier_conflict");
});

// ---------------------------------------------------------------------
// CORRECTION 2 — replay must be write-free
// ---------------------------------------------------------------------

test("exact replay ignoring created-vs-matched: performs NO write query at all (zero insert calls)", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "acme.com", name: "Acme Inc", externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  // The account already exists (e.g. created by this same signal's first
  // resolve call) — this attempt matches it, but the latest event
  // recorded "created".
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });
  const latestEvent = syntheticEventRow({ accountMatchAction: "created", resolutionMethod: "account_created" });

  const { db, calls } = makeFakeDb([
    [signalRow],
    [latestEvent],
    [alias],
    [], // compatibility lookup — no additional candidate
    // No insert into identity_resolution_events, no alias insert, no
    // account_people upsert is expected — if the implementation issued
    // any of those, the queue would run dry and the test would throw.
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.status, "replayed");
  assert.equal(result.event.id, EVENT_ID);
  assert.equal(calls.filter((c) => c === "insert").length, 0, "a pure replay must perform zero INSERT/UPDATE/DELETE statements");
  assert.equal(calls.filter((c) => c === "onConflictDoNothing" || c === "onConflictDoUpdate").length, 0);
});

test("exact replay of a person_resolved binding performs no account_people upsert or alias insert", async () => {
  const normalized = syntheticNormalizedSignal({
    observedResolutionLevel: "contact",
    company: { domain: "acme.com", name: null, externalIds: {} },
    person: { fullName: "Jane Doe", workEmail: "jane@acme.com", title: "VP Eng", linkedinUrl: null, externalIds: {} },
  });
  const signalRow = syntheticSignalRow(normalized);
  const alias = syntheticAlias({ aliasType: "domain", normalizedValue: "acme.com" });
  const personRow = syntheticPersonRow({ workEmail: "jane@acme.com" });
  const latestEvent = syntheticEventRow({
    outcome: "person_resolved",
    resolutionLevel: "contact",
    personId: PERSON_ID,
    personMatchAction: "created", // first time this person was created; this attempt will only match
    resolutionMethod: "account_domain+person_created",
  });

  const { db, calls } = makeFakeDb([
    [signalRow],
    [latestEvent],
    [alias],
    [],
    [personRow],
    // No account_people insert/upsert call, no event insert — pure replay.
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.status, "replayed");
  assert.equal(calls.filter((c) => c === "insert").length, 0);
});

test("a genuinely changed binding (conflict clears) still applies writes and appends a new event", async () => {
  const normalized = syntheticNormalizedSignal({
    company: { domain: "acme.com", name: null, externalIds: { hubspot: "999" } },
  });
  const signalRow = syntheticSignalRow(normalized);
  const latestEvent = syntheticEventRow({
    outcome: "unresolved",
    resolutionLevel: "anonymous",
    accountId: null,
    accountMatchAction: null,
    resolutionMethod: "no_strong_company_identity",
    reason: "no_strong_company_identity",
    confidence: "low",
  });
  const domainAlias = syntheticAlias({ accountId: ACCOUNT_ID, aliasType: "domain", normalizedValue: "acme.com" });
  const externalAlias = syntheticAlias({
    accountId: OTHER_ACCOUNT_ID,
    aliasType: "external_id:hubspot",
    rawValue: "999",
    normalizedValue: "999",
    normalizationStrategy: "exact",
  });

  const { db, calls } = makeFakeDb([
    [signalRow],
    [latestEvent],
    [domainAlias, externalAlias],
    [], // compatibility lookup
    [
      syntheticEventRow({
        outcome: "unresolved",
        resolutionLevel: "anonymous",
        accountId: null,
        accountMatchAction: null,
        resolutionMethod: "account_identifier_conflict",
        reason: "account_identifier_conflict",
      }),
    ],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.status, "resolved");
  assert.equal(result.event.reason, "account_identifier_conflict");
  assert.equal(calls.filter((c) => c === "insert").length, 1, "the event insert is the only write for an unresolved-to-unresolved transition");
});

// ---------------------------------------------------------------------
// CORRECTION 3 — bounded retry: known 23505s and deadlocks only
// ---------------------------------------------------------------------

test("account-key unique collision does not retry forever: bounded attempts, then the original error propagates", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "perpetual-collision.example", name: null, externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  const violation = wrappedPgError(pgUniqueViolation("accounts_account_key_unique"));

  const oneAttemptQueue = () => [
    [signalRow],
    [],
    [],
    [],
    () => {
      throw violation;
    },
  ];

  const { db, calls } = makeFakeDb([...oneAttemptQueue(), ...oneAttemptQueue(), ...oneAttemptQueue()]);

  await assert.rejects(() => resolveSignal({ db, signalId: SIGNAL_ID, maxAttempts: 3 }), (err: unknown) => err === violation);
  // Exactly 3 attempts, 5 db round trips each — never a 4th attempt, and
  // never silently swallowed. (calls also records chain-builder methods
  // like .from()/.where(), so root round trips are select/insert only.)
  assert.equal(calls.filter((c) => c === "select" || c === "insert").length, 15);
});

test("a PostgreSQL deadlock (40P01) is treated as a bounded retryable race and converges on the next attempt", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "deadlock-then-ok.example", name: "DeadlockCo", externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  const deadlock = wrappedPgError(pgDeadlock());

  const { db, calls } = makeFakeDb([
    // Attempt 1: hits a deadlock while creating the account.
    [signalRow],
    [],
    [],
    [],
    () => {
      throw deadlock;
    },
    // Attempt 2: succeeds.
    [signalRow],
    [],
    [],
    [],
    [syntheticAccountRow({ id: ACCOUNT_ID, accountKey: "dom:deadlock-then-ok.example", companyDomain: "deadlock-then-ok.example" })],
    [{}],
    [syntheticEventRow({ accountMatchAction: "created", resolutionMethod: "account_created" })],
  ]);

  const result = await resolveSignal({ db, signalId: SIGNAL_ID });
  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") throw new Error("unreachable");
  assert.equal(result.status, "resolved");
  assert.equal(result.event.accountMatchAction, "created");
  assert.equal(calls.filter((c) => c === "select" || c === "insert").length, 12);
});

test("an unrelated database error (not a known constraint, not a deadlock) propagates immediately without retry", async () => {
  const normalized = syntheticNormalizedSignal({ company: { domain: "unrelated-error.example", name: null, externalIds: {} } });
  const signalRow = syntheticSignalRow(normalized);
  const unrelated = wrappedPgError(pgUniqueViolation("some_other_unrelated_constraint"));

  const { db, calls } = makeFakeDb([
    [signalRow],
    [],
    [],
    [],
    () => {
      throw unrelated;
    },
  ]);

  await assert.rejects(() => resolveSignal({ db, signalId: SIGNAL_ID }), (err: unknown) => err === unrelated);
  // No retry at all — exactly one attempt's worth of calls.
  assert.equal(calls.filter((c) => c === "select" || c === "insert").length, 5);
});
