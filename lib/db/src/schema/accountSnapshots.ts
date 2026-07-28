// Immutable, reproducible input snapshot fed to an evaluation. Captures
// both the original raw payload (for reproducibility/debugging) and the
// canonical normalized shape the evaluator consumes. schemaVersion tags
// the normalized_input shape itself so future evaluator versions can
// validate/migrate as that shape evolves.
//
// Insert-only: a database trigger (account_snapshots_immutable, see
// drizzle/0001_integrity_triggers.sql) rejects UPDATE and DELETE outright.

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
import { accounts } from "./accounts";

export const accountSnapshots = pgTable(
  "account_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source").notNull(),
    rawInput: jsonb("raw_input").notNull(),
    normalizedInput: jsonb("normalized_input").notNull(),
    schemaVersion: text("schema_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("account_snapshots_account_id_idx").on(t.accountId, t.capturedAt),
    check("account_snapshots_source_not_blank", sql`trim(${t.source}) <> ''`),
    check(
      "account_snapshots_schema_version_not_blank",
      sql`trim(${t.schemaVersion}) <> ''`,
    ),
    check(
      "account_snapshots_raw_input_is_object",
      sql`jsonb_typeof(${t.rawInput}) = 'object'`,
    ),
    check(
      "account_snapshots_normalized_input_is_object",
      sql`jsonb_typeof(${t.normalizedInput}) = 'object'`,
    ),
  ],
);

export const insertAccountSnapshotSchema = createInsertSchema(
  accountSnapshots,
  {
    source: (schema) => schema.trim().min(1),
    schemaVersion: (schema) => schema.trim().min(1),
  },
).omit({
  id: true,
  createdAt: true,
});
export type InsertAccountSnapshot = z.infer<typeof insertAccountSnapshotSchema>;
export type AccountSnapshot = typeof accountSnapshots.$inferSelect;
