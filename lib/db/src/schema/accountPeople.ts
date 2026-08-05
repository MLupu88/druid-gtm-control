// GTM V2 Unit 1 — many-to-many account/person relationship, carrying
// the minimal bounded relationship history the product needs (title,
// relationship_type, current/first-seen/last-seen markers) — not a
// full CRM model, and not an append-only ledger of every change. A
// single mutable row per (account_id, person_id) pair; title/
// relationship_type/is_current/last_seen_at update in place as new
// evidence arrives.
//
// title lives here (not on people.ts) because it's a fact about a
// person's relationship to *this* account, not about the person
// globally — the same person can hold different titles at different
// companies over time.

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
import { people } from "./people";

export const accountPeople = pgTable(
  "account_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    title: text("title"),
    relationshipType: text("relationship_type"),
    isCurrent: boolean("is_current").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source").notNull(),
  },
  (t) => [
    check(
      "account_people_title_not_blank",
      sql`${t.title} IS NULL OR trim(${t.title}) <> ''`,
    ),
    check(
      "account_people_relationship_type_not_blank",
      sql`${t.relationshipType} IS NULL OR trim(${t.relationshipType}) <> ''`,
    ),
    check("account_people_source_not_blank", sql`trim(${t.source}) <> ''`),
    check(
      "account_people_last_seen_after_first_seen",
      sql`${t.lastSeenAt} >= ${t.firstSeenAt}`,
    ),
    uniqueIndex("account_people_account_id_person_id_uq").on(
      t.accountId,
      t.personId,
    ),
    index("account_people_person_id_idx").on(t.personId),
  ],
);

export const insertAccountPersonSchema = createInsertSchema(accountPeople, {
  title: (schema) => schema.trim().min(1).nullable(),
  relationshipType: (schema) => schema.trim().min(1).nullable(),
  source: (schema) => schema.trim().min(1),
}).omit({
  id: true,
});
export type InsertAccountPerson = z.infer<typeof insertAccountPersonSchema>;
export type AccountPerson = typeof accountPeople.$inferSelect;
