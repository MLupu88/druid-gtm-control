// Milestone 4A — unit tests for ./account-claims-presentation.ts's pure
// display logic. No DOM, no React — see ./account-truth-presentation.test.ts's
// own module comment for the same discipline.
//
// Run with: tsx --test src/lib/account-claims-presentation.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountClaim } from "@/lib/account-claims-api";
import {
  claimEvidenceSourceLabel,
  claimKeyLabel,
  claimLifecycle,
  displayClaimValue,
  formatClaimTimestamp,
  groupClaimsByKey,
  originLabel,
} from "./account-claims-presentation.js";

function claim(overrides: Partial<AccountClaim> = {}): AccountClaim {
  return {
    id: "claim-1",
    claimKey: "cx.vendor",
    status: "active",
    valueType: "string",
    value: "Genesys",
    origin: "research",
    confidence: "medium",
    isCurrent: true,
    supersedesClaimId: null,
    correctionReason: null,
    recordedBy: null,
    generatedByVersion: null,
    observedAt: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    evidence: [],
    ...overrides,
  };
}

test("claimKeyLabel humanizes a dot-namespaced key generically, with no per-key lookup table", () => {
  assert.equal(claimKeyLabel("cx.vendor"), "Cx · Vendor");
  assert.equal(claimKeyLabel("automation.hiringIntent"), "Automation · HiringIntent");
});

test("originLabel covers every ClaimOrigin value", () => {
  assert.equal(originLabel("observed"), "Observed");
  assert.equal(originLabel("derived"), "Derived");
  assert.equal(originLabel("research"), "Research");
  assert.equal(originLabel("human_confirmed"), "Confirmed by operator");
  assert.equal(originLabel("human_corrected"), "Corrected by operator");
});

test("claimLifecycle: a rejected claim is always 'Rejected', regardless of isCurrent", () => {
  const result = claimLifecycle(claim({ status: "rejected", isCurrent: false, value: null, valueType: null }));
  assert.equal(result.text, "Rejected");
  assert.equal(result.badgeVariant, "destructive");
});

test("claimLifecycle: an isCurrent active claim is 'Current'", () => {
  const result = claimLifecycle(claim({ isCurrent: true }));
  assert.equal(result.text, "Current");
});

test("claimLifecycle: a non-current active claim WITH a supersedesClaimId is 'Superseded'", () => {
  const result = claimLifecycle(claim({ isCurrent: false, supersedesClaimId: "claim-0" }));
  assert.equal(result.text, "Superseded");
});

test("claimLifecycle: a non-current active claim with NO supersedesClaimId is 'Contradicted' — an unresolved disagreement, not an ordinary correction", () => {
  const result = claimLifecycle(claim({ isCurrent: false, supersedesClaimId: null }));
  assert.equal(result.text, "Contradicted");
});

test("displayClaimValue: boolean renders Yes/No", () => {
  assert.equal(displayClaimValue("boolean", true), "Yes");
  assert.equal(displayClaimValue("boolean", false), "No");
});

test("displayClaimValue: string/number render as-is", () => {
  assert.equal(displayClaimValue("string", "Genesys"), "Genesys");
  assert.equal(displayClaimValue("number", 42), "42");
});

test("displayClaimValue: list joins scalar entries", () => {
  assert.equal(displayClaimValue("list", ["a", "b", "c"]), "a, b, c");
});

test("displayClaimValue: object renders key: value pairs", () => {
  assert.equal(displayClaimValue("object", { region: "us", tier: 1 }), "region: us, tier: 1");
});

test("displayClaimValue: a null valueType/value (a rejected claim) renders the missing-value placeholder, never a fabricated string", () => {
  assert.equal(displayClaimValue(null, null), "—");
});

test("claimEvidenceSourceLabel covers all three evidence kinds", () => {
  assert.equal(claimEvidenceSourceLabel({ kind: "unknown", id: "x" }), "Evidence unavailable");
  assert.equal(
    claimEvidenceSourceLabel({
      kind: "manual_account_fact",
      id: "x",
      value: "Banking",
      recordedBy: "operator@example.test",
      observedAt: "2026-08-21T00:00:00.000Z",
    }),
    "Manual confirmation",
  );
  assert.equal(
    claimEvidenceSourceLabel({
      kind: "observation",
      id: "x",
      provider: "rb2b",
      value: "Genesys",
      observedAt: null,
      importedAt: "2026-08-21T00:00:00.000Z",
    }),
    "RB2B",
  );
});

test("formatClaimTimestamp returns null for a null/invalid input, never a fabricated date", () => {
  assert.equal(formatClaimTimestamp(null), null);
  assert.equal(formatClaimTimestamp("not-a-date"), null);
  assert.ok(formatClaimTimestamp("2026-08-21T00:00:00.000Z"));
});

test("groupClaimsByKey partitions claims by claimKey without re-sorting within a group", () => {
  const claims = [
    claim({ id: "a", claimKey: "cx.vendor", createdAt: "2026-08-21T00:00:00.000Z" }),
    claim({ id: "b", claimKey: "cx.vendor", createdAt: "2026-08-20T00:00:00.000Z" }),
    claim({ id: "c", claimKey: "automation.hiringIntent", createdAt: "2026-08-19T00:00:00.000Z" }),
  ];
  const groups = groupClaimsByKey(claims);
  assert.equal(groups.size, 2);
  assert.deepEqual(
    groups.get("cx.vendor")?.map((c) => c.id),
    ["a", "b"],
  );
  assert.deepEqual(
    groups.get("automation.hiringIntent")?.map((c) => c.id),
    ["c"],
  );
});
