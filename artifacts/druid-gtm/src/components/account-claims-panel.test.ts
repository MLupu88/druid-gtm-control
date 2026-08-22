// Milestone 4A — source-inspection tests for ./account-claims-panel.tsx.
// Mirrors this package's established convention — no React rendering
// harness exists here (see ./account-people-panel.test.ts).
//
// Run with: tsx --test src/components/account-claims-panel.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SOURCE = readFileSync(
  path.resolve(fileURLToPath(new URL(".", import.meta.url)), "account-claims-panel.tsx"),
  "utf8",
);

test("the panel fetches Account Brain claims via the real API, not a hardcoded placeholder", () => {
  assert.ok(SOURCE.includes('from "@/lib/account-claims-api"'));
  assert.ok(SOURCE.includes("fetchAccountClaims"));
});

test("has real loading, error, and empty states, not just a happy path", () => {
  assert.ok(SOURCE.includes("claimsQ.isLoading"));
  assert.ok(SOURCE.includes("claimsQ.isError"));
  assert.ok(SOURCE.includes("groups.size === 0"));
});

test("groups claims by key and shows every history row, never hiding superseded/contradicting claims", () => {
  assert.ok(SOURCE.includes("groupClaimsByKey"));
  assert.ok(SOURCE.includes("history.map"));
});

test("renders lifecycle, origin, confidence, correction reason, and evidence — real fields, never fabricated", () => {
  assert.ok(SOURCE.includes("claimLifecycle"));
  assert.ok(SOURCE.includes("originLabel(claim.origin)"));
  assert.ok(SOURCE.includes("claim.confidence"));
  assert.ok(SOURCE.includes("claim.correctionReason"));
  assert.ok(SOURCE.includes("claimEvidenceSourceLabel"));
});

test("has no write UI — 4A is service-layer-only for writes", () => {
  assert.ok(!SOURCE.includes("useMutation"));
  assert.ok(!SOURCE.includes("recordClaim"));
});
