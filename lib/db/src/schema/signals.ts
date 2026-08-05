// GTM V2 Unit 1 — append-only ledger of normalized incoming evidence.
//
// Deliberately carries NO account_id/person_id: this table never claims
// a canonical account/person binding. Resolving a signal only ever
// means appending a row to identity_resolution_events (see that file);
// nothing here is ever updated to reflect a resolution outcome — an
// immutable evidence row cannot also be a mutable binding pointer
// without becoming ambiguous about which one wins.
//
// observed_resolution_level (not resolution_level) describes what the
// SOURCE claimed/identified at ingestion time. It is not, and must not
// read as, the current canonical identity binding — that authority
// belongs exclusively to identity_resolution_events.
//
// raw_payload holds the untouched original source payload;
// normalized_payload holds the full validated NormalizedSignalV1 object
// (lib/identity/src/types.ts), serialized. company_domain/company_name/
// campaign_id/campaign_name are flattened from that same object purely
// for query convenience — every other field (page URL, form detail,
// UTM/click IDs, external IDs) is preserved in normalized_payload only.
//
// Append-only: a database trigger (signals_immutable, see
// drizzle/0009_signals_identity_resolution_immutability.sql) rejects
// UPDATE and DELETE. Because this table carries no binding to mutate,
// there is nothing a resolution service would ever need to update here.

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
import { identityResolutionLevel } from "./enums";

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    signalType: text("signal_type").notNull(),
    observedResolutionLevel: identityResolutionLevel(
      "observed_resolution_level",
    ).notNull(),
    companyDomain: text("company_domain"),
    companyName: text("company_name"),
    campaignId: text("campaign_id"),
    campaignName: text("campaign_name"),
    schemaVersion: text("schema_version").notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    normalizedPayload: jsonb("normalized_payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The canonical, collision-safe dedup guarantee — "duplicate source
    // delivery is safely rejected" rests on this composite constraint
    // (a tuple comparison, not a string-concatenation key that could be
    // ambiguous across delimiter-containing values).
    uniqueIndex("signals_source_source_event_id_uq").on(
      t.source,
      t.sourceEventId,
    ),
    index("signals_company_domain_occurred_at_idx").on(
      t.companyDomain,
      t.occurredAt,
    ),
    check("signals_source_not_blank", sql`trim(${t.source}) <> ''`),
    // The database itself refuses a non-canonical source, not just
    // trust that a caller lowercased/trimmed it first.
    check(
      "signals_source_is_canonical_form",
      sql`${t.source} = lower(trim(${t.source}))`,
    ),
    check(
      "signals_source_event_id_not_blank",
      sql`trim(${t.sourceEventId}) <> ''`,
    ),
    check("signals_signal_type_not_blank", sql`trim(${t.signalType}) <> ''`),
    check(
      "signals_schema_version_not_blank",
      sql`trim(${t.schemaVersion}) <> ''`,
    ),
    check(
      "signals_raw_payload_is_object",
      sql`jsonb_typeof(${t.rawPayload}) = 'object'`,
    ),
    check(
      "signals_normalized_payload_is_object",
      sql`jsonb_typeof(${t.normalizedPayload}) = 'object'`,
    ),
    // A meaningful domain-format CHECK, not just lower(trim()) — that
    // alone would still permit "www.example.com" or
    // "https://example.com" through. Mirrors account_aliases' "domain"
    // normalization_strategy CHECK exactly.
    check(
      "signals_company_domain_is_normalized_domain_shape",
      sql`
        ${t.companyDomain} IS NULL
        OR (
          ${t.companyDomain} = lower(trim(${t.companyDomain}))
          AND ${t.companyDomain} !~ '://'
          AND ${t.companyDomain} !~ '[/?#]'
          AND ${t.companyDomain} NOT LIKE 'www.%'
        )
      `,
    ),
  ],
);

export const insertSignalSchema = createInsertSchema(signals, {
  source: (schema) => schema.trim().min(1),
  sourceEventId: (schema) => schema.trim().min(1),
  signalType: (schema) => schema.trim().min(1),
  schemaVersion: (schema) => schema.trim().min(1),
  rawPayload: z.record(z.string(), z.unknown()),
  normalizedPayload: z.record(z.string(), z.unknown()),
}).omit({
  id: true,
  createdAt: true,
});
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signals.$inferSelect;
