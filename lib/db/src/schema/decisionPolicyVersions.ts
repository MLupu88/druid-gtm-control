// Registry of canonical decision/routing policy code versions (Package 2,
// Phase 3 — not yet built). Every account_decisions row references one of
// these by foreign key, mirroring how account_evaluations references
// evaluatorVersions — "which decision policy produced this decision"
// always has real referential integrity, never a bare unchecked string.
// Empty in this slice; Phase 3 seeds a row here with each policy release.
//
// Append-only: a database trigger (decision_policy_versions_immutable,
// see drizzle/0001_integrity_triggers.sql) rejects UPDATE and DELETE
// outright, so a decision policy version already referenced by
// historical decisions can never be renamed or rewritten out from under
// them.

import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const decisionPolicyVersions = pgTable(
  "decision_policy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull().unique(),
    description: text("description"),
    releasedAt: timestamp("released_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "decision_policy_versions_version_not_blank",
      sql`trim(${t.version}) <> ''`,
    ),
  ],
);

export const insertDecisionPolicyVersionSchema = createInsertSchema(
  decisionPolicyVersions,
  {
    version: (schema) => schema.trim().min(1),
  },
).omit({
  id: true,
  releasedAt: true,
});
export type InsertDecisionPolicyVersion = z.infer<
  typeof insertDecisionPolicyVersionSchema
>;
export type DecisionPolicyVersion = typeof decisionPolicyVersions.$inferSelect;
