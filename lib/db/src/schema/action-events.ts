import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { actionAttempts } from "./action-attempts";

// Append-only event trail for an action attempt (requested -> accepted ->
// dispatched -> completed/failed, plus any provider callbacks). This is the
// history; action_attempts is the current-state row. Never updated in place.
export const actionEvents = pgTable(
  "action_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actionAttemptId: uuid("action_attempt_id")
      .notNull()
      .references(() => actionAttempts.id),
    eventType: text("event_type").notNull(),
    executionState: text("execution_state"),
    message: text("message"),
    externalReferenceId: text("external_reference_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("action_events_action_attempt_id_idx").on(t.actionAttemptId),
    index("action_events_occurred_at_idx").on(t.occurredAt),
  ],
);
