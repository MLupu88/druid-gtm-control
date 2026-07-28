// Minimal canonical account identity anchor. Deliberately thin: this is
// just enough for account_snapshots/account_evaluations/account_decisions
// to have something stable to reference. Package 3 (Leads workspace) owns
// the full account record shape (ownership, lifecycle stage, corrections,
// etc.) and is expected to extend this table, not replace it — see
// ROADMAP.md's dependency note that Package 3 depends on canonical
// accounts from Package 2, Phase 1.
//
// Unlike every other table in this schema, accounts is an ordinary
// mutable identity record, not a versioned/audit artifact — no
// immutability trigger applies here.

import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountKey: text("account_key").notNull().unique(),
    companyDomain: text("company_domain"),
    companyName: text("company_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Database integrity must not depend on the application schema alone —
  // the trim/min-length check below duplicates (deliberately) the Zod
  // validation on insertAccountSchema.
  (t) => [
    check("accounts_account_key_not_blank", sql`trim(${t.accountKey}) <> ''`),
  ],
);

export const insertAccountSchema = createInsertSchema(accounts, {
  accountKey: (schema) => schema.trim().min(1),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;
