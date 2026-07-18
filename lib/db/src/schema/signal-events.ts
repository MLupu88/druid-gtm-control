import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// Append-only raw/normalized signal log. Idempotent on event_id so the same
// upstream signal can be replayed safely without creating duplicate rows.
export const signalEvents = pgTable(
  "signal_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull().unique(),
    accountId: uuid("account_id").references(() => accounts.id),
    source: text("source"),
    signalType: text("signal_type"),
    resolutionLevel: text("resolution_level"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    normalizedPayload: jsonb("normalized_payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("signal_events_account_id_idx").on(t.accountId),
    index("signal_events_occurred_at_idx").on(t.occurredAt),
  ],
);
