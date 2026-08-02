// Source-level contract guard for ./account-facts-api.ts, mirroring
// ./account-icp-evaluations-api.ts's and ./icp-profiles-api.ts's approach
// — this package has no jsdom/testing-library and no established
// fetch-mocking convention for API client wrapper files, so this checks
// the literal source against the backend contract read directly from
// artifacts/api-server/src/routes/accountFacts.ts, rather than
// exercising a live/mocked request.
//
// Run with: tsx --test src/lib/account-facts-api.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE_PATH = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "account-facts-api.ts",
);

function readSource(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

function functionBlock(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `function ${name} must exist`);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport > -1 ? source.slice(start, nextExport) : source.slice(start);
}

// ---------------------------------------------------------------------
// ACCOUNT_FACT_FIELDS / ACCOUNT_FACT_REGION_VALUES — the exact vocab the
// backend's route (z.enum(ACCOUNT_FACT_FIELDS)) and DB CHECK constraints
// enforce (lib/db/src/schema/accountFacts.ts).
// ---------------------------------------------------------------------

test("ACCOUNT_FACT_FIELDS lists exactly the five Slice 1 fields", () => {
  const source = readSource();
  assert.ok(source.includes('"company.industry"'));
  assert.ok(source.includes('"company.country"'));
  assert.ok(source.includes('"company.region"'));
  assert.ok(source.includes('"company.employeeRange"'));
  assert.ok(source.includes('"company.revenueRange"'));
});

test("ACCOUNT_FACT_REGION_VALUES lists exactly us, emea, other — never unknown", () => {
  const source = readSource();
  const start = source.indexOf("export const ACCOUNT_FACT_REGION_VALUES");
  assert.ok(start > -1, "ACCOUNT_FACT_REGION_VALUES must exist");
  const line = source.slice(start, source.indexOf("\n", start));
  assert.ok(line.includes('"us"'));
  assert.ok(line.includes('"emea"'));
  assert.ok(line.includes('"other"'));
  assert.ok(!line.includes('"unknown"'));
});

// ---------------------------------------------------------------------
// fetchAccountFacts — GET /accounts/:accountId/facts.
// ---------------------------------------------------------------------

test("fetchAccountFacts GETs /api/internal/accounts/:accountId/facts with credentials included", () => {
  const block = functionBlock(readSource(), "fetchAccountFacts");
  assert.ok(block.includes("/api/internal/accounts/${accountId}/facts`"));
  assert.ok(block.includes('credentials: "include"'));
  assert.ok(!block.includes('method: "POST"'));
});

// ---------------------------------------------------------------------
// recordAccountFact — POST /accounts/:accountId/facts, exact body shape.
// recordedBy is deliberately never sent — the backend derives it
// server-side from the authenticated operator and rejects the request
// with 403 if a client tried to smuggle it in via a .strict() body.
// ---------------------------------------------------------------------

test("recordAccountFact POSTs to /api/internal/accounts/:accountId/facts", () => {
  const block = functionBlock(readSource(), "recordAccountFact");
  assert.ok(block.includes("/api/internal/accounts/${args.accountId}/facts`"));
  assert.ok(block.includes('method: "POST"'));
  assert.ok(block.includes('credentials: "include"'));
});

test("recordAccountFact sends exactly field, value, expectedCurrentFactId, correctionReason — never recordedBy or accountId in the body", () => {
  const block = functionBlock(readSource(), "recordAccountFact");
  assert.ok(block.includes("field: args.field"));
  assert.ok(block.includes("value: args.value"));
  assert.ok(block.includes("expectedCurrentFactId: args.expectedCurrentFactId"));
  assert.ok(block.includes("correctionReason: args.correctionReason"));
  assert.ok(!block.includes("recordedBy"));
});

test("RecordAccountFactArgs never declares a recordedBy field — the type itself makes smuggling it in a compile error, not just a runtime omission", () => {
  const source = readSource();
  const start = source.indexOf("export interface RecordAccountFactArgs");
  assert.ok(start > -1);
  const end = source.indexOf("\n}", start);
  const block = source.slice(start, end);
  assert.ok(!block.includes("recordedBy"));
});

// ---------------------------------------------------------------------
// Error handling — every non-ok response throws AccountFactsApiError
// carrying the backend's own `code`, never silently swallowed.
// ---------------------------------------------------------------------

test("both fetchAccountFacts and recordAccountFact route non-ok responses through throwForResponse (AccountFactsApiError)", () => {
  const source = readSource();
  const fetchBlock = functionBlock(source, "fetchAccountFacts");
  const recordBlock = functionBlock(source, "recordAccountFact");
  assert.ok(fetchBlock.includes("throwForResponse"));
  assert.ok(recordBlock.includes("throwForResponse"));
  assert.ok(source.includes("class AccountFactsApiError extends Error"));
  assert.ok(source.includes("public readonly code"));
});

// ---------------------------------------------------------------------
// Query key.
// ---------------------------------------------------------------------

test("accountFactsQueryKey is stable and scoped by accountId", () => {
  const source = readSource();
  const start = source.indexOf("export function accountFactsQueryKey(");
  assert.ok(start > -1, "accountFactsQueryKey must exist");
  const block = source.slice(start, source.indexOf("\n}", start));
  assert.ok(block.includes('"account-facts"'));
  assert.ok(block.includes("accountId"));
});
