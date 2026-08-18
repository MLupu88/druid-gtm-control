import assert from "node:assert/strict";
import test from "node:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  bootstrapHubSpotCompanyIdentity,
  InvalidHubSpotCompanyDomainError,
  InvalidHubSpotCompanyIdError,
  InvalidHubSpotCompanyNameError,
  normalizeHubSpotCompanyIdentityInput,
} from "./hubSpotCompanyIdentity.js";

type Db = NodePgDatabase<typeof schema>;

function fakeDbWithSelectResults(results: unknown[][]): Db {
  const queue = [...results];
  const tx = {
    select: () => {
      const builder = {
        from: () => builder,
        where: async () => queue.shift() ?? [],
      };
      return builder;
    },
    insert: () => {
      throw new Error("insert was not expected");
    },
  };
  return {
    transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as Db;
}

test("normalizes a URL-shaped domain once and constructs both HubSpot strong identifiers", () => {
  const normalized = normalizeHubSpotCompanyIdentityInput({
    hubspotCompanyId: "  HS-123  ",
    companyDomain: " HTTPS://WWW.Example.COM/pricing?utm=1 ",
    companyName: "  Example Inc  ",
  });

  assert.deepEqual(normalized, {
    hubspotCompanyId: "HS-123",
    company: {
      domain: "example.com",
      name: "Example Inc",
      externalIds: { hubspot: "HS-123" },
    },
  });
});

test("rejects a blank HubSpot company id", () => {
  assert.throws(
    () =>
      normalizeHubSpotCompanyIdentityInput({
        hubspotCompanyId: "  ",
        companyDomain: "example.com",
      }),
    InvalidHubSpotCompanyIdError,
  );
});

test("rejects blank or invalid domains after shared normalization", () => {
  for (const companyDomain of ["  ", "https://", "www.www.example.com"]) {
    assert.throws(
      () =>
        normalizeHubSpotCompanyIdentityInput({
          hubspotCompanyId: "HS-123",
          companyDomain,
        }),
      InvalidHubSpotCompanyDomainError,
    );
  }
});

test("rejects a blank optional company name rather than storing a placeholder", () => {
  assert.throws(
    () =>
      normalizeHubSpotCompanyIdentityInput({
        hubspotCompanyId: "HS-123",
        companyDomain: "example.com",
        companyName: "  ",
      }),
    InvalidHubSpotCompanyNameError,
  );
});

test("invalid identity input is rejected before opening a transaction", async () => {
  let transactionCalls = 0;
  const db = {
    transaction: async () => {
      transactionCalls += 1;
      throw new Error("transaction must not run");
    },
  } as unknown as Db;

  await assert.rejects(
    () =>
      bootstrapHubSpotCompanyIdentity({
        db,
        hubspotCompanyId: "HS-123",
        companyDomain: " ",
      }),
    InvalidHubSpotCompanyDomainError,
  );
  assert.equal(transactionCalls, 0);
});

test("invalid maxAttempts is rejected before opening a transaction", async () => {
  let transactionCalls = 0;
  const db = {
    transaction: async () => {
      transactionCalls += 1;
      throw new Error("transaction must not run");
    },
  } as unknown as Db;

  await assert.rejects(
    () =>
      bootstrapHubSpotCompanyIdentity({
        db,
        hubspotCompanyId: "HS-123",
        companyDomain: "example.com",
        maxAttempts: 0,
      }),
    /maxAttempts must be a positive integer/,
  );
  assert.equal(transactionCalls, 0);
});

test("returns an explicit conflict when domain and HubSpot aliases resolve to different accounts", async () => {
  const domainAccountId = "11111111-1111-4111-8111-111111111111";
  const hubspotAccountId = "22222222-2222-4222-8222-222222222222";
  const result = await bootstrapHubSpotCompanyIdentity({
    db: fakeDbWithSelectResults([
      [
        {
          accountId: hubspotAccountId,
          aliasType: "external_id:hubspot",
          normalizedValue: "HS-123",
        },
      ],
      [{ id: domainAccountId }],
    ]),
    hubspotCompanyId: "HS-123",
    companyDomain: "example.com",
  });

  assert.deepEqual(result, {
    outcome: "conflict",
    code: "account_identifier_conflict",
    source: "hubspot",
    candidateMatches: [
      {
        entityType: "account",
        identifierType: "domain",
        matchedId: domainAccountId,
      },
      {
        entityType: "account",
        identifierType: "external_id",
        matchedId: hubspotAccountId,
        source: "hubspot",
      },
    ],
  });
});

test("an exact replay returns matched with no writes", async () => {
  const accountId = "11111111-1111-4111-8111-111111111111";
  const result = await bootstrapHubSpotCompanyIdentity({
    db: fakeDbWithSelectResults([
      [
        {
          accountId,
          aliasType: "domain",
          normalizedValue: "example.com",
        },
        {
          accountId,
          aliasType: "external_id:hubspot",
          normalizedValue: "HS-123",
        },
      ],
      [{ id: accountId }],
      [
        { accountId, aliasType: "domain", normalizedValue: "example.com" },
        {
          accountId,
          aliasType: "external_id:hubspot",
          normalizedValue: "HS-123",
        },
      ],
    ]),
    hubspotCompanyId: "HS-123",
    companyDomain: "example.com",
  });

  assert.deepEqual(result, {
    outcome: "matched",
    accountId,
    source: "hubspot",
    attachedAliasTypes: [],
  });
});
