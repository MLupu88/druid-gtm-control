// LS6 -- unit tests for ./ttlCache.ts. No network, no DB, no real
// clock -- a fake `now` function makes every case deterministic.
//
// Run with: tsx --test src/lib/ttlCache.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { createTtlCachedFn } from "./ttlCache.js";

function fakeClock(startMs: number) {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => (current += ms) };
}

test("returns the underlying function's result on the first call", async () => {
  const cached = createTtlCachedFn(async () => "value", 1000);
  assert.equal(await cached(), "value");
});

test("calls the underlying function only once for repeated calls within the TTL window", async () => {
  let calls = 0;
  const clock = fakeClock(0);
  const cached = createTtlCachedFn(
    async () => {
      calls += 1;
      return calls;
    },
    1000,
    clock.now,
  );

  const first = await cached();
  clock.advance(500);
  const second = await cached();

  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(calls, 1);
});

test("calls the underlying function again once the TTL has elapsed", async () => {
  let calls = 0;
  const clock = fakeClock(0);
  const cached = createTtlCachedFn(
    async () => {
      calls += 1;
      return calls;
    },
    1000,
    clock.now,
  );

  await cached();
  clock.advance(1001);
  const second = await cached();

  assert.equal(second, 2);
  assert.equal(calls, 2);
});

test("does NOT cache a rejection -- a failing call is retried on the very next invocation, never replaying a stale error", async () => {
  let calls = 0;
  const clock = fakeClock(0);
  const cached = createTtlCachedFn(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient failure");
      return "recovered";
    },
    1000,
    clock.now,
  );

  await assert.rejects(() => cached(), /transient failure/);
  // No time advanced at all -- even immediately after a failure, the
  // next call must attempt fresh generation, not serve a cached error.
  const result = await cached();

  assert.equal(result, "recovered");
  assert.equal(calls, 2);
});

test("a successful result cached after a prior failure is then served for the full TTL", async () => {
  let calls = 0;
  const clock = fakeClock(0);
  const cached = createTtlCachedFn(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient failure");
      return "ok";
    },
    1000,
    clock.now,
  );

  await assert.rejects(() => cached());
  const first = await cached();
  clock.advance(500);
  const second = await cached();

  assert.equal(first, "ok");
  assert.equal(second, "ok");
  assert.equal(calls, 2);
});
