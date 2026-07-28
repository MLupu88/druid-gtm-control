// Enum-parity test between @workspace/evaluator's output literal unions
// and @workspace/db's pgEnum values. No database connection needed —
// pgEnum's `.enumValues` is a static property, not a query.
//
// @workspace/evaluator has no runtime enum objects (identityResolutionLevel
// etc. are pure TS union types, deliberately — it must not import
// database enums, and TS types don't exist at runtime to introspect).
// The arrays below are the evaluator-side source of truth, kept in sync
// BY HAND with lib/evaluator/src/types.ts — that manual sync is exactly
// what this test exists to catch drift in.
//
// This is the SECONDARY parity guarantee. The PRIMARY one is
// mapping.ts's exhaustive switch statements, which fail to compile if
// either side's union ever gains/loses a value — see mapping.ts and
// mapping.test.ts.
//
// Run with: tsx --test lib/evaluator-persistence/src/enumParity.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import {
  eligibilityOutcome,
  evaluationMode,
  evaluationStatus,
  identityConfidence,
  identityResolutionLevel,
} from "@workspace/db/schema";

// Mirrors lib/evaluator/src/types.ts's IdentityResolutionLevel union.
const EVALUATOR_IDENTITY_RESOLUTION_LEVELS = [
  "anonymous",
  "company",
  "contact",
  "known_crm_contact",
] as const;
// Mirrors lib/evaluator/src/types.ts's IdentityConfidence union.
const EVALUATOR_IDENTITY_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
// Mirrors lib/evaluator/src/types.ts's EligibilityOutcome union.
const EVALUATOR_ELIGIBILITY_OUTCOMES = [
  "eligible",
  "restricted",
  "ineligible",
] as const;

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

test("identity_resolution_level: DB pgEnum values match @workspace/evaluator's IdentityResolutionLevel union exactly", () => {
  assert.deepEqual(
    sorted(identityResolutionLevel.enumValues),
    sorted(EVALUATOR_IDENTITY_RESOLUTION_LEVELS),
  );
});

test("identity_confidence: DB pgEnum values match @workspace/evaluator's IdentityConfidence union exactly", () => {
  assert.deepEqual(
    sorted(identityConfidence.enumValues),
    sorted(EVALUATOR_IDENTITY_CONFIDENCE_LEVELS),
  );
});

test("eligibility_outcome: DB pgEnum values match @workspace/evaluator's EligibilityOutcome union exactly", () => {
  assert.deepEqual(
    sorted(eligibilityOutcome.enumValues),
    sorted(EVALUATOR_ELIGIBILITY_OUTCOMES),
  );
});

test("evaluation_mode and evaluation_status have no @workspace/evaluator-side equivalent to test parity against", () => {
  // Both are pure adapter/DB concepts. evaluationMode (preview|production)
  // is a caller-supplied argument to evaluateAndPersist() — the evaluator
  // itself has no notion of preview vs. production. evaluationStatus
  // (completed|failed) is decided entirely by THIS adapter based on
  // whether the stored snapshot/config parsed successfully — the pure
  // evaluator (given already-valid typed input) always succeeds and has
  // no "status" output of its own. There is deliberately nothing to map
  // or assert parity against for either enum; this test exists so that
  // absence is a documented, intentional fact instead of an
  // unexplained gap in coverage.
  assert.deepEqual(sorted(evaluationMode.enumValues), [
    "preview",
    "production",
  ]);
  assert.deepEqual(sorted(evaluationStatus.enumValues), [
    "completed",
    "failed",
  ]);
});
