// LS6 -- unit tests for ./deepseekClient.ts. No live network calls --
// fetch is injected via fetchImpl (see requestDeepSeekChatCompletion's
// own args), mirroring this repo's existing DI-for-testability
// convention. process.env.DEEPSEEK_API_KEY is read per-call (never at
// module load), so tests can freely set/unset it around each case.
//
// Run with: tsx --test src/lib/deepseekClient.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  requestDeepSeekChatCompletion,
  DeepSeekNotConfiguredError,
  DeepSeekApiError,
  DEEPSEEK_API_KEY_NOT_CONFIGURED_MESSAGE,
} from "./deepseekClient.js";

function withEnv(key: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const original = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return fn().finally(() => {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("throws DeepSeekNotConfiguredError when DEEPSEEK_API_KEY is unset, never attempting a network call", async () => {
  await withEnv("DEEPSEEK_API_KEY", undefined, async () => {
    let fetchCalled = false;
    await assert.rejects(
      () =>
        requestDeepSeekChatCompletion({
          systemPrompt: "sys",
          userPrompt: "user",
          fetchImpl: (async () => {
            fetchCalled = true;
            throw new Error("should never be called");
          }) as unknown as typeof fetch,
        }),
      DeepSeekNotConfiguredError,
    );
    assert.equal(fetchCalled, false);
  });
});

test("DeepSeekNotConfiguredError carries the exact documented message", async () => {
  await withEnv("DEEPSEEK_API_KEY", undefined, async () => {
    try {
      await requestDeepSeekChatCompletion({ systemPrompt: "sys", userPrompt: "user" });
      assert.fail("expected rejection");
    } catch (err) {
      assert.ok(err instanceof DeepSeekNotConfiguredError);
      assert.equal(err.message, DEEPSEEK_API_KEY_NOT_CONFIGURED_MESSAGE);
    }
  });
});

test("sends the API key as a Bearer Authorization header, never in the body or URL", async () => {
  await withEnv("DEEPSEEK_API_KEY", "test-key-abc", async () => {
    let capturedInit: RequestInit | undefined;
    let capturedUrl: string | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { choices: [{ message: { content: "{}" } }] });
    }) as unknown as typeof fetch;

    await requestDeepSeekChatCompletion({ systemPrompt: "sys", userPrompt: "user", fetchImpl });

    assert.ok(!capturedUrl?.includes("test-key-abc"));
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-key-abc");
    assert.ok(!JSON.stringify(capturedInit?.body ?? "").includes("test-key-abc"));
  });
});

test("jsonMode:true sends response_format json_object; omitted when false/absent", async () => {
  await withEnv("DEEPSEEK_API_KEY", "k", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse(200, { choices: [{ message: { content: "{}" } }] });
    }) as unknown as typeof fetch;

    await requestDeepSeekChatCompletion({
      systemPrompt: "sys",
      userPrompt: "user",
      jsonMode: true,
      fetchImpl,
    });
    assert.deepEqual(capturedBody.response_format, { type: "json_object" });

    await requestDeepSeekChatCompletion({ systemPrompt: "sys", userPrompt: "user", fetchImpl });
    assert.equal("response_format" in capturedBody, false);
  });
});

test("returns the raw message content string on a well-formed 200 response", async () => {
  await withEnv("DEEPSEEK_API_KEY", "k", async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, {
        choices: [{ message: { content: '{"summary":"hi","factsUsed":[]}' } }],
      })) as unknown as typeof fetch;

    const content = await requestDeepSeekChatCompletion({
      systemPrompt: "sys",
      userPrompt: "user",
      fetchImpl,
    });
    assert.equal(content, '{"summary":"hi","factsUsed":[]}');
  });
});

test("throws DeepSeekApiError on a non-2xx response", async () => {
  await withEnv("DEEPSEEK_API_KEY", "k", async () => {
    const fetchImpl = (async () => jsonResponse(429, { error: "rate limited" })) as unknown as typeof fetch;
    await assert.rejects(
      () => requestDeepSeekChatCompletion({ systemPrompt: "sys", userPrompt: "user", fetchImpl }),
      DeepSeekApiError,
    );
  });
});

test("throws DeepSeekApiError on a malformed/non-JSON response", async () => {
  await withEnv("DEEPSEEK_API_KEY", "k", async () => {
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(
      () => requestDeepSeekChatCompletion({ systemPrompt: "sys", userPrompt: "user", fetchImpl }),
      DeepSeekApiError,
    );
  });
});

test("throws DeepSeekApiError when the response has no message content, never returning undefined silently", async () => {
  await withEnv("DEEPSEEK_API_KEY", "k", async () => {
    const fetchImpl = (async () => jsonResponse(200, { choices: [] })) as unknown as typeof fetch;
    await assert.rejects(
      () => requestDeepSeekChatCompletion({ systemPrompt: "sys", userPrompt: "user", fetchImpl }),
      DeepSeekApiError,
    );
  });
});

test("DeepSeekApiError never includes the API key in its message", async () => {
  await withEnv("DEEPSEEK_API_KEY", "super-secret-key", async () => {
    const fetchImpl = (async () => jsonResponse(500, { error: "boom" })) as unknown as typeof fetch;
    try {
      await requestDeepSeekChatCompletion({ systemPrompt: "sys", userPrompt: "user", fetchImpl });
      assert.fail("expected rejection");
    } catch (err) {
      assert.ok(err instanceof DeepSeekApiError);
      assert.ok(!err.message.includes("super-secret-key"));
    }
  });
});
