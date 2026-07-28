// The canonical decision/routing history table (Package 2, Phase 3 — not
// yet built as logic, but its persistence shape lands now). Deliberately
// separate from account_evaluations: an account may receive a new
// decision (e.g. because its open-opportunity/ownership/suppression
// context changed) without rewriting or recreating its underlying
// fit/intent evaluation. Many decisions may reference one evaluation over
// time; there is no uniqueness constraint on accountEvaluationId.
//
// A database trigger (account_decisions_requires_completed_production_evaluation,
// see drizzle/0001_integrity_triggers.sql) enforces that
// accountEvaluationId always references an account_evaluations row with
// status = 'completed' AND evaluation_mode = 'production' — a decision
// can never be built on a preview evaluation or a failed one.
//
// Gate semantics: overallDecisionGate is a deliberately new name and a
// deliberately new three-value vocabulary (actionable | restricted |
// blocked) — NOT the legacy "passed/warning/failed" gate_status carried
// by either legacy n8n engine (see docs/icp-rule-discovery.md,
// CONFLICT-01, where that legacy field meant two different things on two
// different queue paths). This column, and channelAvailability, are owned
// exclusively by the decision/routing policy layer and must be computed
// fresh from the referenced evaluation's eligibilityRestrictions /
// hardDisqualifiers plus decision-time operational context — never
// inherited from legacy gate_status values. Defining the actual
// computation is Phase 3's job, not this schema's.
//
// Insert-only: a database trigger (account_decisions_immutable) rejects
// UPDATE and DELETE outright.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountEvaluations } from "./accountEvaluations";
import { decisionGate, routingOutput } from "./enums";
import { decisionPolicyVersions } from "./decisionPolicyVersions";

export const accountDecisions = pgTable(
  "account_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountEvaluationId: uuid("account_evaluation_id")
      .notNull()
      .references(() => accountEvaluations.id),
    decisionPolicyVersionId: uuid("decision_policy_version_id")
      .notNull()
      .references(() => decisionPolicyVersions.id),
    // Contact/customer/open-opportunity/ownership/suppression/recency
    // context as seen at decision time — captured immutably here rather
    // than re-derived later from possibly-changed live state.
    operationalContextSnapshot: jsonb("operational_context_snapshot").notNull(),
    routingOutput: routingOutput("routing_output").notNull(),
    routingReason: text("routing_reason"),
    // Per-channel (email/linkedin/voice/...) availability, structured
    // rather than one flat field — see module comment on why a flat gate
    // is exactly the shape that caused CONFLICT-01.
    channelAvailability: jsonb("channel_availability").notNull().default({}),
    overallDecisionGate: decisionGate("overall_decision_gate").notNull(),
    // Decision-layer restrictions/blockers, distinct from the
    // evaluation's own eligibilityRestrictions/hardDisqualifiers.
    blockers: jsonb("blockers").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by"),
  },
  (t) => [
    index("account_decisions_account_evaluation_id_idx").on(
      t.accountEvaluationId,
      t.createdAt,
    ),
    check(
      "account_decisions_operational_context_is_object",
      sql`jsonb_typeof(${t.operationalContextSnapshot}) = 'object'`,
    ),
    check(
      "account_decisions_channel_availability_is_object",
      sql`jsonb_typeof(${t.channelAvailability}) = 'object'`,
    ),
    check(
      "account_decisions_blockers_is_array",
      sql`jsonb_typeof(${t.blockers}) = 'array'`,
    ),
  ],
);

// created_by is stamped server-side, mirroring insertAccountEvaluationSchema.
export const insertAccountDecisionSchema = createInsertSchema(
  accountDecisions,
  {
    // No DB default for operationalContextSnapshot (NOT NULL, no default) —
    // stays required. channelAvailability/blockers do have DB defaults, so
    // .default(...) keeps them optional at the Zod layer too, while still
    // validating shape whenever a value is provided.
    operationalContextSnapshot: z.record(z.string(), z.unknown()),
    channelAvailability: z.record(z.string(), z.unknown()).default({}),
    blockers: z.array(z.unknown()).default([]),
  },
).omit({
  id: true,
  createdAt: true,
  createdBy: true,
});
export type InsertAccountDecision = z.infer<typeof insertAccountDecisionSchema>;
export type AccountDecision = typeof accountDecisions.$inferSelect;
