// Package 2, Phase 2 — the persistence adapter for the canonical account
// evaluator. Depends on BOTH @workspace/evaluator (pure scoring logic)
// and @workspace/db (canonical schema) and owns the explicit translation
// between them — see mapping.ts. Neither of those two packages depends
// on this one or on each other.
//
// Scope: loads a snapshot/profile-version/evaluator-version, validates
// them, runs the evaluator, and persists exactly one immutable
// account_evaluations row. Never touches account_decisions, routing
// output, actions, outbox records, or external requests — see
// evaluateAndPersist.ts for the full failure-semantics contract.
//
// KNOWN GAP (reported, not silently resolved): there is no uniqueness or
// idempotency constraint on account_evaluations for
// (snapshotId, profileVersionId, evaluatorVersionId, evaluationMode).
// Calling evaluateAndPersist() twice with identical arguments inserts
// TWO distinct completed rows — see evaluateAndPersist.integration.test.ts
// for a test that documents this explicitly. This may be intentional
// (ROADMAP.md: "Re-scoring is explicit and creates a new evaluation
// record") but no idempotency contract currently exists to prevent an
// accidental retry from doing the same thing unintentionally; a caller
// (e.g. a future re-score job) must supply its own idempotency key if
// that guarantee is needed.

export {
  evaluateAndPersist,
  type EvaluateAndPersistArgs,
} from "./evaluateAndPersist.js";
export * from "./errors.js";
export * from "./mapping.js";
