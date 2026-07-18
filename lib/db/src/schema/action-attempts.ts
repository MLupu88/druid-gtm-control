import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { operatorDecisions } from "./operator-decisions";

// One row per attempted capability invocation (voice call, email send,
// LinkedIn send, owner alert, ...). Idempotent on idempotency_key so a
// retried request from the frontend never creates a duplicate attempt.
//
// capability_maturity records, at the time of the attempt, where the
// capability sat on the maturity ladder (connected, decision_only,
// outbox_only, manual_export, contract_ready, awaiting_credentials,
// not_configured, planned) — this is what makes it possible to tell a
// genuine external execution apart from an internal marker later, without
// having to re-derive it from n8n workflow state after the fact.
export const actionAttempts = pgTable(
  "action_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    decisionId: uuid("decision_id").references(() => operatorDecisions.id),
    capability: text("capability").notNull(),
    capabilityMaturity: text("capability_maturity").notNull(),
    executionState: text("execution_state").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    requestedBy: text("requested_by"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    externalReferenceId: text("external_reference_id"),
    provider: text("provider"),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("action_attempts_account_id_idx").on(t.accountId),
    index("action_attempts_decision_id_idx").on(t.decisionId),
    index("action_attempts_execution_state_idx").on(t.executionState),
    index("action_attempts_capability_idx").on(t.capability),
  ],
);
