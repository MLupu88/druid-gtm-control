// LS6 — minimal in-process TTL memoization for the Overview AI Summary.
// Explicitly NOT a general caching framework: one zero-arg async
// function in, one cached zero-arg async function out, TTL-based, no
// persistence, no invalidation API beyond time — the smallest safe
// mechanism to avoid generating a new (paid) LLM response on every
// Overview render/refetch, per LS6's own "no complex persistence/schema
// work" instruction. Resets on process restart; fine for a derived
// summary that can always be regenerated from canonical data.
//
// A failed call is NEVER cached — only a successful resolution is
// stored, so a user-initiated retry (or the next natural refetch) after
// a failure always attempts a fresh call, never replays a stale error.

export interface TtlCachedFn<T> {
  (): Promise<T>;
}

export function createTtlCachedFn<T>(
  fn: () => Promise<T>,
  ttlMs: number,
  now: () => number = () => Date.now(),
): TtlCachedFn<T> {
  let cached: { value: T; expiresAt: number } | null = null;

  return async () => {
    const currentTime = now();
    if (cached && cached.expiresAt > currentTime) {
      return cached.value;
    }
    const value = await fn();
    cached = { value, expiresAt: currentTime + ttlMs };
    return value;
  };
}
