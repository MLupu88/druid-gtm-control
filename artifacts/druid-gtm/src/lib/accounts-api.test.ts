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
      "/api/internal/accounts?limit=100&offset=0&sort=updated&needsAttention=true",
    );
    assert.equal(requestedCredentials, "include");
    assert.deepEqual(result, RESPONSE);
    assert.deepEqual(result.items[0]?.attention, RESPONSE.items[0]?.attention);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// LS8 — "Accounts is capped at 100": search/sort must reach the server as
// real query params, not be applied client-side against an already-capped
// page (see accounts.tsx).
test("fetchAccounts sends search and sort as server-side query parameters", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({ items: [], pagination: { limit: 50, offset: 0, total: 0 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await fetchAccounts({ limit: 50, offset: 100, search: "RSM", sort: "name" });
    assert.equal(
      requestedUrl,
      "/api/internal/accounts?limit=50&offset=100&sort=name&search=RSM",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchAccounts omits the search parameter entirely for a blank/whitespace-only search", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({ items: [], pagination: { limit: 50, offset: 0, total: 0 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await fetchAccounts({ limit: 50, offset: 0, search: "   " });
    assert.equal(requestedUrl, "/api/internal/accounts?limit=50&offset=0&sort=updated");
    assert.ok(!requestedUrl.includes("search="));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
