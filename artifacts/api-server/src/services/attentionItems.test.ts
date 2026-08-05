// Pure unit tests for ./attentionItems.ts's normalization, structural
// equality, and duplicate/conflict/replay classification helpers. No
// database, no HTTP — see ../routes/attentionItems.integration.test.ts
// for the real-Postgres write path (insert-first race handling, 23505
// constraint mapping, the conditional resolve UPDATE) this normalization
// and classification logic feeds. Mirrors ./signals.test.ts's own split:
// this repo's convention is to unit test pure helpers directly and defer
// every database-observable write behavior to a real-Postgres integration
// suite, never a mocked drizzle chain.
//
// Run with: tsx --test src/services/attentionItems.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import type { AttentionItem } from "@workspace/db/schema";
import {
  normalizeCreateAttentionItemInput,
  normalizeResolveAttentionItemInput,
  isDuplicateOfExisting,
  isReplayOfExistingResolution,
  structurallyEqual,
} from "./attentionItems.js";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ---------------------------------------------------------------------
// normalizeCreateAttentionItemInput
// ---------------------------------------------------------------------

function baseCreateArgs(overrides: Partial<Parameters<typeof normalizeCreateAttentionItemInput>[0]> = {}) {
  return {
    accountId: ACCOUNT_ID,
    reasonCode: "no_recent_activity",
    reasonDetail: null,
    source: "manual" as const,
    sourceRef: null,
    context: {},
    createdBy: "operator@example.com",
    ...overrides,
  };
}

test("normalizeCreateAttentionItemInput: trims and lowercases reasonCode", () => {
  const result = normalizeCreateAttentionItemInput(baseCreateArgs({ reasonCode: "  No_Recent_Activity  " }));
  assert.equal(result.reasonCode, "no_recent_activity");
});

test("normalizeCreateAttentionItemInput: reasonDetail trims a present value", () => {
  const result = normalizeCreateAttentionItemInput(baseCreateArgs({ reasonDetail: "  needs manual review  " }));
  assert.equal(result.reasonDetail, "needs manual review");
});

test("normalizeCreateAttentionItemInput: reasonDetail null and undefined both normalize to null", () => {
  const withNull = normalizeCreateAttentionItemInput(baseCreateArgs({ reasonDetail: null }));
  const withUndefined = normalizeCreateAttentionItemInput(
    baseCreateArgs({ reasonDetail: undefined as unknown as null }),
  );
  assert.equal(withNull.reasonDetail, null);
  assert.equal(withUndefined.reasonDetail, null);
});

test("normalizeCreateAttentionItemInput: a whitespace-only reasonDetail normalizes to null", () => {
  const result = normalizeCreateAttentionItemInput(baseCreateArgs({ reasonDetail: "   " }));
  assert.equal(result.reasonDetail, null);
});

test("normalizeCreateAttentionItemInput: sourceRef trims a present value", () => {
  const result = normalizeCreateAttentionItemInput(baseCreateArgs({ sourceRef: "  sig_123  " }));
  assert.equal(result.sourceRef, "sig_123");
});

test("normalizeCreateAttentionItemInput: sourceRef null and undefined both normalize to null", () => {
  const withNull = normalizeCreateAttentionItemInput(baseCreateArgs({ sourceRef: null }));
  const withUndefined = normalizeCreateAttentionItemInput(baseCreateArgs({ sourceRef: undefined as unknown as null }));
  assert.equal(withNull.sourceRef, null);
  assert.equal(withUndefined.sourceRef, null);
});

test("normalizeCreateAttentionItemInput: context defaults to {} when omitted (undefined)", () => {
  const result = normalizeCreateAttentionItemInput(
    baseCreateArgs({ context: undefined as unknown as Record<string, unknown> }),
  );
  assert.deepEqual(result.context, {});
});

test("normalizeCreateAttentionItemInput: a supplied context is preserved as-is (not itself trimmed/altered)", () => {
  const context = { signalId: "sig_1", nested: { a: 1 } };
  const result = normalizeCreateAttentionItemInput(baseCreateArgs({ context }));
  assert.deepEqual(result.context, context);
});

test("normalizeCreateAttentionItemInput: createdBy is trimmed but never defaulted", () => {
  const result = normalizeCreateAttentionItemInput(baseCreateArgs({ createdBy: "  system:evaluation  " }));
  assert.equal(result.createdBy, "system:evaluation");
});

test("normalizeCreateAttentionItemInput: accountId and source pass through unchanged", () => {
  const result = normalizeCreateAttentionItemInput(baseCreateArgs({ source: "evaluation" }));
  assert.equal(result.accountId, ACCOUNT_ID);
  assert.equal(result.source, "evaluation");
});

// ---------------------------------------------------------------------
// normalizeResolveAttentionItemInput
// ---------------------------------------------------------------------

test("normalizeResolveAttentionItemInput: trims resolvedBy and resolutionReason", () => {
  const result = normalizeResolveAttentionItemInput({
    resolvedBy: "  operator@example.com  ",
    resolutionReason: "  false positive  ",
  });
  assert.equal(result.resolvedBy, "operator@example.com");
  assert.equal(result.resolutionReason, "false positive");
});

// ---------------------------------------------------------------------
// structurallyEqual
// ---------------------------------------------------------------------

test("structurallyEqual: identical primitives are equal", () => {
  assert.equal(structurallyEqual("a", "a"), true);
  assert.equal(structurallyEqual(1, 1), true);
  assert.equal(structurallyEqual(null, null), true);
});

test("structurallyEqual: object key order does not affect equality", () => {
  const a = { signalId: "sig_1", accountKey: "dom:example.com" };
  const b = { accountKey: "dom:example.com", signalId: "sig_1" };
  assert.equal(structurallyEqual(a, b), true);
});

test("structurallyEqual: arrays remain order-sensitive", () => {
  assert.equal(structurallyEqual([1, 2, 3], [3, 2, 1]), false);
  assert.equal(structurallyEqual([1, 2, 3], [1, 2, 3]), true);
});

test("structurallyEqual: a missing key vs. an explicit null key are not equal", () => {
  assert.equal(structurallyEqual({ a: null }, {}), false);
});

test("structurallyEqual: nested object/array structures compare recursively", () => {
  const a = { tags: ["x", "y"], nested: { z: 1, a: 2 } };
  const b = { nested: { a: 2, z: 1 }, tags: ["x", "y"] };
  const c = { nested: { a: 2, z: 1 }, tags: ["y", "x"] };
  assert.equal(structurallyEqual(a, b), true);
  assert.equal(structurallyEqual(a, c), false);
});

// ---------------------------------------------------------------------
// isDuplicateOfExisting — create-path duplicate vs. conflict
// classification. accountId/reasonCode/source/sourceRef are deliberately
// not part of this function's contract (the caller already selected the
// existing row by those four fields — see fetchExistingOpenAttentionItem
// in ./attentionItems.ts), so only reasonDetail/context/createdBy are
// exercised here.
// ---------------------------------------------------------------------

function existingItem(overrides: Partial<AttentionItem> = {}): Pick<AttentionItem, "reasonDetail" | "context" | "createdBy"> {
  return {
    reasonDetail: "needs manual review",
    context: { signalId: "sig_1" },
    createdBy: "operator@example.com",
    ...overrides,
  };
}

test("isDuplicateOfExisting: identical reasonDetail/context/createdBy is a duplicate", () => {
  const normalized = {
    reasonDetail: "needs manual review",
    context: { signalId: "sig_1" },
    createdBy: "operator@example.com",
  };
  assert.equal(isDuplicateOfExisting(normalized, existingItem()), true);
});

test("isDuplicateOfExisting: context compared structurally — key order does not defeat duplicate detection", () => {
  const normalized = {
    reasonDetail: "needs manual review",
    context: { accountKey: "dom:example.com", signalId: "sig_1" },
    createdBy: "operator@example.com",
  };
  assert.equal(
    isDuplicateOfExisting(
      normalized,
      existingItem({ context: { signalId: "sig_1", accountKey: "dom:example.com" } }),
    ),
    true,
  );
});

test("isDuplicateOfExisting: a differing reasonDetail is a conflict", () => {
  const normalized = {
    reasonDetail: "different detail",
    context: { signalId: "sig_1" },
    createdBy: "operator@example.com",
  };
  assert.equal(isDuplicateOfExisting(normalized, existingItem()), false);
});

test("isDuplicateOfExisting: a differing context is a conflict", () => {
  const normalized = {
    reasonDetail: "needs manual review",
    context: { signalId: "sig_2" },
    createdBy: "operator@example.com",
  };
  assert.equal(isDuplicateOfExisting(normalized, existingItem()), false);
});

test("isDuplicateOfExisting: a differing createdBy is a conflict, even when reasonDetail/context match", () => {
  const normalized = {
    reasonDetail: "needs manual review",
    context: { signalId: "sig_1" },
    createdBy: "system:evaluation",
  };
  assert.equal(isDuplicateOfExisting(normalized, existingItem({ createdBy: "operator@example.com" })), false);
});

// ---------------------------------------------------------------------
// isReplayOfExistingResolution — resolve-path replay vs. conflict
// classification.
// ---------------------------------------------------------------------

test("isReplayOfExistingResolution: identical resolvedBy/resolutionReason is a replay", () => {
  const normalized = { resolvedBy: "operator@example.com", resolutionReason: "false positive" };
  const existing = { resolvedBy: "operator@example.com", resolutionReason: "false positive" };
  assert.equal(isReplayOfExistingResolution(normalized, existing), true);
});

test("isReplayOfExistingResolution: a differing resolvedBy is a conflict", () => {
  const normalized = { resolvedBy: "operator-a@example.com", resolutionReason: "false positive" };
  const existing = { resolvedBy: "operator-b@example.com", resolutionReason: "false positive" };
  assert.equal(isReplayOfExistingResolution(normalized, existing), false);
});

test("isReplayOfExistingResolution: a differing resolutionReason is a conflict", () => {
  const normalized = { resolvedBy: "operator@example.com", resolutionReason: "false positive" };
  const existing = { resolvedBy: "operator@example.com", resolutionReason: "handled manually" };
  assert.equal(isReplayOfExistingResolution(normalized, existing), false);
});
