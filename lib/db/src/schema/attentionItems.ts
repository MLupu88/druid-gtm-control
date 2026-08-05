// GTM V2 Stage 3, Unit 1 — Attention Model foundation.
//
// An attention item is an explicit operational record explaining why a
// canonical account needs human review. This table is the sole source of
// truth for that: Needs Attention (a future read model, not built in this
// unit) is nothing but canonical accounts joined against
// attention_items WHERE status = 'open'; All Accounts stays untouched —
// resolving every attention item for an account never removes it from
// accounts, signals, evidence, identity history, or evaluation history.
//
// Lifecycle is deliberately NOT a fully append-only ledger (contrast with
// identity_resolution_events): an attention item has exactly one
// meaningful transition in its life (open -> resolved), not an arbitrarily
// long, ambiguous sequence of partial states. Modeling that as a separate
// attention_item_events table plus a derived "current status" pointer
// would be exactly the speculative workflow-engine complexity this unit
// is meant to avoid. Instead this table follows icp_profile_versions'
// shape: a row transitions exactly once via UPDATE, then locks forever.
//
// The lock here is stricter than icp_profile_versions', though — see
// drizzle/<generated>_attention_items_lifecycle.sql
// (attention_items_lifecycle_guard trigger):
//   - DELETE is rejected unconditionally, regardless of status. An
//     attention item is never removable, not even while still open.
//   - Every column set at creation (id, account_id, reason_code,
//     reason_detail, source, source_ref, context, created_at, created_by)
//     is immutable from the moment the row exists — not just after
//     resolution. There is no "edit an open item's detail" operation.
//   - The ONLY permitted UPDATE, ever, is OLD.status = 'open' -> NEW.status
//     = 'resolved', setting resolved_at/resolved_by/resolution_reason in
//     the same statement, with every other column unchanged. Once
//     resolved, the row accepts no further UPDATE at all.
//   - "Reopening" is never a mutation of a resolved row — it means
//     inserting a new attention_items row. That keeps every row a single,
//     permanently truthful audit record instead of a rewritten one.
//
// reason_code is deliberately open text (like signals.signal_type), not
// an enum — concrete reasons will be invented per-producer as identity,
// evaluation, enrichment, Client Radar, and action integrations land in
// later units, none of which this unit implements. Because reason_code
// participates in the dedup indexes below, it gets the same canonical-form
// CHECK signals.source has, so case/whitespace drift can't defeat
// deduplication.
//
// source_ref is an opaque, nullable, exact-match pointer into whatever
// table actually triggered this item (a signal id, an evaluation id, a
// research run id, ...) — never a real foreign key, since which table it
// points into depends on source. NULL means "no specific triggering row"
// (e.g. a manual item).
//
// Deduplication (requirement: duplicate active items for the same
// account/reason/source context must be prevented) is enforced by two
// partial unique indexes below, split on whether source_ref is present —
// Postgres treats NULL as distinct in a unique index, so a single index
// spanning source_ref could never dedup the "no ref" case.
//
// created_by is NOT NULL and caller-supplied — never silently defaulted.
// A human operator supplies their own identifier; an automated producer
// must supply a stable actor string of its own choosing (e.g.
// "system:identity_resolution", "system:evaluation",
// "system:enrichment") — this schema does not invent or default one.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accounts } from "./accounts";
import { attentionItemStatus, attentionSource } from "./enums";

export const attentionItems = pgTable(
  "attention_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),

    reasonCode: text("reason_code").notNull(),
    reasonDetail: text("reason_detail"),

    source: attentionSource("source").notNull(),
    sourceRef: text("source_ref"),

    context: jsonb("context").notNull().default({}),

    status: attentionItemStatus("status").notNull().default("open"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by").notNull(),

    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolutionReason: text("resolution_reason"),
  },
  (t) => [
    check(
      "attention_items_reason_code_not_blank",
      sql`trim(${t.reasonCode}) <> ''`,
    ),
    // Same canonical-form guarantee as signals.source — the database
    // itself refuses a non-canonical reason_code, since two differently-
    // cased values would otherwise silently defeat the dedup indexes
    // below.
    check(
      "attention_items_reason_code_is_canonical_form",
      sql`${t.reasonCode} = lower(trim(${t.reasonCode}))`,
    ),
    check(
      "attention_items_reason_detail_not_blank_if_present",
      sql`${t.reasonDetail} IS NULL OR trim(${t.reasonDetail}) <> ''`,
    ),
    check(
      "attention_items_source_ref_not_blank_if_present",
      sql`${t.sourceRef} IS NULL OR trim(${t.sourceRef}) <> ''`,
    ),
    check(
      "attention_items_created_by_not_blank",
      sql`trim(${t.createdBy}) <> ''`,
    ),
    check(
      "attention_items_context_is_object",
      sql`jsonb_typeof(${t.context}) = 'object'`,
    ),
    // No ambiguous half-resolved rows: 'open' requires all three
    // resolution fields NULL; 'resolved' requires all three present and
    // non-blank where textual. Mirrors
    // account_evaluations_completed_requires_core_outputs.
    check(
      "attention_items_resolution_fields_iff_resolved",
      sql`
        (${t.status} = 'open'
          AND ${t.resolvedAt} IS NULL
          AND ${t.resolvedBy} IS NULL
          AND ${t.resolutionReason} IS NULL)
        OR (${t.status} = 'resolved'
          AND ${t.resolvedAt} IS NOT NULL
          AND ${t.resolvedBy} IS NOT NULL AND trim(${t.resolvedBy}) <> ''
          AND ${t.resolutionReason} IS NOT NULL AND trim(${t.resolutionReason}) <> '')
      `,
    ),
    // A resolution can never predate the item it resolves.
    check(
      "attention_items_resolved_at_after_created_at",
      sql`${t.resolvedAt} IS NULL OR ${t.resolvedAt} >= ${t.createdAt}`,
    ),
    // Dedup, split on source_ref presence — NULL is never equal to NULL
    // in a unique index, so the "no specific triggering row" case (e.g. a
    // manual item) needs its own index, scoped to (account, reason,
    // source) alone, to still be enforced at the database level rather
    // than left to "handled idempotently" at the application layer.
    uniqueIndex("attention_items_open_dedup_with_ref_uq")
      .on(t.accountId, t.reasonCode, t.source, t.sourceRef)
      .where(sql`${t.status} = 'open' AND ${t.sourceRef} IS NOT NULL`),
    uniqueIndex("attention_items_open_dedup_without_ref_uq")
      .on(t.accountId, t.reasonCode, t.source)
      .where(sql`${t.status} = 'open' AND ${t.sourceRef} IS NULL`),
    index("attention_items_account_id_created_at_idx").on(
      t.accountId,
      t.createdAt,
    ),
    // Cheap "does this account have any unresolved item" / Needs
    // Attention join.
    index("attention_items_open_account_idx")
      .on(t.accountId)
      .where(sql`${t.status} = 'open'`),
    index("attention_items_status_created_at_idx").on(t.status, t.createdAt),
  ],
);

// Callers may only ever create an open item through this schema —
// status/resolvedAt/resolvedBy/resolutionReason are omitted because
// creation always starts 'open' with all three NULL (DB-enforced by
// attention_items_resolution_fields_iff_resolved); the open -> resolved
// transition is a separate, narrowly-scoped UPDATE the application layer
// performs directly, not through this insert schema. createdBy is NOT
// omitted — unlike accountEvaluations/accountDecisions' server-stamped
// createdBy, this one is caller-supplied and required (see module
// comment): there is no server-side identity to silently stamp here for
// automated producers.
export const insertAttentionItemSchema = createInsertSchema(attentionItems, {
  reasonCode: (schema) => schema.trim().min(1),
  reasonDetail: (schema) => schema.trim().min(1).nullable(),
  sourceRef: (schema) => schema.trim().min(1).nullable(),
  createdBy: (schema) => schema.trim().min(1),
  context: z.record(z.string(), z.unknown()).default({}),
}).omit({
  id: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
  resolvedBy: true,
  resolutionReason: true,
});
export type InsertAttentionItem = z.infer<typeof insertAttentionItemSchema>;
export type AttentionItem = typeof attentionItems.$inferSelect;
