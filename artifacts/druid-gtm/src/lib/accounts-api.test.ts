import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAccounts, type AccountsListResponse } from "./accounts-api.js";

const RESPONSE: AccountsListResponse = {
  items: [
    {
      account: {
        id: "account-1",
        accountKey: "dom:example.com",
        companyDomain: "example.com",
        companyName: "Example",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
      },
      latestEvaluation: null,
      latestProductionEvaluation: null,
      latestDecision: {
        id: "decision-1",
        routingOutput: "mql",
        createdAt: "2026-08-18T01:00:00.000Z",
      },
      attention: {
        openCount: 2,
        oldestOpenAttentionAt: "2026-08-17T00:00:00.000Z",
        reasonCodes: ["evaluation_stale", "missing_identity"],
      },
    },
  ],
  pagination: { limit: 100, offset: 0, total: 1 },
};

test("fetchAccounts requests canonical Needs Attention membership and preserves its summary", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedCredentials: RequestCredentials | undefined;

  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedCredentials = init?.credentials;
    return new Response(JSON.stringify(RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await fetchAccounts({
      limit: 100,
      offset: 0,
      needsAttention: true,
    });

    assert.equal(
      requestedUrl,
      "/api/internal/accounts?limit=100&offset=0&needsAttention=true",
    );
    assert.equal(requestedCredentials, "include");
    assert.deepEqual(result, RESPONSE);
    assert.deepEqual(result.items[0]?.attention, RESPONSE.items[0]?.attention);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
