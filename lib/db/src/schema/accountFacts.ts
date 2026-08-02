// Immutable, append-only manual company-fact assertions (Unit 2 Slice 1).
// Every row is a frozen assertion of what an operator confirmed to be
// true for one (account_id, field) pair at one point in time — never
// updated or deleted (reject_update_delete trigger, see
// drizzle/0007_account_facts_immutability.sql). A correction is a new
// row referencing the assertion it replaces via supersedes_fact_id; the
// replaced row remains visible forever. "Current value" is never derived
// from this table alone — see accountFactCurrent.ts, the narrow mutable
// pointer table that tracks which assertion currently wins per
// (account_id, field).
//
// Slice 1 scope: exactly five company fit fields (see ACCOUNT_FACT_FIELDS
// below), one source ('manual-operator-v1'), no confidence, no expiry, no
// retraction. See lib/evaluator/src/profileConfig.ts's
// FIT_FIELD_ALLOWLIST for the full fit-field vocabulary this is a subset
// of — company.domain/company.name are account identity (accounts.ts),
// never manual facts, and are excluded here.
//
// No created_at: observed_at (when the fact became true) and recorded_at
// (when the row was written) are both server-generated in Slice 1 and are
// the only timestamps this table needs — a third "row insert" timestamp
// would be redundant with recorded_at.

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accounts } from "./accounts";

// Exactly the five manually-confirmable company fit fields for Slice 1.
export const ACCOUNT_FACT_FIELDS = [
  "company.industry",
  "company.country",
  "company.region",
  "company.employeeRange",
  "company.revenueRange",
] as const;
export type AccountFactField = (typeof ACCOUNT_FACT_FIELDS)[number];

// The closed value set for field = 'company.region'. Deliberately
// excludes "unknown" — an operator can never manually confirm "unknown"
// as a fact (see evaluator's RegionV1, which reserves "unknown" for the
// absence of evidence, not a confirmed value).
export const ACCOUNT_FACT_REGION_VALUES = ["us", "emea", "other"] as const;

// Mirrors lib/evaluator/src/types.ts's NonBlankString cap (500) — the
// single existing "maximum string length" definition in the repo. Kept
// as a literal constant here (not imported) because lib/db must not
// depend on lib/evaluator (the persistence layer stays evaluator-
// agnostic); the application-layer Zod validation in api-server's
// accountFacts.ts reuses lib/evaluator's own NonBlankString directly, so
// the two are validated against the exact same source of truth even
// though this constant is duplicated here for the DB-level backstop.
export const ACCOUNT_FACT_VALUE_MAX_LENGTH = 500;

export const MANUAL_OPERATOR_FACT_SOURCE = "manual-operator-v1";

export const accountFacts = pgTable(
  "account_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    field: text("field").notNull(),
    value: text("value").notNull(),
    source: text("source").notNull(),
    recordedBy: text("recorded_by").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    correctionReason: text("correction_reason"),
    // Nullable self-reference: NULL on a first-time (root) assertion,
    // set to the id of the assertion this one corrects otherwise. See
    // the composite FK below, which additionally requires the
    // superseded fact to belong to this same account_id/field.
    supersedesFactId: uuid("supersedes_fact_id"),
  },
  (t) => [
    check(
      "account_facts_field_allowed",
      sql`${t.field} IN ('company.industry', 'company.country', 'company.region', 'company.employeeRange', 'company.revenueRange')`,
    ),
    check(
      "account_facts_source_is_manual_operator_v1",
      sql`${t.source} = 'manual-operator-v1'`,
    ),
    check("account_facts_value_not_blank", sql`trim(${t.value}) <> ''`),
    // The length bound is inlined as raw SQL (not a bind parameter) — a
    // CHECK constraint's expression is fixed DDL, not a prepared
    // statement, so a `${}`-interpolated JS value here would otherwise
    // emit an invalid `$1` placeholder. Safe: the value is a hardcoded
    // module constant, never external input.
    check(
      "account_facts_value_max_length",
      sql`length(${t.value}) <= ${sql.raw(String(ACCOUNT_FACT_VALUE_MAX_LENGTH))}`,
    ),
    // Narrow, field-specific value check — company.region is the only
    // field with a closed value set; every other field only gets the
    // generic non-blank/max-length checks above. This is not a new
    // taxonomy: it is the same three-value RegionV1 subset already used
    // by the evaluator, expressed as a CHECK.
    check(
      "account_facts_region_value_allowed",
      sql`${t.field} <> 'company.region' OR ${t.value} IN ('us', 'emea', 'other')`,
    ),
    check(
      "account_facts_recorded_by_not_blank",
      sql`trim(${t.recordedBy}) <> ''`,
    ),
    // Correction-reason iff-and-only-if supersedes_fact_id: a first-time
    // assertion carries NEITHER supersedes_fact_id NOR correction_reason;
    // a correction carries BOTH, with correction_reason non-blank after
    // trimming. No third state is representable.
    check(
      "account_facts_correction_reason_iff_supersedes",
      sql`(${t.supersedesFactId} IS NULL AND ${t.correctionReason} IS NULL)
        OR (${t.supersedesFactId} IS NOT NULL AND ${t.correctionReason} IS NOT NULL AND trim(${t.correctionReason}) <> '')`,
    ),
    // Composite unique target: lets the self-referencing FK below (and
    // account_fact_current's FK, see accountFactCurrent.ts) verify a
    // referencing row's account_id/field match the referenced fact's
    // own — not just its id.
    uniqueIndex("account_facts_id_account_field_uq").on(
      t.id,
      t.accountId,
      t.field,
    ),
    // At most one assertion may supersede any given fact — prevents two
    // competing corrections from both targeting the same predecessor.
    // Plain UNIQUE on a nullable column: Postgres permits unlimited NULLs
    // (every first-time assertion) but rejects a second non-null
    // duplicate (a second row correcting the same predecessor).
    uniqueIndex("account_facts_supersedes_fact_id_uq").on(t.supersedesFactId),
    // At most one ROOT (non-correcting) assertion may ever exist per
    // (account_id, field) — prevents two independently-"first"
    // confirmations for the same field from both being inserted.
    uniqueIndex("account_facts_one_root_per_account_field")
      .on(t.accountId, t.field)
      .where(sql`${t.supersedesFactId} IS NULL`),
    // Self-referencing composite FK: when set, supersedes_fact_id must
    // reference a row with the SAME account_id and field as this row —
    // an assertion can never "correct" a fact belonging to a different
    // account or a different field.
    foreignKey({
      name: "account_facts_supersedes_same_account_field_fk",
      columns: [t.supersedesFactId, t.accountId, t.field],
      foreignColumns: [t.id, t.accountId, t.field],
    }),
    index("account_facts_account_field_idx").on(
      t.accountId,
      t.field,
      t.recordedAt,
    ),
  ],
);

// Callers may only ever create a fact through this schema — id,
// observedAt, and recordedAt are server/database-generated in Slice 1
// (no backdating), never client-supplied.
export const insertAccountFactSchema = createInsertSchema(accountFacts, {
  field: (schema) => schema,
  value: (schema) => schema.trim().min(1).max(ACCOUNT_FACT_VALUE_MAX_LENGTH),
  source: (schema) => schema,
  recordedBy: (schema) => schema.trim().min(1),
}).omit({
  id: true,
  observedAt: true,
  recordedAt: true,
});
export type InsertAccountFact = z.infer<typeof insertAccountFactSchema>;
export type AccountFact = typeof accountFacts.$inferSelect;
