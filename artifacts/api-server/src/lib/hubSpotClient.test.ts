import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  fetchHubSpotCompanyById,
  fetchHubSpotOwnerById,
  searchHubSpotCompaniesByDomain,
  HubSpotApiError,
  HubSpotCompanyArchivedError,
  HubSpotCompanyDomainUnavailableError,
  HubSpotNotConfiguredError,
  HubSpotResponseError,
} from "./hubSpotClient.js";

async function withAccessToken<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const original = process.env.HUBSPOT_ACCESS_TOKEN;
  if (value === undefined) delete process.env.HUBSPOT_ACCESS_TOKEN;
  else process.env.HUBSPOT_ACCESS_TOKEN = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.HUBSPOT_ACCESS_TOKEN;
    else process.env.HUBSPOT_ACCESS_TOKEN = original;
  }
}

function companyResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    id: "12345",
    properties: { domain: "Example.COM", name: "Example Inc" },
    archived: false,
    ...overrides,
  });
}

async function captureError(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  assert.fail("expected promise to reject");
}

test("fetches exactly one company from the versioned API with only domain,name and a bearer token", async () => {
  const token = "unit-test-token-that-must-not-leak";
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = new URL(String(input));
    requestedInit = init;
    return companyResponse();
  });

  try {
    const result = await withAccessToken(token, () => fetchHubSpotCompanyById(" 12345 "));
    assert.deepEqual(result, {
      id: "12345",
      domain: "Example.COM",
      name: "Example Inc",
      industry: null,
      country: null,
      numberOfEmployees: null,
      annualRevenue: null,
      lifecycleStage: null,
      hubspotOwnerId: null,
    });
    assert.equal(
      requestedUrl?.pathname,
      "/crm/objects/2026-03/companies/12345",
    );
    assert.deepEqual(
      [...requestedUrl!.searchParams.entries()],
      [
        [
          "properties",
          "domain,name,industry,country,numberofemployees,annualrevenue,lifecyclestage,hubspot_owner_id",
        ],
      ],
    );
    assert.equal(requestedInit?.method, "GET");
    assert.deepEqual(requestedInit?.headers, { Authorization: `Bearer ${token}` });
    assert.ok(requestedInit?.signal instanceof AbortSignal);
  } finally {
    mock.restoreAll();
  }
});

test("reads HUBSPOT_ACCESS_TOKEN lazily and fails before fetch when it is absent", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => companyResponse());
  try {
    await assert.rejects(
      () => withAccessToken(undefined, () => fetchHubSpotCompanyById("12345")),
      HubSpotNotConfiguredError,
    );
    assert.equal(fetchMock.mock.calls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test("sanitizes non-success responses and never exposes the bearer token or provider body", async () => {
  const token = "secret-marker-token";
  const providerBody = "sensitive-provider-body";
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(providerBody, { status: 401 }),
  );
  try {
    const error = await withAccessToken(token, () =>
      captureError(() => fetchHubSpotCompanyById("12345")),
    );
    assert.ok(error instanceof HubSpotApiError);
    assert.equal(error.status, 401);
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes(providerBody), false);
  } finally {
    mock.restoreAll();
  }
});

test("wraps network failures in a sanitized provider error", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network failure containing secret-marker-token");
  });
  try {
    const error = await withAccessToken("secret-marker-token", () =>
      captureError(() => fetchHubSpotCompanyById("12345")),
    );
    assert.ok(error instanceof HubSpotApiError);
    assert.equal(error.status, 502);
    assert.equal(error.message.includes("secret-marker-token"), false);
  } finally {
    mock.restoreAll();
  }
});

test("rejects malformed JSON, mismatched ids, and malformed response fields", async () => {
  const responses = [
    new Response("not-json"),
    companyResponse({ id: "different" }),
    companyResponse({ archived: "false" }),
    companyResponse({ properties: { domain: "example.com", name: 42 } }),
  ];
  const fetchMock = mock.method(globalThis, "fetch", async () => responses.shift()!);
  try {
    await withAccessToken("test-token", async () => {
      for (let index = 0; index < 4; index += 1) {
        await assert.rejects(() => fetchHubSpotCompanyById("12345"), HubSpotResponseError);
      }
    });
    assert.equal(fetchMock.mock.calls.length, 4);
  } finally {
    mock.restoreAll();
  }
});

test("rejects archived companies", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => companyResponse({ archived: true, properties: undefined }),
  );
  try {
    await withAccessToken("test-token", () =>
      assert.rejects(() => fetchHubSpotCompanyById("12345"), HubSpotCompanyArchivedError),
    );
  } finally {
    mock.restoreAll();
  }
});

test("rejects missing or blank domains and converts a blank optional name to null", async () => {
  const responses = [
    companyResponse({ properties: { domain: null, name: "Example" } }),
    companyResponse({ properties: { domain: "   ", name: "Example" } }),
    companyResponse({ properties: { domain: "example.com", name: "   " } }),
  ];
  mock.method(globalThis, "fetch", async () => responses.shift()!);
  try {
    await withAccessToken("test-token", async () => {
      await assert.rejects(
        () => fetchHubSpotCompanyById("12345"),
        HubSpotCompanyDomainUnavailableError,
      );
      await assert.rejects(
        () => fetchHubSpotCompanyById("12345"),
        HubSpotCompanyDomainUnavailableError,
      );
      assert.deepEqual(await fetchHubSpotCompanyById("12345"), {
        id: "12345",
        domain: "example.com",
        name: null,
        industry: null,
        country: null,
        numberOfEmployees: null,
        annualRevenue: null,
        lifecycleStage: null,
        hubspotOwnerId: null,
      });
    });
  } finally {
    mock.restoreAll();
  }
});

test("parses industry/country/employee/revenue/lifecycle/owner when present, converts blank strings to null", async () => {
  const responses = [
    companyResponse({
      properties: {
        domain: "example.com",
        name: "Example",
        industry: "CAPITAL_MARKETS",
        country: "United States",
        numberofemployees: "125",
        annualrevenue: "50000000",
        lifecyclestage: "lead",
        hubspot_owner_id: "999",
      },
    }),
    companyResponse({
      properties: {
        domain: "example.com",
        name: "Example",
        industry: "   ",
        country: null,
      },
    }),
  ];
  mock.method(globalThis, "fetch", async () => responses.shift()!);
  try {
    await withAccessToken("test-token", async () => {
      assert.deepEqual(await fetchHubSpotCompanyById("12345"), {
        id: "12345",
        domain: "example.com",
        name: "Example",
        industry: "CAPITAL_MARKETS",
        country: "United States",
        numberOfEmployees: "125",
        annualRevenue: "50000000",
        lifecycleStage: "lead",
        hubspotOwnerId: "999",
      });
      const second = await fetchHubSpotCompanyById("12345");
      assert.equal(second.industry, null);
      assert.equal(second.country, null);
      assert.equal(second.numberOfEmployees, null);
    });
  } finally {
    mock.restoreAll();
  }
});

test("rejects a non-string value for any of the new optional properties", async () => {
  mock.method(globalThis, "fetch", async () =>
    companyResponse({
      properties: { domain: "example.com", name: "Example", numberofemployees: 125 },
    }),
  );
  try {
    await withAccessToken("test-token", () =>
      assert.rejects(() => fetchHubSpotCompanyById("12345"), HubSpotResponseError),
    );
  } finally {
    mock.restoreAll();
  }
});

// ---------------------------------------------------------------------
// M3.5 real-data defect fix — fetchHubSpotOwnerById
// ---------------------------------------------------------------------

function ownerResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    id: "999",
    email: "mark@example.com",
    firstName: "Mark",
    lastName: "van der Ree",
    ...overrides,
  });
}

test("fetches exactly one owner from the real HubSpot Owners API (not the versioned companies-object path) with a bearer token", async () => {
  const token = "unit-test-owner-token-that-must-not-leak";
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = new URL(String(input));
    requestedInit = init;
    return ownerResponse();
  });

  try {
    const result = await withAccessToken(token, () => fetchHubSpotOwnerById(" 999 "));
    assert.deepEqual(result, {
      id: "999",
      email: "mark@example.com",
      firstName: "Mark",
      lastName: "van der Ree",
    });
    assert.equal(requestedUrl?.pathname, "/crm/v3/owners/999");
    // Deliberately NOT /crm/objects/<version>/... — owners are a
    // different HubSpot API surface than the companies object endpoint.
    assert.equal(requestedUrl?.pathname.includes("/crm/objects/"), false);
    assert.equal(requestedInit?.method, "GET");
    assert.deepEqual(requestedInit?.headers, { Authorization: `Bearer ${token}` });
    assert.ok(requestedInit?.signal instanceof AbortSignal);
  } finally {
    mock.restoreAll();
  }
});

test("owner lookup reads HUBSPOT_ACCESS_TOKEN lazily and fails before fetch when it is absent", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => ownerResponse());
  try {
    await assert.rejects(
      () => withAccessToken(undefined, () => fetchHubSpotOwnerById("999")),
      HubSpotNotConfiguredError,
    );
    assert.equal(fetchMock.mock.calls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test("a blank ownerId resolves to null without ever calling fetch", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => ownerResponse());
  try {
    const result = await withAccessToken("test-token", () => fetchHubSpotOwnerById("   "));
    assert.equal(result, null);
    assert.equal(fetchMock.mock.calls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test("a 404 owner response resolves to null, not an error", async () => {
  mock.method(globalThis, "fetch", async () => new Response("not found", { status: 404 }));
  try {
    const result = await withAccessToken("test-token", () => fetchHubSpotOwnerById("999"));
    assert.equal(result, null);
  } finally {
    mock.restoreAll();
  }
});

test("owner lookup sanitizes non-success responses and never exposes the bearer token or provider body", async () => {
  const token = "secret-owner-marker-token";
  const providerBody = "sensitive-owner-provider-body";
  mock.method(globalThis, "fetch", async () => new Response(providerBody, { status: 401 }));
  try {
    const error = await withAccessToken(token, () =>
      captureError(() => fetchHubSpotOwnerById("999")),
    );
    assert.ok(error instanceof HubSpotApiError);
    assert.equal(error.status, 401);
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes(providerBody), false);
  } finally {
    mock.restoreAll();
  }
});

test("owner lookup wraps network failures in a sanitized provider error, exactly like the company client", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network failure containing secret-owner-marker-token");
  });
  try {
    const error = await withAccessToken("secret-owner-marker-token", () =>
      captureError(() => fetchHubSpotOwnerById("999")),
    );
    assert.ok(error instanceof HubSpotApiError);
    assert.equal(error.status, 502);
    assert.equal(error.message.includes("secret-owner-marker-token"), false);
  } finally {
    mock.restoreAll();
  }
});

test("rejects malformed JSON and a mismatched owner id", async () => {
  const responses = [new Response("not-json"), ownerResponse({ id: "different" })];
  mock.method(globalThis, "fetch", async () => responses.shift()!);
  try {
    await withAccessToken("test-token", async () => {
      await assert.rejects(() => fetchHubSpotOwnerById("999"), HubSpotResponseError);
      await assert.rejects(() => fetchHubSpotOwnerById("999"), HubSpotResponseError);
    });
  } finally {
    mock.restoreAll();
  }
});

test("blank/absent email, firstName, or lastName convert to null, never to blank strings", async () => {
  mock.method(globalThis, "fetch", async () =>
    ownerResponse({ email: "   ", firstName: null, lastName: undefined }),
  );
  try {
    const result = await withAccessToken("test-token", () => fetchHubSpotOwnerById("999"));
    assert.deepEqual(result, { id: "999", email: null, firstName: null, lastName: null });
  } finally {
    mock.restoreAll();
  }
});

// ---------------------------------------------------------------------
// RB2B -> HubSpot context link — searchHubSpotCompaniesByDomain
// ---------------------------------------------------------------------

function searchResponse(companyIds: string[]): Response {
  return Response.json({
    total: companyIds.length,
    results: companyIds.map((id) => ({ id, properties: { domain: "example.com" }, archived: false })),
  });
}

test("searches the CRM search API with an exact EQ filter on the normalized domain and a bearer token", async () => {
  const token = "unit-test-search-token-that-must-not-leak";
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requestedUrl = new URL(String(input));
    requestedInit = init;
    return searchResponse(["12345"]);
  });

  try {
    const result = await withAccessToken(token, () =>
      searchHubSpotCompaniesByDomain("HTTPS://WWW.Example.COM/about"),
    );
    assert.deepEqual(result, { outcome: "matched", companyId: "12345" });
    assert.equal(requestedUrl?.pathname, "/crm/v3/objects/companies/search");
    assert.equal(requestedInit?.method, "POST");
    assert.equal(
      (requestedInit?.headers as Record<string, string>)?.Authorization,
      `Bearer ${token}`,
    );
    const body = JSON.parse(String(requestedInit?.body));
    assert.deepEqual(body.filterGroups, [
      { filters: [{ propertyName: "domain", operator: "EQ", value: "example.com" }] },
    ]);
    assert.equal(body.limit, 2);
    assert.ok(requestedInit?.signal instanceof AbortSignal);
  } finally {
    mock.restoreAll();
  }
});

test("zero results resolve to not_found", async () => {
  mock.method(globalThis, "fetch", async () => searchResponse([]));
  try {
    const result = await withAccessToken("test-token", () =>
      searchHubSpotCompaniesByDomain("example.com"),
    );
    assert.deepEqual(result, { outcome: "not_found" });
  } finally {
    mock.restoreAll();
  }
});

test("more than one result resolves to ambiguous, never guessing a winner", async () => {
  mock.method(globalThis, "fetch", async () => searchResponse(["111", "222"]));
  try {
    const result = await withAccessToken("test-token", () =>
      searchHubSpotCompaniesByDomain("example.com"),
    );
    assert.deepEqual(result, { outcome: "ambiguous", companyIds: ["111", "222"] });
  } finally {
    mock.restoreAll();
  }
});

test("search reads HUBSPOT_ACCESS_TOKEN lazily and fails before fetch when it is absent", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => searchResponse([]));
  try {
    await assert.rejects(
      () => withAccessToken(undefined, () => searchHubSpotCompaniesByDomain("example.com")),
      HubSpotNotConfiguredError,
    );
    assert.equal(fetchMock.mock.calls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test("search rejects a blank or unnormalizable domain before ever calling fetch", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => searchResponse([]));
  try {
    await withAccessToken("test-token", async () => {
      await assert.rejects(() => searchHubSpotCompaniesByDomain("   "), HubSpotResponseError);
    });
    assert.equal(fetchMock.mock.calls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test("search sanitizes non-success responses (including 429) and never exposes the bearer token or provider body", async () => {
  const token = "secret-search-marker-token";
  const providerBody = "sensitive-search-provider-body";
  mock.method(globalThis, "fetch", async () => new Response(providerBody, { status: 429 }));
  try {
    const error = await withAccessToken(token, () =>
      captureError(() => searchHubSpotCompaniesByDomain("example.com")),
    );
    assert.ok(error instanceof HubSpotApiError);
    assert.equal(error.status, 429);
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes(providerBody), false);
  } finally {
    mock.restoreAll();
  }
});

test("search wraps network failures in a sanitized provider error", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network failure containing secret-search-marker-token");
  });
  try {
    const error = await withAccessToken("secret-search-marker-token", () =>
      captureError(() => searchHubSpotCompaniesByDomain("example.com")),
    );
    assert.ok(error instanceof HubSpotApiError);
    assert.equal(error.status, 502);
    assert.equal(error.message.includes("secret-search-marker-token"), false);
  } finally {
    mock.restoreAll();
  }
});

test("search rejects malformed JSON and a malformed results shape", async () => {
  const responses = [
    new Response("not-json"),
    Response.json({ results: "not-an-array" }),
    Response.json({ results: [{ id: 12345 }] }),
    Response.json({ results: [{ id: "   " }] }),
  ];
  const fetchMock = mock.method(globalThis, "fetch", async () => responses.shift()!);
  try {
    await withAccessToken("test-token", async () => {
      for (let index = 0; index < 4; index += 1) {
        await assert.rejects(() => searchHubSpotCompaniesByDomain("example.com"), HubSpotResponseError);
      }
    });
    assert.equal(fetchMock.mock.calls.length, 4);
  } finally {
    mock.restoreAll();
  }
});
