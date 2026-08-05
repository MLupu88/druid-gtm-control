// GTM V2 Unit 1 — many aliases per canonical account, with explicit
// strong-vs-weak semantics and an explicit per-row normalization
// strategy.
//
// "Strong" aliases (a domain, a provider's company ID) are actually
// unique per account and get a globally-unique constraint. "Weak"
// aliases (a company name) legitimately repeat across unrelated
// accounts — two different companies can share a name — so they must
// never be forced into that same uniqueness. is_strong is a caller-
// asserted, per-row boolean rather than something derived from
// alias_type, because alias_type stays an open, uncontrolled vocabulary
// (no fixed taxonomy is defined by this unit).
//
// normalization_strategy exists for the same reason: domains and free-
// text labels are case-insensitive, but a source/provider identifier
// (e.g. a HubSpot company ID) may be case-sensitive, and lowercasing it
// could silently merge two distinct identifiers. The CHECK below
// enforces the correct canonical shape per strategy at the database
// level — uniqueness never depends solely on every future caller
// remembering to normalize correctly before insert.
//
// Mutable (no immutability trigger, unlike most tables in this schema)
// — alias reassignment is a future operation; if built, it must be
// recorded through identity_resolution_events, not by silently
// rewriting this row.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { identityAliasNormalizationStrategy } from "./enums";

export const accountAliases = pgTable(
  "account_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    aliasType: text("alias_type").notNull(),
    rawValue: text("raw_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    normalizationStrategy: identityAliasNormalizationStrategy(
      "normalization_strategy",
    ).notNull(),
    isStrong: boolean("is_strong").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "account_aliases_alias_type_not_blank",
      sql`trim(${t.aliasType}) <> ''`,
    ),
    check(
      "account_aliases_raw_value_not_blank",
      sql`trim(${t.rawValue}) <> ''`,
    ),
    check(
      "account_aliases_normalized_value_not_blank",
      sql`trim(${t.normalizedValue}) <> ''`,
    ),
    check("account_aliases_source_not_blank", sql`trim(${t.source}) <> ''`),
    // The database enforces canonical form per strategy directly — not
    // just trust that lib/identity's normalizeAliasValue was called
    // before insert. "exact" deliberately preserves case; "domain"
    // additionally rejects a value that still contains a protocol,
    // path/query/fragment, or leading "www." — a bare lower(trim())
    // alone would still let "https://example.com" or "www.example.com"
    // through.
    check(
      "account_aliases_normalized_value_matches_strategy",
      sql`
        (${t.normalizationStrategy} = 'exact' AND ${t.normalizedValue} = trim(${t.normalizedValue}))
        OR (
          ${t.normalizationStrategy} = 'case_insensitive'
          AND ${t.normalizedValue} = lower(trim(${t.normalizedValue}))
        )
        OR (
          ${t.normalizationStrategy} = 'domain'
          AND ${t.normalizedValue} = lower(trim(${t.normalizedValue}))
          AND ${t.normalizedValue} !~ '://'
          AND ${t.normalizedValue} !~ '[/?#]'
          AND ${t.normalizedValue} NOT LIKE 'www.%'
        )
      `,
    ),
    // Only strong aliases are globally unique — two different accounts
    // may freely share a weak alias (e.g. an identical company name).
    uniqueIndex("account_aliases_strong_type_normalized_value_uq")
      .on(t.aliasType, t.normalizedValue)
      .where(sql`${t.isStrong} = true`),
    index("account_aliases_account_id_idx").on(t.accountId),
  ],
);

export const insertAccountAliasSchema = createInsertSchema(accountAliases, {
  aliasType: (schema) => schema.trim().min(1),
  rawValue: (schema) => schema.trim().min(1),
  normalizedValue: (schema) => schema.trim().min(1),
  source: (schema) => schema.trim().min(1),
}).omit({
  id: true,
  createdAt: true,
});
export type InsertAccountAlias = z.infer<typeof insertAccountAliasSchema>;
export type AccountAlias = typeof accountAliases.$inferSelect;
