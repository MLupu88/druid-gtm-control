// Registry of canonical evaluator code versions (Package 2, Phase 2 — not
// yet built). Every account_evaluations row references one of these by
// foreign key rather than a bare unchecked string, so "which evaluator
// version produced this evaluation" always has real referential
// integrity. Empty in this slice; Phase 2 seeds a row here with each
// evaluator release.
//
// Append-only: a database trigger (evaluator_versions_immutable, see
// drizzle/0001_integrity_triggers.sql) rejects UPDATE and DELETE outright,
// so an evaluator version already referenced by historical evaluations
// can never be renamed or rewritten out from under them.

import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const evaluatorVersions = pgTable(
  "evaluator_versions",
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
      "evaluator_versions_version_not_blank",
      sql`trim(${t.version}) <> ''`,
    ),
  ],
);

export const insertEvaluatorVersionSchema = createInsertSchema(
  evaluatorVersions,
  {
    version: (schema) => schema.trim().min(1),
  },
).omit({
  id: true,
  releasedAt: true,
});
export type InsertEvaluatorVersion = z.infer<
  typeof insertEvaluatorVersionSchema
>;
export type EvaluatorVersion = typeof evaluatorVersions.$inferSelect;
