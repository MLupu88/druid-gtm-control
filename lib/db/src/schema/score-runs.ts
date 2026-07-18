import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// Append-only scoring history. One row per scoring pass, from either engine
// model (e.g. the per-signal model or the account-shadow accumulator model).
// risk_state is intentionally a free-text state, not a numeric column — the
// upstream engine treats risk as a gate flag (e.g. blocked/clear), not a
// graduated score dimension, so this mirrors that shape rather than forcing
// a number where the source of truth isn't one.
export const scoreRuns = pgTable(
  "score_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    model: text("model").notNull(),
    ruleVersion: text("rule_version"),
    fitScore: integer("fit_score"),
    interestScore: integer("interest_score"),
    identityScore: integer("identity_score"),
    actionabilityScore: integer("actionability_score"),
    timingScore: integer("timing_score"),
    riskState: text("risk_state"),
    totalScore: integer("total_score"),
    components: jsonb("components").$type<Record<string, unknown>>(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
  },
  (t) => [
    index("score_runs_account_id_idx").on(t.accountId),
    index("score_runs_calculated_at_idx").on(t.calculatedAt),
    index("score_runs_model_idx").on(t.model),
  ],
);
