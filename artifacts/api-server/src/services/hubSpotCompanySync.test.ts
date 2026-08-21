import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import type { ProviderObservationV1 } from "@workspace/observation";
import {
  syncHubSpotCompany,
  type FetchHubSpotOwnerFn,
  type RecordObservationFn,
} from "./hubSpotCompanySync.js";
import type { BootstrapHubSpotCompanyIdentityArgs } from "./hubSpotCompanyIdentity.js";
import type { HubSpotCompany, HubSpotOwner } from "../lib/hubSpotClient.js";

type Db = NodePgDatabase<typeof schema>;
const db = {} as Db;

function minimalHubSpotCompany(
  overrides: Partial<HubSpotCompany> = {},
): HubSpotCompany {
  return {
    id: "12345",
    domain: "example.com",
    name: "Example",
    industry: null,
    country: null,
    numberOfEmployees: null,
    annualRevenue: null,
    lifecycleStage: null,
    hubspotOwnerId: null,
    ...overrides,
  };
}

// A fake that never touches a database — records every observation it was
// asked to persist and always reports "created", mirroring the DI pattern
// already used for fetchCompanyFn/bootstrapCompanyIdentityFn.
function fakeRecordObservationFn(): {
  fn: RecordObservationFn;
  recorded: ProviderObservationV1[];
} {
  const recorded: ProviderObservationV1[] = [];
  const fn: RecordObservationFn = async (observation) => {
    recorded.push(observation);
    return {
      outcome: "created",
      observation: {
        id: `synthetic-${recorded.length}`,
        provider: observation.provider,
        sourceRecordId: observation.sourceRecordId,
        observationClass: observation.observationClass,
        semanticKey:
          observation.observationClass === "identity"
            ? observation.identityKey
            : observation.observationClass === "behavioral_signal"
              ? observation.eventType
              : observation.observationClass === "research_intelligence"
                ? observation.findingType
                : observation.canonicalField,
        identitySubjectType:
          observation.observationClass === "identity" ? observation.subjectType : null,
        identityValue:
          observation.observationClass === "identity" ? observation.identityValue : null,
        rawValue: observation.observationClass === "identity" ? null : observation.rawValue,
        normalizedValue:
          observation.observationClass === "identity" ? null : observation.normalizedValue,
        observedAt: observation.observedAt === null ? null : new Date(observation.observedAt),
        importedAt: new Date(observation.importedAt),
        confidence: observation.confidence,
        evidenceRefs: observation.evidenceRefs as unknown[],
        providerMetadata: observation.providerMetadata,
      },
    } as const;
  };
  return { fn, recorded };
}

test("maps the fetched HubSpot id/domain/name exactly into the canonical bootstrap", async () => {
  const calls: BootstrapHubSpotCompanyIdentityArgs[] = [];
  const { fn: recordObservationFn } = fakeRecordObservationFn();
  const result = await syncHubSpotCompany({
    db,
    companyId: "requested-id",
    recordObservationFn,
    fetchCompanyFn: async (companyId) => {
      assert.equal(companyId, "requested-id");
      return minimalHubSpotCompany({
        id: "returned-id",
        domain: "HTTPS://WWW.Example.COM/about",
        name: "Example",
      });
    },
    bootstrapCompanyIdentityFn: async (args) => {
      calls.push(args);
      return {
        outcome: "created",
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        source: "hubspot",
        attachedAliasTypes: ["domain", "external_id:hubspot"],
      };
    },
  });

  assert.equal(result.outcome, "created");
  assert.deepEqual(calls, [
    {
      db,
      hubspotCompanyId: "returned-id",
      companyDomain: "HTTPS://WWW.Example.COM/about",
      companyName: "Example",
    },
  ]);
});

test("delegates null names and explicit canonical conflicts without guessing", async () => {
  const { fn: recordObservationFn } = fakeRecordObservationFn();
  const result = await syncHubSpotCompany({
    db,
    companyId: "12345",
    recordObservationFn,
    fetchCompanyFn: async () => minimalHubSpotCompany({ name: null }),
    bootstrapCompanyIdentityFn: async (args) => {
      assert.equal(args.companyName, null);
      return {
        outcome: "conflict",
        code: "account_identifier_conflict",
        source: "hubspot",
        candidateMatches: [
          {
            entityType: "account",
            identifierType: "domain",
            matchedId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        ],
      };
    },
  });
  assert.equal(result.outcome, "conflict");
});

test("observations are recorded even when identity bootstrap conflicts — persistence is not gated on resolution", async () => {
  const { fn: recordObservationFn, recorded } = fakeRecordObservationFn();
  await syncHubSpotCompany({
    db,
    companyId: "12345",
    recordObservationFn,
    fetchCompanyFn: async () => minimalHubSpotCompany({ industry: "SOFTWARE" }),
    bootstrapCompanyIdentityFn: async () => ({
      outcome: "conflict",
      code: "account_identifier_conflict",
      source: "hubspot",
      candidateMatches: [],
    }),
  });

  // domain identity, external_id identity, and the industry fact all still
  // got recorded despite the conflict.
  assert.ok(recorded.length >= 3);
  assert.ok(
    recorded.some(
      (o) => o.observationClass === "firmographic_fact" && o.canonicalField === "company.industry",
    ),
  );
});

test("repeated calls remain a thin idempotent delegation to the canonical bootstrap", async () => {
  let fetchCalls = 0;
  let bootstrapCalls = 0;
  const run = () => {
    const { fn: recordObservationFn } = fakeRecordObservationFn();
    return syncHubSpotCompany({
      db,
      companyId: "12345",
      recordObservationFn,
      fetchCompanyFn: async () => {
        fetchCalls += 1;
        return minimalHubSpotCompany();
      },
      bootstrapCompanyIdentityFn: async () => {
        bootstrapCalls += 1;
        return {
          outcome: "matched",
          accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          source: "hubspot",
          attachedAliasTypes: [],
        };
      },
    });
  };

  const [first, second] = [await run(), await run()];
  assert.equal(first.outcome, second.outcome);
  if (first.outcome !== "conflict" && second.outcome !== "conflict") {
    assert.equal(first.accountId, second.accountId);
  }
  assert.equal(fetchCalls, 2);
  assert.equal(bootstrapCalls, 2);
});

// ---------------------------------------------------------------------
// M3.5 real-data defect fix — owner display-name resolution during sync.
// ---------------------------------------------------------------------

const DEFAULT_BOOTSTRAP_RESULT = {
  outcome: "created" as const,
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  source: "hubspot" as const,
  attachedAliasTypes: ["domain" as const, "external_id:hubspot" as const],
};

test("when hubspot_owner_id exists, owner lookup happens exactly once and the resolved display name lands in the crm.owner observation's providerMetadata", async () => {
  const { fn: recordObservationFn, recorded } = fakeRecordObservationFn();
  let ownerCalls = 0;
  const fetchOwnerFn: FetchHubSpotOwnerFn = async (ownerId) => {
    ownerCalls += 1;
    assert.equal(ownerId, "999");
    return { id: "999", email: "mark@example.com", firstName: "Mark", lastName: "van der Ree" };
  };

  await syncHubSpotCompany({
    db,
    companyId: "12345",
    recordObservationFn,
    fetchOwnerFn,
    fetchCompanyFn: async () => minimalHubSpotCompany({ hubspotOwnerId: "999" }),
    bootstrapCompanyIdentityFn: async () => DEFAULT_BOOTSTRAP_RESULT,
  });

  assert.equal(ownerCalls, 1);
  const ownerObservation = recorded.find(
    (o) => o.observationClass === "crm_state" && o.canonicalField === "crm.owner",
  );
  assert.ok(ownerObservation);
  assert.equal(ownerObservation!.observationClass, "crm_state");
  if (ownerObservation!.observationClass !== "crm_state") return;
  // The stable id remains the real, untouched canonical value.
  assert.equal(ownerObservation!.rawValue, "999");
  assert.deepEqual(ownerObservation!.providerMetadata, { displayName: "Mark van der Ree" });
});

test("a failed owner lookup does not fail the whole company sync, and the crm.owner observation persists with no display name", async () => {
  const { fn: recordObservationFn, recorded } = fakeRecordObservationFn();
  const fetchOwnerFn: FetchHubSpotOwnerFn = async () => {
    throw new Error("HubSpot owners endpoint unavailable");
  };

  const result = await syncHubSpotCompany({
    db,
    companyId: "12345",
    recordObservationFn,
    fetchOwnerFn,
    fetchCompanyFn: async () => minimalHubSpotCompany({ hubspotOwnerId: "999" }),
    bootstrapCompanyIdentityFn: async () => DEFAULT_BOOTSTRAP_RESULT,
  });

  assert.equal(result.outcome, "created");
  const ownerObservation = recorded.find(
    (o) => o.observationClass === "crm_state" && o.canonicalField === "crm.owner",
  );
  assert.ok(ownerObservation);
  assert.equal(ownerObservation!.observationClass, "crm_state");
  if (ownerObservation!.observationClass !== "crm_state") return;
  assert.equal(ownerObservation!.rawValue, "999");
  assert.equal(ownerObservation!.providerMetadata, null);
});

test("a not-found owner (fetchOwnerFn resolves null) degrades the same way as a failure — no display name, sync still succeeds", async () => {
  const { fn: recordObservationFn, recorded } = fakeRecordObservationFn();
  const fetchOwnerFn: FetchHubSpotOwnerFn = async () => null;

  const result = await syncHubSpotCompany({
    db,
    companyId: "12345",
    recordObservationFn,
    fetchOwnerFn,
    fetchCompanyFn: async () => minimalHubSpotCompany({ hubspotOwnerId: "999" }),
    bootstrapCompanyIdentityFn: async () => DEFAULT_BOOTSTRAP_RESULT,
  });

  assert.equal(result.outcome, "created");
  const ownerObservation = recorded.find(
    (o) => o.observationClass === "crm_state" && o.canonicalField === "crm.owner",
  );
  assert.equal(ownerObservation!.providerMetadata, null);
});

test("when there is no owner id, no owner lookup is attempted and no crm.owner observation is recorded", async () => {
  const { fn: recordObservationFn, recorded } = fakeRecordObservationFn();
  let ownerCalls = 0;
  const fetchOwnerFn: FetchHubSpotOwnerFn = async () => {
    ownerCalls += 1;
    return null;
  };

  await syncHubSpotCompany({
    db,
    companyId: "12345",
    recordObservationFn,
    fetchOwnerFn,
    fetchCompanyFn: async () => minimalHubSpotCompany({ hubspotOwnerId: null }),
    bootstrapCompanyIdentityFn: async () => DEFAULT_BOOTSTRAP_RESULT,
  });

  assert.equal(ownerCalls, 0);
  assert.equal(
    recorded.some((o) => o.observationClass === "crm_state" && o.canonicalField === "crm.owner"),
    false,
  );
});

test("a fetch failure stops before canonical bootstrap and before any observation is recorded", async () => {
  let bootstrapCalls = 0;
  const { fn: recordObservationFn, recorded } = fakeRecordObservationFn();
  await assert.rejects(
    () =>
      syncHubSpotCompany({
        db,
        companyId: "12345",
        recordObservationFn,
        fetchCompanyFn: async () => {
          throw new Error("fetch failed");
        },
        bootstrapCompanyIdentityFn: async () => {
          bootstrapCalls += 1;
          throw new Error("must not run");
        },
      }),
    /fetch failed/,
  );
  assert.equal(bootstrapCalls, 0);
  assert.equal(recorded.length, 0);
});
