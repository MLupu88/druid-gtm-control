import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { queueItems } from "./queue-items";

// Append-only. Every human decision (nurture/reject/manual_review/suppress/
// mark_retarget/...) is recorded here and never overwritten or deleted —
// this is the audit trail, independent of whatever queue_items.status says
// "right now."
export const operatorDecisions = pgTable(
  "operator_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    queueItemId: uuid("queue_item_id").references(() => queueItems.id),
    decision: text("decision").notNull(),
    reason: text("reason"),
    operatorId: text("operator_id"),
    operatorName: text("operator_name"),
    operatorEmail: text("operator_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("operator_decisions_account_id_idx").on(t.accountId),
    index("operator_decisions_queue_item_id_idx").on(t.queueItemId),
    index("operator_decisions_created_at_idx").on(t.createdAt),
  ],
);
