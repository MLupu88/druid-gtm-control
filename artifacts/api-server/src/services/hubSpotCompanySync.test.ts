import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { syncHubSpotCompany } from "./hubSpotCompanySync.js";
import type { BootstrapHubSpotCompanyIdentityArgs } from "./hubSpotCompanyIdentity.js";

type Db = NodePgDatabase<typeof schema>;
const db = {} as Db;

test("maps the fetched HubSpot id/domain/name exactly into the canonical bootstrap", async () => {
  const calls: BootstrapHubSpotCompanyIdentityArgs[] = [];
  const result = await syncHubSpotCompany({
    db,
    companyId: "requested-id",
    fetchCompanyFn: async (companyId) => {
      assert.equal(companyId, "requested-id");
      return { id: "returned-id", domain: "HTTPS://WWW.Example.COM/about", name: "Example" };
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
  const result = await syncHubSpotCompany({
    db,
    companyId: "12345",
    fetchCompanyFn: async () => ({ id: "12345", domain: "example.com", name: null }),
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

test("repeated calls remain a thin idempotent delegation to the canonical bootstrap", async () => {
  let fetchCalls = 0;
  let bootstrapCalls = 0;
  const run = () =>
    syncHubSpotCompany({
      db,
      companyId: "12345",
      fetchCompanyFn: async () => {
        fetchCalls += 1;
        return { id: "12345", domain: "example.com", name: "Example" };
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

  assert.deepEqual(await run(), await run());
  assert.equal(fetchCalls, 2);
  assert.equal(bootstrapCalls, 2);
});

test("a fetch failure stops before canonical bootstrap", async () => {
  let bootstrapCalls = 0;
  await assert.rejects(
    () =>
      syncHubSpotCompany({
        db,
        companyId: "12345",
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
});
