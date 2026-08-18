// Regression test for the production incident where the frontend asked
// GET /api/internal/accounts for `limit=500` and the API (MAX_LIMIT = 100
// in artifacts/api-server/src/routes/accounts.ts) rejected it with a 400.
//
// This scans the actual call sites' source rather than rendering the
// components (no jsdom/testing-library in this package): it asserts both
// known call sites use the shared ACCOUNTS_LIST_MAX_LIMIT constant, and
// that neither one contains a numeric `limit` literal above the API
// maximum — exactly the class of bug that shipped.
//
// Run with: tsx --test src/lib/accounts-api.limit.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ACCOUNTS_LIST_MAX_LIMIT } from "./accounts-api.js";

const SRC_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const CALL_SITES = [
  "components/needs-attention-view.tsx",
  "pages/accounts.tsx",
];

test("ACCOUNTS_LIST_MAX_LIMIT matches the API's documented maximum of 100", () => {
  assert.equal(ACCOUNTS_LIST_MAX_LIMIT, 100);
});

test("every known accounts call site uses the shared max-limit constant", () => {
  for (const relativePath of CALL_SITES) {
    const source = readFileSync(path.join(SRC_DIR, relativePath), "utf8");
    assert.ok(
      source.includes("limit: ACCOUNTS_LIST_MAX_LIMIT"),
      `${relativePath} does not request accounts with limit: ACCOUNTS_LIST_MAX_LIMIT`,
    );
  }
});

test("Needs Attention requests canonical membership from the accounts API", () => {
  const source = readFileSync(
    path.join(SRC_DIR, "components/needs-attention-view.tsx"),
    "utf8",
  );
  assert.ok(source.includes("needsAttention: true"));
  assert.ok(source.includes("offset: 0"));
});

test("no known accounts call site hardcodes a numeric limit above the API maximum", () => {
  for (const relativePath of CALL_SITES) {
    const source = readFileSync(path.join(SRC_DIR, relativePath), "utf8");
    const numericLimits = [...source.matchAll(/limit:\s*(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    for (const limit of numericLimits) {
      assert.ok(
        limit <= ACCOUNTS_LIST_MAX_LIMIT,
        `${relativePath} hardcodes limit=${limit}, which exceeds the API maximum of ${ACCOUNTS_LIST_MAX_LIMIT}`,
      );
    }
  }
});
