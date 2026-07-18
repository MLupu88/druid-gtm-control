import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// Mutable current-state row per queue entry (mirrors ICP_Review_Queue /
// ICP_Account_Queue). Full decision history lives in operator_decisions,
// not here — this table tracks "where is this item right now."
export const queueItems = pgTable(
  "queue_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    queueType: text("queue_type").notNull(),
    status: text("status"),
    recommendedOutput: text("recommended_output"),
    recommendedAction: text("recommended_action"),
    assignedTo: text("assigned_to"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("queue_items_account_id_idx").on(t.accountId),
    index("queue_items_status_idx").on(t.status),
    index("queue_items_queue_type_idx").on(t.queueType),
  ],
);
