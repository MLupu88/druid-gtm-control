import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  fetchHubSpotCompanyById,
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
    assert.deepEqual(result, { id: "12345", domain: "Example.COM", name: "Example Inc" });
    assert.equal(
      requestedUrl?.pathname,
      "/crm/objects/2026-03/companies/12345",
    );
    assert.deepEqual([...requestedUrl!.searchParams.entries()], [["properties", "domain,name"]]);
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
      });
    });
  } finally {
    mock.restoreAll();
  }
});
