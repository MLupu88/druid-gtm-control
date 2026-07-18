import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Current-state row per external connector/capability (e.g. retell, hubspot,
// dripify, salesforge). One row per connector_key, updated in place as
// health/credential/workflow state changes. This is the durable backing
// store a future connector-health check could read from instead of
// re-deriving it ad hoc on every request.
export const connectorStates = pgTable(
  "connector_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectorKey: text("connector_key").notNull().unique(),
    capabilityMaturity: text("capability_maturity"),
    credentialState: text("credential_state"),
    healthState: text("health_state"),
    workflowState: text("workflow_state"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastFailureReason: text("last_failure_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("connector_states_health_state_idx").on(t.healthState)],
);
