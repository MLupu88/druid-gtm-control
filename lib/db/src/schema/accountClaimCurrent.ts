// Milestone 4A — mutable, rebuildable pointer table: which account_claims
// row currently wins per (account_id, claim_key), mirroring
// accountFactCurrent.ts's own shape exactly. Holds no historical content
// of its own. No immutability trigger applies here (contrast
// account_claims.ts).
//
// ABSENCE OF A ROW MEANS UNKNOWN: unlike account_fact_current (every
// field it tracks always resolves to either "confirmed" or "no manual
// fact yet"), account_claim_current's row for a given (account_id,
// claim_key) may be explicitly DELETED — this is what a human rejection
// (account_claims.status = 'rejected') does: it reverts that key to
// Unknown rather than pointing at a row with no value. See
// accountClaims.ts (the service layer) for the full read/write rules.
//
// The composite FK below guarantees claim_id belongs to the SAME
// account_id/claim_key as this pointer row.

import { foreignKey, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountClaims } from "./accountClaims";
import { accounts } from "./accounts";

export const accountClaimCurrent = pgTable(
  "account_claim_current",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    claimKey: text("claim_key").notNull(),
    claimId: uuid("claim_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.claimKey] }),
    foreignKey({
      name: "account_claim_current_claim_same_account_key_fk",
      columns: [t.claimId, t.accountId, t.claimKey],
      foreignColumns: [accountClaims.id, accountClaims.accountId, accountClaims.claimKey],
    }),
  ],
);

export const insertAccountClaimCurrentSchema = createInsertSchema(
  accountClaimCurrent,
).omit({
  updatedAt: true,
});
export type InsertAccountClaimCurrent = z.infer<
  typeof insertAccountClaimCurrentSchema
>;
export type AccountClaimCurrent = typeof accountClaimCurrent.$inferSelect;
