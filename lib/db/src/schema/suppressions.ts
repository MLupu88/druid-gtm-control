import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// Append-only-in-spirit: a suppression is never deleted, only revoked
// (active=false, revoked_at set) so the history of who was ever suppressed
// and why is preserved.
export const suppressions = pgTable(
  "suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id),
    companyDomain: text("company_domain"),
    contactEmail: text("contact_email"),
    reason: text("reason"),
    source: text("source"),
    createdBy: text("created_by"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("suppressions_account_id_idx").on(t.accountId),
    index("suppressions_company_domain_idx").on(t.companyDomain),
    index("suppressions_contact_email_idx").on(t.contactEmail),
    index("suppressions_active_idx").on(t.active),
  ],
);
