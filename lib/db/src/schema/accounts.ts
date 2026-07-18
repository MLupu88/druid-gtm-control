import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// One row per resolved account (company/contact cluster), mirroring the
// account-level identity the n8n scoring engines resolve to (account_key).
// This is a durable ledger snapshot, not a live cache — Sheets remains the
// system of record for existing routes in this unit.
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountKey: text("account_key").notNull().unique(),
    companyDomain: text("company_domain"),
    companyName: text("company_name"),
    identityResolution: text("identity_resolution"),
    matchConfidence: text("match_confidence"),
    currentOutput: text("current_output"),
    currentScore: integer("current_score"),
    currentQueueStatus: text("current_queue_status"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("accounts_company_domain_idx").on(t.companyDomain),
    index("accounts_current_queue_status_idx").on(t.currentQueueStatus),
  ],
);
