// Regression test for the production incident where the frontend asked
// GET /api/internal/accounts for `limit=500` and the API (MAX_LIMIT = 100
// in artifacts/api-server/src/routes/accounts.ts) rejected it with a 400.
//
// This scans the actual call sites' source rather than rendering the
// components (no jsdom/testing-library in this package): it asserts every
// known call site uses a shared limit constant (never a bare numeric
// literal that could silently drift above the API maximum), and that no
// site's limit exceeds it — exactly the class of bug that shipped.
//
// LS8 — "Accounts is capped at 100": pages/accounts.tsx moved from a
// single limit: ACCOUNTS_LIST_MAX_LIMIT fetch (which is where the "100 of
// 100" truncation bug actually lived — one page WAS the whole list) to
// real server-side pagination using the smaller ACCOUNTS_LIST_PAGE_SIZE,
// asked for repeatedly via limit+offset. It is checked separately below,
// against that constant, not ACCOUNTS_LIST_MAX_LIMIT — Needs Attention
// (components/needs-attention-view.tsx) is unchanged and still checked
// against ACCOUNTS_LIST_MAX_LIMIT directly, per LS8's explicit instruction
// to preserve its existing behavior.
//
// Run with: tsx --test src/lib/accounts-api.limit.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ACCOUNTS_LIST_MAX_LIMIT, ACCOUNTS_LIST_PAGE_SIZE } from "./accounts-api.js";

const SRC_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const MAX_LIMIT_CALL_SITES = ["components/needs-attention-view.tsx"];
const PAGE_SIZE_CALL_SITES = ["pages/accounts.tsx"];
const ALL_CALL_SITES = [...MAX_LIMIT_CALL_SITES, ...PAGE_SIZE_CALL_SITES];

test("ACCOUNTS_LIST_MAX_LIMIT matches the API's documented maximum of 100", () => {
  assert.equal(ACCOUNTS_LIST_MAX_LIMIT, 100);
});

test("ACCOUNTS_LIST_PAGE_SIZE is a real page size, strictly below the API maximum", () => {
  assert.ok(ACCOUNTS_LIST_PAGE_SIZE > 0);
  assert.ok(ACCOUNTS_LIST_PAGE_SIZE < ACCOUNTS_LIST_MAX_LIMIT);
});

test("Needs Attention uses the shared max-limit constant", () => {
  for (const relativePath of MAX_LIMIT_CALL_SITES) {
    const source = readFileSync(path.join(SRC_DIR, relativePath), "utf8");
    assert.ok(
      source.includes("limit: ACCOUNTS_LIST_MAX_LIMIT"),
      `${relativePath} does not request accounts with limit: ACCOUNTS_LIST_MAX_LIMIT`,
    );
  }
});

test("the paginated Accounts list uses the shared page-size constant, not the max-limit constant", () => {
  for (const relativePath of PAGE_SIZE_CALL_SITES) {
    const source = readFileSync(path.join(SRC_DIR, relativePath), "utf8");
    assert.ok(
      source.includes("ACCOUNTS_LIST_PAGE_SIZE"),
      `${relativePath} does not use ACCOUNTS_LIST_PAGE_SIZE`,
    );
    assert.ok(
      !source.includes("ACCOUNTS_LIST_MAX_LIMIT"),
      `${relativePath} still references ACCOUNTS_LIST_MAX_LIMIT — the "100 of 100" cap bug's own constant`,
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
  for (const relativePath of ALL_CALL_SITES) {
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
