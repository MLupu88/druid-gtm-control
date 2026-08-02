// Mutable, rebuildable pointer table: which account_facts row currently
// wins per (account_id, field). Holds no historical content of its own —
// it is fully derivable at any time by re-selecting the winning assertion
// per (account_id, field) from account_facts, so its mutability never
// compromises that table's immutability. No immutability trigger applies
// here (contrast with every other table in this schema, and with
// account_facts.ts itself).
//
// The composite FK below guarantees fact_id belongs to the SAME
// account_id/field as this pointer row — a database guarantee, not an
// application-level convention, and requires no trigger: Postgres
// composite foreign keys enforce it directly (see account_facts.ts's
// account_facts_id_account_field_uq unique index, the FK's target).
//
// Concurrency: updates are compare-and-swap, gated on the row's current
// fact_id — see artifacts/api-server/src/services/accountFacts.ts for the
// transactional read-modify-write algorithm this table's primary key
// enables.

import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountFacts } from "./accountFacts";
import { accounts } from "./accounts";

export const accountFactCurrent = pgTable(
  "account_fact_current",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    field: text("field").notNull(),
    factId: uuid("fact_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.field] }),
    // fact_id must belong to a row whose own account_id/field match this
    // pointer row's — enforced by the database, not just the service
    // layer's query logic.
    foreignKey({
      name: "account_fact_current_fact_same_account_field_fk",
      columns: [t.factId, t.accountId, t.field],
      foreignColumns: [accountFacts.id, accountFacts.accountId, accountFacts.field],
    }),
  ],
);

export const insertAccountFactCurrentSchema = createInsertSchema(
  accountFactCurrent,
).omit({
  updatedAt: true,
});
export type InsertAccountFactCurrent = z.infer<
  typeof insertAccountFactCurrentSchema
>;
export type AccountFactCurrent = typeof accountFactCurrent.$inferSelect;
