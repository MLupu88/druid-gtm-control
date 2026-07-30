// Persists a single Client Radar research attempt for an account. Each
// attempt is its own row — there is no separate event-log table: a
// research run only ever transitions status within this same row, from
// 'submitting' through to a terminal 'completed'/'failed' outcome (see
// clientRadarResearchStatusEnum in enums.ts for why the vocabulary is
// exactly those five values).
//
// clientRadarRunId is null exactly while the row is still 'submitting' —
// either because Client Radar hasn't yet returned a run ID, or because the
// submission itself failed before one was ever assigned. The partial
// unique index below prevents more than one concurrently active
// (submitting/queued/running) attempt per account, so a new research
// request can't be started while one is already in flight.

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accounts as accountsTable } from "./accounts";
import { clientRadarResearchStatusEnum } from "./enums";

export const clientRadarResearchRunsTable = pgTable(
  "client_radar_research_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    clientRadarRunId: text("client_radar_run_id").unique(),
    status: clientRadarResearchStatusEnum("status")
      .notNull()
      .default("submitting"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    lastError: text("last_error"),
    accountPayload: jsonb("account_payload").$type<Record<string, unknown>>(),
    evidencePayload: jsonb("evidence_payload").$type<unknown[]>(),
    resultSchemaVersion: integer("result_schema_version")
      .notNull()
      .default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("client_radar_research_runs_account_id_idx").on(
      t.accountId,
      t.createdAt,
    ),
    // At most one active (submitting/queued/running) research attempt per
    // account at any time.
    uniqueIndex("client_radar_research_runs_one_active_per_account")
      .on(t.accountId)
      .where(sql`${t.status} IN ('submitting', 'queued', 'running')`),
  ],
);

export const insertClientRadarResearchRunSchema = createInsertSchema(
  clientRadarResearchRunsTable,
  {
    accountPayload: z.record(z.string(), z.unknown()).nullable().optional(),
    evidencePayload: z.array(z.unknown()).nullable().optional(),
  },
).omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientRadarResearchRun = z.infer<
  typeof insertClientRadarResearchRunSchema
>;
export type ClientRadarResearchRun =
  typeof clientRadarResearchRunsTable.$inferSelect;
