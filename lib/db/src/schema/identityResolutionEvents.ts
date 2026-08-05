// GTM V2 Unit 1 — sole, append-only, auditable source of account/person
// binding history.
//
// signals.ts carries no account_id/person_id (see that file); this
// table is where a resolution decision actually lives. Every row is a
// COMPLETE binding snapshot at the moment it was written, never a
// partial delta — so "the latest row for a given signal_id, ordered by
// (created_at, id), is the authoritative current binding" is actually
// true. A person_resolved row always restates account_id even when an
// earlier row already resolved the account, specifically so a reader
// never has to stitch together more than one row to know the current
// binding. (An earlier design used granular event types like
// account_matched/person_created, where the latest row could be
// person-only and silently drop the previously-resolved account_id —
// that ambiguity is why this table's shape is what it is.)
//
// A future current-pointer/read model (mirroring account_fact_current)
// may be added later for efficient "current binding" queries without
// touching this table; deliberately not built in this unit.
//
// This table does NOT model alias reassignment or account-merge
// auditing — that would require dedicated previous-owner/new-owner
// columns this unit doesn't add, since nothing in this unit produces
// such an event. Don't infer that claim from this table's existence.
//
// Append-only: a database trigger (identity_resolution_events_immutable,
// see drizzle/0009_signals_identity_resolution_immutability.sql)
// rejects UPDATE and DELETE.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accounts } from "./accounts";
import {
  identityConfidence,
  identityMatchAction,
  identityResolutionLevel,
  identityResolutionOutcome,
} from "./enums";
import { people } from "./people";
import { signals } from "./signals";

export const identityResolutionEvents = pgTable(
  "identity_resolution_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id),
    outcome: identityResolutionOutcome("outcome").notNull(),
    resolutionLevel: identityResolutionLevel("resolution_level").notNull(),
    resolutionMethod: text("resolution_method").notNull(),
    // Reuses the existing low|medium|high enum (account_evaluations'
    // identity_confidence) — a closed, already-documented, DB-enforced
    // representation, not a new numeric score.
    confidence: identityConfidence("confidence").notNull(),
    resolverVersion: text("resolver_version").notNull(),
    candidateMatches: jsonb("candidate_matches"),
    accountId: uuid("account_id").references(() => accounts.id),
    accountMatchAction: identityMatchAction("account_match_action"),
    personId: uuid("person_id").references(() => people.id),
    personMatchAction: identityMatchAction("person_match_action"),
    matchedAliasType: text("matched_alias_type"),
    matchedAliasValue: text("matched_alias_value"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "identity_resolution_events_resolution_method_not_blank",
      sql`trim(${t.resolutionMethod}) <> ''`,
    ),
    check(
      "identity_resolution_events_resolver_version_not_blank",
      sql`trim(${t.resolverVersion}) <> ''`,
    ),
    check(
      "identity_resolution_events_matched_alias_type_not_blank",
      sql`${t.matchedAliasType} IS NULL OR trim(${t.matchedAliasType}) <> ''`,
    ),
    check(
      "identity_resolution_events_matched_alias_value_not_blank",
      sql`${t.matchedAliasValue} IS NULL OR trim(${t.matchedAliasValue}) <> ''`,
    ),
    check(
      "identity_resolution_events_reason_not_blank",
      sql`${t.reason} IS NULL OR trim(${t.reason}) <> ''`,
    ),
    check(
      "identity_resolution_events_candidate_matches_is_array",
      sql`${t.candidateMatches} IS NULL OR jsonb_typeof(${t.candidateMatches}) = 'array'`,
    ),
    // Every row is a complete snapshot: account_resolved and
    // person_resolved both require account_id; unresolved requires it
    // null.
    check(
      "identity_resolution_events_account_id_matches_outcome",
      sql`(${t.outcome} = 'unresolved' AND ${t.accountId} IS NULL)
        OR (${t.outcome} <> 'unresolved' AND ${t.accountId} IS NOT NULL)`,
    ),
    // Only person_resolved carries a person — and (from the CHECK
    // above) it also always carries account_id, so a person_resolved
    // row is always the complete two-sided binding, never person-only.
    check(
      "identity_resolution_events_person_id_matches_outcome",
      sql`(${t.outcome} = 'person_resolved' AND ${t.personId} IS NOT NULL)
        OR (${t.outcome} <> 'person_resolved' AND ${t.personId} IS NULL)`,
    ),
    check(
      "identity_resolution_events_account_match_action_matches_outcome",
      sql`(${t.outcome} = 'unresolved' AND ${t.accountMatchAction} IS NULL)
        OR (${t.outcome} <> 'unresolved' AND ${t.accountMatchAction} IS NOT NULL)`,
    ),
    check(
      "identity_resolution_events_person_match_action_matches_outcome",
      sql`(${t.outcome} = 'person_resolved' AND ${t.personMatchAction} IS NOT NULL)
        OR (${t.outcome} <> 'person_resolved' AND ${t.personMatchAction} IS NULL)`,
    ),
    // "Company-level intelligence never manufactures a person" — same
    // backstop as lib/identity's NormalizedSignalV1Schema.
    check(
      "identity_resolution_events_person_requires_contact_level",
      sql`${t.personId} IS NULL OR ${t.resolutionLevel} IN ('contact', 'known_crm_contact')`,
    ),
    // resolution_level is not a free-floating "what level did we detect"
    // field — it is pinned to an exact value per outcome, not merely
    // "not anonymous" or "not the wrong bucket". This is stricter than
    // (and makes redundant, for the person_resolved case, but still
    // correct) the person_requires_contact_level CHECK above: that one
    // stays in place as a narrower, self-explanatory backstop should this
    // CHECK ever be loosened.
    check(
      "identity_resolution_events_resolution_level_matches_outcome",
      sql`
        (${t.outcome} = 'unresolved' AND ${t.resolutionLevel} = 'anonymous')
        OR (${t.outcome} = 'account_resolved' AND ${t.resolutionLevel} = 'company')
        OR (${t.outcome} = 'person_resolved' AND ${t.resolutionLevel} IN ('contact', 'known_crm_contact'))
      `,
    ),
    // The exact ordering key "latest row for this signal" queries need
    // — (created_at, id) gives a deterministic tiebreak if two rows
    // share a timestamp.
    index("identity_resolution_events_signal_id_created_at_id_idx").on(
      t.signalId,
      t.createdAt,
      t.id,
    ),
    index("identity_resolution_events_account_id_idx").on(t.accountId),
  ],
);

export const insertIdentityResolutionEventSchema = createInsertSchema(
  identityResolutionEvents,
  {
    resolutionMethod: (schema) => schema.trim().min(1),
    resolverVersion: (schema) => schema.trim().min(1),
    matchedAliasType: (schema) => schema.trim().min(1).nullable(),
    matchedAliasValue: (schema) => schema.trim().min(1).nullable(),
    reason: (schema) => schema.trim().min(1).nullable(),
    candidateMatches: z.array(z.unknown()).nullable().optional(),
  },
).omit({
  id: true,
  createdAt: true,
});
export type InsertIdentityResolutionEvent = z.infer<
  typeof insertIdentityResolutionEventSchema
>;
export type IdentityResolutionEvent =
  typeof identityResolutionEvents.$inferSelect;
