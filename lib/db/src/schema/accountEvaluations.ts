// The canonical persisted evaluation record — Package 2's central table.
// Deliberately does NOT include routing/action-availability/decision
// output; those belong exclusively to account_decisions (Phase 3,
// decision/routing policy), which references this table but is never
// written to it. This table owns only what the canonical evaluator
// (Phase 2) itself produces: fit, intent, identity, actionability,
// eligibility, and structured explanations (score components, matched
// rules, missing inputs).
//
// evaluationMode distinguishes real evaluations from impact-preview
// evaluations (ROADMAP Package 2, Phase 5):
//   - 'production' evaluations must reference a PUBLISHED profile
//     version (enforced by a database trigger,
//     account_evaluations_production_requires_published_version — see
//     drizzle/0001_integrity_triggers.sql) and are the only evaluations
//     account_decisions may ever reference (enforced by a trigger on
//     that table).
//   - 'preview' evaluations may reference a draft or published version
//     and must never feed a real routing decision. Because
//     evaluation_mode is a first-class column, any query needing "real"
//     evaluations can filter it out unambiguously
//     (WHERE evaluation_mode = 'production'); a partial index below
//     exists specifically to make that filter cheap.
//
// A second trigger (account_evaluations_account_matches_snapshot, see
// drizzle/0001_integrity_triggers.sql) enforces that account_id here
// matches the account_id of the referenced accountSnapshots row — both
// are stored on this row for query convenience, but without this check
// an evaluation could accidentally combine one account with another
// account's snapshot.
//
// status is intentionally two-valued (completed | failed), not
// three-valued with a "pending": this table is insert-only (a trigger,
// account_evaluations_immutable, rejects UPDATE and DELETE), so a row is
// only ever durably written once its outcome is already known. CHECKs
// below enforce that 'completed' rows always carry their core outputs
// and never an error_detail, and 'failed' rows always explain themselves
// via error_detail — there is no way to persist an ambiguous
// half-finished or unexplained evaluation.
//
// "Current evaluation for an account" is never a stored flag — it is
// always derived by querying the most recent row (by created_at) for
// that account, filtered to evaluation_mode = 'production' when a real
// (non-preview) answer is needed. Nothing here is ever updated to mark
// an older evaluation as superseded.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accounts } from "./accounts";
import { accountSnapshots } from "./accountSnapshots";
import {
  eligibilityOutcome,
  evaluationMode,
  evaluationStatus,
  identityConfidence,
  identityResolutionLevel,
} from "./enums";
import { evaluatorVersions } from "./evaluatorVersions";
import { icpProfileVersions } from "./icpProfileVersions";

export const accountEvaluations = pgTable(
  "account_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => accountSnapshots.id),
    // Not restricted to published-only here at the column level — preview
    // evaluations are allowed to reference a draft version. The
    // production-must-be-published rule is enforced by a trigger that
    // reads evaluationMode, not by a plain foreign key.
    profileVersionId: uuid("profile_version_id")
      .notNull()
      .references(() => icpProfileVersions.id),
    evaluatorVersionId: uuid("evaluator_version_id")
      .notNull()
      .references(() => evaluatorVersions.id),
    evaluationMode: evaluationMode("evaluation_mode").notNull(),
    status: evaluationStatus("status").notNull(),
    // Populated when status = 'failed'; describes what went wrong. Must
    // be absent for 'completed' rows and required for 'failed' rows —
    // see CHECKs below.
    errorDetail: text("error_detail"),

    fitScore: numeric("fit_score"),
    fitTier: text("fit_tier"),
    intentScore: numeric("intent_score"),
    intentTier: text("intent_tier"),
    identityResolutionLevel: identityResolutionLevel(
      "identity_resolution_level",
    ),
    identityConfidence: identityConfidence("identity_confidence"),
    actionabilityScore: numeric("actionability_score"),
    eligibilityOutcome: eligibilityOutcome("eligibility_outcome"),

    // Evaluator-owned, intrinsic findings — never a routing/channel
    // conclusion. See accountDecisions.ts for the decision-layer's own,
    // separate restriction/blocker concept.
    eligibilityRestrictions: jsonb("eligibility_restrictions")
      .notNull()
      .default([]),
    hardDisqualifiers: jsonb("hard_disqualifiers").notNull().default([]),

    scoreComponents: jsonb("score_components").notNull().default([]),
    matchedRules: jsonb("matched_rules").notNull().default([]),
    missingInputs: jsonb("missing_inputs").notNull().default([]),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [
    index("account_evaluations_account_id_idx").on(t.accountId, t.createdAt),
    // Fast "most recent production evaluation for this account" lookups
    // — the query pattern that matters in practice, since preview
    // evaluations must never be mistaken for real ones.
    index("account_evaluations_account_id_production_idx")
      .on(t.accountId, t.createdAt)
      .where(sql`${t.evaluationMode} = 'production'`),
    index("account_evaluations_profile_version_id_idx").on(t.profileVersionId),
    index("account_evaluations_snapshot_id_idx").on(t.snapshotId),

    check(
      "account_evaluations_fit_score_nonnegative",
      sql`${t.fitScore} IS NULL OR ${t.fitScore} >= 0`,
    ),
    check(
      "account_evaluations_intent_score_nonnegative",
      sql`${t.intentScore} IS NULL OR ${t.intentScore} >= 0`,
    ),
    check(
      "account_evaluations_actionability_score_nonnegative",
      sql`${t.actionabilityScore} IS NULL OR ${t.actionabilityScore} >= 0`,
    ),

    check(
      "account_evaluations_eligibility_restrictions_is_array",
      sql`jsonb_typeof(${t.eligibilityRestrictions}) = 'array'`,
    ),
    check(
      "account_evaluations_hard_disqualifiers_is_array",
      sql`jsonb_typeof(${t.hardDisqualifiers}) = 'array'`,
    ),
    check(
      "account_evaluations_score_components_is_array",
      sql`jsonb_typeof(${t.scoreComponents}) = 'array'`,
    ),
    check(
      "account_evaluations_matched_rules_is_array",
      sql`jsonb_typeof(${t.matchedRules}) = 'array'`,
    ),
    check(
      "account_evaluations_missing_inputs_is_array",
      sql`jsonb_typeof(${t.missingInputs}) = 'array'`,
    ),

    // No ambiguous half-finished evaluations: a 'completed' row must
    // carry every core canonical-evaluator output, non-blank where
    // textual.
    check(
      "account_evaluations_completed_requires_core_outputs",
      sql`${t.status} <> 'completed' OR (
        ${t.fitScore} IS NOT NULL
        AND ${t.fitTier} IS NOT NULL AND trim(${t.fitTier}) <> ''
        AND ${t.intentScore} IS NOT NULL
        AND ${t.intentTier} IS NOT NULL AND trim(${t.intentTier}) <> ''
        AND ${t.identityResolutionLevel} IS NOT NULL
        AND ${t.identityConfidence} IS NOT NULL
        AND ${t.actionabilityScore} IS NOT NULL
        AND ${t.eligibilityOutcome} IS NOT NULL
      )`,
    ),
    // Unambiguous status/error semantics: a completed row never carries
    // a stray error_detail, and a failed immutable row always explains
    // itself.
    check(
      "account_evaluations_completed_has_no_error_detail",
      sql`${t.status} <> 'completed' OR ${t.errorDetail} IS NULL`,
    ),
    check(
      "account_evaluations_failed_requires_error_detail",
      sql`${t.status} <> 'failed' OR (${t.errorDetail} IS NOT NULL AND trim(${t.errorDetail}) <> '')`,
    ),
  ],
);

// created_by is not part of the application insert contract — it is
// stamped server-side by whichever service performs the evaluation
// (mirroring the existing api-server pattern of never trusting a
// client-supplied operator identity, see lib/operators.ts), not supplied
// by a caller. The jsonb collection fields are validated as arrays here
// too (not just via the PostgreSQL jsonb_typeof CHECKs above) so a
// malformed payload is rejected before it ever reaches the database.
export const insertAccountEvaluationSchema = createInsertSchema(
  accountEvaluations,
  {
    // .default([]) (not just an array type) so these stay optional at the
    // Zod layer too, matching the DB column defaults — a caller may omit
    // them entirely, but if provided, must be an array.
    eligibilityRestrictions: z.array(z.unknown()).default([]),
    hardDisqualifiers: z.array(z.unknown()).default([]),
    scoreComponents: z.array(z.unknown()).default([]),
    matchedRules: z.array(z.unknown()).default([]),
    missingInputs: z.array(z.unknown()).default([]),
  },
).omit({
  id: true,
  createdAt: true,
  createdBy: true,
});
export type InsertAccountEvaluation = z.infer<
  typeof insertAccountEvaluationSchema
>;
export type AccountEvaluation = typeof accountEvaluations.$inferSelect;
