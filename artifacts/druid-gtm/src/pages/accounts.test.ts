// LS8 — source-inspection regression tests for the "Accounts is capped at
// 100" defect: the All Accounts list used to fetch a single
// limit: ACCOUNTS_LIST_MAX_LIMIT (100) page and then filter/sort that
// already-capped page entirely client-side — so with 242 canonical
// accounts, search only ever operated on 100 of them, "of" reported the
// page size (100) as if it were the population, and an account outside
// that first page (e.g. RSM, sorted past position 100) could never be
// found. Mirrors this package's established source-inspection convention
// (e.g. ./dashboard.test.ts) — no React rendering harness exists here.
//
// Run with: tsx --test src/pages/accounts.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "accounts.tsx"),
  "utf8",
);

test("search and sort are sent to fetchAccounts as query args, not applied client-side against an already-fetched page", () => {
  assert.ok(
    /fetchAccounts\(queryArgs\)/.test(SOURCE) || /fetchAccounts\(\s*queryArgs\s*\)/.test(SOURCE),
    "fetchAccounts must be called with the search/sort/offset query args",
  );
  assert.ok(SOURCE.includes("search,") || SOURCE.includes("search }"), "queryArgs must include search");
  assert.ok(SOURCE.includes("sort }") || SOURCE.includes("sort,"), "queryArgs must include sort");
  // The old bug's exact shape: filtering/sorting an in-memory `items`
  // array by a locally-typed search string. Neither must remain.
  assert.ok(!/items\.filter\(/.test(SOURCE), "stale client-side search filter over `items` still present");
  assert.ok(!/sorted\.sort\(/.test(SOURCE), "stale client-side sort over a local `sorted` array still present");
});

test("the result count is derived from pagination.total, never from the current page's item count", () => {
  assert.ok(SOURCE.includes("accountsQ.data?.pagination.total"));
  // The exact old defect string this replaces.
  assert.ok(!SOURCE.includes("{visibleItems.length} of {items.length}"));
});

test("the toolbar renders a truthful 'start–end of total' range, not a page-size-vs-page-size count", () => {
  assert.ok(SOURCE.includes("rangeStart"));
  assert.ok(SOURCE.includes("rangeEnd"));
  assert.ok(/rangeStart.*rangeEnd.*of.*total/s.test(SOURCE) || SOURCE.includes("`${rangeStart}–${rangeEnd} of ${total}`"));
});

test("real Prev/Next pagination controls exist, wired to page state and pagination.total", () => {
  assert.ok(SOURCE.includes("const [page, setPage]"));
  assert.ok(SOURCE.includes("hasPrevPage"));
  assert.ok(SOURCE.includes("hasNextPage"));
  assert.ok(SOURCE.includes("setPage((p) => Math.max(0, p - 1))"));
  assert.ok(SOURCE.includes("setPage((p) => p + 1)"));
});

test("a new search or sort resets pagination back to the first page", () => {
  const effectBlock = SOURCE.match(/useEffect\(\(\) => \{\s*setPage\(0\);\s*\}, \[search, sort\]\);/);
  assert.ok(effectBlock, "expected a useEffect resetting page to 0 on [search, sort] change");
});

test("the search box is debounced before it reaches the server query, not fired on every keystroke", () => {
  assert.ok(SOURCE.includes("SEARCH_DEBOUNCE_MS"));
  assert.ok(SOURCE.includes("setTimeout"));
  assert.ok(SOURCE.includes("clearTimeout"));
});

test("pagination uses the smaller page-size constant, never the API's hard per-page maximum, as the requested limit", () => {
  assert.ok(SOURCE.includes("ACCOUNTS_LIST_PAGE_SIZE"));
  assert.ok(!SOURCE.includes("ACCOUNTS_LIST_MAX_LIMIT"));
});

test("search placeholder copy matches what the server actually searches (company name/domain), not a stale account-key promise", () => {
  assert.ok(SOURCE.includes("Search by company name or domain"));
});
