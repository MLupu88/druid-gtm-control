// Application service for canonical account decisions — the persisted,
// immutable record of one explicit human routing/business decision (e.g.
// "Promote to MQL", "Keep for review / Sales Review") attached to a
// completed, production account evaluation. Deliberately contains no
// HTTP-specific logic (no req/res, no status codes, no header/body
// parsing) — a future ../routes/accountDecisions.ts owns that boundary.
//
// Only imports from @workspace/db/schema, never @workspace/db itself —
// the database instance is always received via explicit injection,
// mirroring ../services/accounts.ts, ../services/accountEvaluations.ts,
// and ../services/icpProfiles.ts. No production database singleton is
// referenced anywhere in this file.
//
// No automated routing/scoring policy engine, no outbound dispatch, no
// HubSpot/n8n/email/voice/Client Radar calls — every row this module
// writes represents exactly one already-made human decision, recorded
// truthfully. routingOutput and overallDecisionGate are recorded
// independently: an operator may record "mql" even when the evaluator's
// own eligibility output implies a "blocked" gate. This module never
// reinterprets, blocks, or silently turns that choice into an executable
// external action — it only records both facts honestly, side by side.
//
// "Dismiss" is deliberately NOT representable here — it has no
// corresponding routingOutput value, and the existing cockpit contract
// (gtmContract.js's BUTTONS.dismiss) already treats it as a local,
// non-persisted attention toggle rather than a business decision.

import { count, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accountDecisions,
  accountEvaluations,
  decisionPolicyVersions,
  type AccountDecision,
  type AccountEvaluation,
  type DecisionPolicyVersion,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";

type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------
// Manual decision policy version.
//
// decision_policy_versions is otherwise a registry of automated
// decision/routing policy CODE versions (Phase 3 — not yet built; see
// decisionPolicyVersions.ts). account_decisions.decision_policy_version_id
// is NOT NULL with no separate "manual" flag or nullable escape hatch, so
// a manually-recorded decision cannot leave that column meaningless — it
// must reference a real row. This is the one row in that registry that
// honestly means "no automated policy computed this decision; a human
// did," resolved lazily and race-safely below rather than requiring a
// migration-time seed (matching how evaluatorVersions has never had one
// either — see resolveManualDecisionPolicyVersion).
// ---------------------------------------------------------------------
export const MANUAL_DECISION_POLICY_VERSION = {
  version: "manual-operator-v1",
  description:
    "Represents a direct human decision recorded by an operator — no automated decision/routing policy produced this row.",
} as const;

/**
 * Race-safe get-or-create for the well-known manual-decision policy
 * version row: INSERT ... ON CONFLICT (version) DO NOTHING ... RETURNING,
 * falling back to a SELECT when the row already exists. Mirrors the exact
 * shape already proven for evaluatorVersions' "canonical-v1" in the
 * integration test suites — this is the first time that shape runs as
 * real application code rather than test scaffolding. Takes db as an
 * explicit parameter (no production database singleton) so it can be
 * exercised with a fake db in unit tests.
 */
export async function resolveManualDecisionPolicyVersion(
  db: Db,
): Promise<DecisionPolicyVersion> {
  const [inserted] = await db
    .insert(decisionPolicyVersions)
    .values(MANUAL_DECISION_POLICY_VERSION)
    .onConflictDoNothing({ target: decisionPolicyVersions.version })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db
    .select()
    .from(decisionPolicyVersions)
    .where(
      eq(
        decisionPolicyVersions.version,
        MANUAL_DECISION_POLICY_VERSION.version,
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error(
      "resolveManualDecisionPolicyVersion: insert conflicted but no existing row was found",
    );
  }
  return existing;
}

// ---------------------------------------------------------------------
// Gate derivation — a deterministic, mechanical pass-through of the
// referenced evaluation's OWN already-computed eligibility output. This
// is never a scoring/routing policy: no new judgment is made here, only
// carried forward from account_evaluations.eligibilityOutcome/
// hardDisqualifiers/eligibilityRestrictions, exactly as that column's own
// schema comment requires ("computed fresh from the referenced
// evaluation's eligibilityRestrictions/hardDisqualifiers").
// ---------------------------------------------------------------------
export type OverallDecisionGate = AccountDecision["overallDecisionGate"];

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function deriveOverallDecisionGate(
  evaluation: Pick<
    AccountEvaluation,
    "eligibilityOutcome" | "hardDisqualifiers" | "eligibilityRestrictions"
  >,
): OverallDecisionGate {
  const hardDisqualifiers = asArray(evaluation.hardDisqualifiers);
  const eligibilityRestrictions = asArray(evaluation.eligibilityRestrictions);

  if (
    evaluation.eligibilityOutcome === "ineligible" ||
    hardDisqualifiers.length > 0
  ) {
    return "blocked";
  }
  if (
    evaluation.eligibilityOutcome === "restricted" ||
    eligibilityRestrictions.length > 0
  ) {
    return "restricted";
  }
  return "actionable";
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class AccountEvaluationNotFoundError extends Error {
  constructor(public readonly accountEvaluationId: string) {
    super(`accountEvaluation with id "${accountEvaluationId}" does not exist.`);
    this.name = "AccountEvaluationNotFoundError";
  }
}

export class AccountEvaluationNotEligibleError extends Error {
  constructor(
    public readonly accountEvaluationId: string,
    public readonly status: string,
    public readonly evaluationMode: string,
  ) {
    super(
      `accountEvaluation "${accountEvaluationId}" is not eligible for a decision ` +
        `(status="${status}", evaluationMode="${evaluationMode}"); a decision requires ` +
        `a completed, production evaluation.`,
    );
    this.name = "AccountEvaluationNotEligibleError";
  }
}

export class IdempotencyKeyConflictError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super(
      `Idempotency-Key "${idempotencyKey}" was already used to record a different decision.`,
    );
    this.name = "IdempotencyKeyConflictError";
  }
}

// ---------------------------------------------------------------------
// Create — the only write path this service exposes. One immutable
// account_decisions row per (successful) call; idempotency-key replays
// return the already-persisted row instead of inserting a second one.
// ---------------------------------------------------------------------

// Restricted to the two explicit human decisions this slice supports —
// tied structurally to the real routingOutput enum via Extract (not a
// hand-declared parallel union), so a future rename of either literal in
// the schema surfaces as a type error here rather than silently drifting.
export type RoutingOutput = Extract<
  AccountDecision["routingOutput"],
  "mql" | "sales_review"
>;

export interface CreateAccountDecisionArgs {
  db: Db;
  /** Client-supplied UUID, used verbatim as account_decisions.id. */
  idempotencyKey: string;
  accountEvaluationId: string;
  routingOutput: RoutingOutput;
  /** undefined and null are treated identically — both normalize to a stored null. */
  routingReason?: string | null;
  /** Required, non-empty — a manual decision is never persisted with createdBy = null. */
  createdBy: string;
}

export interface AccountDecisionWithAccountId {
  decision: AccountDecision;
  /** The accountId of the account_evaluations row this decision references. */
  accountId: string;
}

export interface CreateAccountDecisionResult extends AccountDecisionWithAccountId {
  /** false when this call was an idempotent replay of an already-persisted decision. */
  created: boolean;
}

/**
 * Records one explicit human decision. Validates that accountEvaluationId
 * references a completed, production evaluation (application-layer
 * defense-in-depth; the account_decisions_requires_completed_production_evaluation
 * trigger remains the final authority — see
 * drizzle/0001_integrity_triggers.sql), derives overallDecisionGate from
 * that evaluation's own eligibility output, resolves the manual policy
 * version, and inserts using idempotencyKey as the row's id.
 *
 * On an id conflict (the same Idempotency-Key reused), the existing row
 * is compared against this call's accountEvaluationId/routingOutput/
 * normalized routingReason/createdBy: an exact match returns the existing
 * row with created:false; any mismatch throws IdempotencyKeyConflictError
 * — no row is ever overwritten (account_decisions is insert-only) and no
 * second row is ever created for the same key.
 */
export async function createAccountDecision(
  args: CreateAccountDecisionArgs,
): Promise<CreateAccountDecisionResult> {
  const { db, idempotencyKey, accountEvaluationId, routingOutput, createdBy } =
    args;
  const routingReason = args.routingReason ?? null;

  if (!createdBy || !createdBy.trim()) {
    throw new Error(
      "createAccountDecision: createdBy is required and must be a non-empty string.",
    );
  }

  const [evaluation] = await db
    .select()
    .from(accountEvaluations)
    .where(eq(accountEvaluations.id, accountEvaluationId))
    .limit(1);
  if (!evaluation) {
    throw new AccountEvaluationNotFoundError(accountEvaluationId);
  }
  if (
    evaluation.status !== "completed" ||
    evaluation.evaluationMode !== "production"
  ) {
    throw new AccountEvaluationNotEligibleError(
      accountEvaluationId,
      evaluation.status,
      evaluation.evaluationMode,
    );
  }

  const overallDecisionGate = deriveOverallDecisionGate(evaluation);
  const policyVersion = await resolveManualDecisionPolicyVersion(db);

  const [inserted] = await db
    .insert(accountDecisions)
    .values({
      id: idempotencyKey,
      accountEvaluationId,
      decisionPolicyVersionId: policyVersion.id,
      operationalContextSnapshot: { source: "manual_operator_decision" },
      channelAvailability: {},
      blockers: [],
      routingOutput,
      routingReason,
      overallDecisionGate,
      createdBy,
    })
    .onConflictDoNothing({ target: accountDecisions.id })
    .returning();

  if (inserted) {
    return {
      decision: inserted,
      accountId: evaluation.accountId,
      created: true,
    };
  }

  const [existing] = await db
    .select()
    .from(accountDecisions)
    .where(eq(accountDecisions.id, idempotencyKey))
    .limit(1);
  if (!existing) {
    throw new Error(
      "createAccountDecision: insert conflicted on id but no existing row was found",
    );
  }

  const matches =
    existing.accountEvaluationId === accountEvaluationId &&
    existing.routingOutput === routingOutput &&
    existing.routingReason === routingReason &&
    existing.createdBy === createdBy;
  if (!matches) {
    throw new IdempotencyKeyConflictError(idempotencyKey);
  }

  return {
    decision: existing,
    accountId: evaluation.accountId,
    created: false,
  };
}

// ---------------------------------------------------------------------
// List / detail read-models. Both join account_evaluations once (never
// per-row) to surface accountId, since account_decisions itself carries
// no direct account_id column — only accountEvaluationId.
// ---------------------------------------------------------------------

export interface ListAccountDecisionsArgs {
  db: Db;
  limit: number;
  offset: number;
  /** When supplied, filtering happens in SQL via the account_evaluations join. */
  accountId?: string;
}

export interface AccountDecisionListResult {
  items: AccountDecisionWithAccountId[];
  total: number;
}

/**
 * Lists canonical account decisions, deterministically ordered
 * (createdAt desc, id desc), each paired with the accountId of the
 * evaluation it references. Runs exactly two queries total regardless of
 * how many decisions are on the page — one count, one page — both
 * applying the same optional accountId filter. No per-row querying (no
 * N+1).
 */
export async function listAccountDecisions(
  args: ListAccountDecisionsArgs,
): Promise<AccountDecisionListResult> {
  const { db, limit, offset, accountId } = args;
  const filter = accountId
    ? eq(accountEvaluations.accountId, accountId)
    : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(accountDecisions)
    .innerJoin(
      accountEvaluations,
      eq(accountDecisions.accountEvaluationId, accountEvaluations.id),
    )
    .where(filter);
  const total = Number(totalRow?.value ?? 0);

  const items = await db
    .select({
      decision: accountDecisions,
      accountId: accountEvaluations.accountId,
    })
    .from(accountDecisions)
    .innerJoin(
      accountEvaluations,
      eq(accountDecisions.accountEvaluationId, accountEvaluations.id),
    )
    .where(filter)
    .orderBy(desc(accountDecisions.createdAt), desc(accountDecisions.id))
    .limit(limit)
    .offset(offset);

  return { items, total };
}

/**
 * Retrieves one persisted account_decisions row by id, joined to
 * account_evaluations for its accountId. Returns undefined when no such
 * row exists.
 */
export async function getAccountDecisionById(
  db: Db,
  decisionId: string,
): Promise<AccountDecisionWithAccountId | undefined> {
  const [row] = await db
    .select({
      decision: accountDecisions,
      accountId: accountEvaluations.accountId,
    })
    .from(accountDecisions)
    .innerJoin(
      accountEvaluations,
      eq(accountDecisions.accountEvaluationId, accountEvaluations.id),
    )
    .where(eq(accountDecisions.id, decisionId))
    .limit(1);
  return row;
}
