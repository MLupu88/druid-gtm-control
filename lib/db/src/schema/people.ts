// GTM V2 Unit 1 — canonical, account-agnostic person identity record.
//
// Deliberately no FK to accounts here — a person's relationship(s) to
// an account (or accounts, over time) live in account_people, not here.
// This keeps a person a standalone identity record rather than forcing
// it to belong to exactly one account.
//
// Not identityless: every row must carry at least one real identity
// attribute (full name, work email, LinkedIn URL, or a source external
// ID) — an all-null row is a ghost contact, not a person. This is
// enforced here at the CHECK level and, one layer up, at
// lib/identity's NormalizedSignalV1Schema for any `person` object
// headed toward persistence.
//
// title deliberately does NOT live here — a title is a fact about a
// person's relationship to one account, not about the person globally
// (the same person can hold different titles at different companies
// over time). See account_people.ts.
//
// Multi-source person matching beyond the single external_id/
// external_id_source pair below (a person_aliases table, symmetric to
// account_aliases) is out of this unit's bounded scope.

import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name"),
    workEmail: text("work_email"),
    linkedinUrl: text("linkedin_url"),
    externalId: text("external_id"),
    externalIdSource: text("external_id_source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "people_full_name_not_blank",
      sql`${t.fullName} IS NULL OR trim(${t.fullName}) <> ''`,
    ),
    check(
      "people_work_email_not_blank",
      sql`${t.workEmail} IS NULL OR trim(${t.workEmail}) <> ''`,
    ),
    // The database itself refuses a non-canonical work_email, not just
    // trust that lib/identity's normalizeWorkEmail was called first.
    check(
      "people_work_email_is_canonical_form",
      sql`${t.workEmail} IS NULL OR ${t.workEmail} = lower(trim(${t.workEmail}))`,
    ),
    check(
      "people_linkedin_url_not_blank",
      sql`${t.linkedinUrl} IS NULL OR trim(${t.linkedinUrl}) <> ''`,
    ),
    // external_id_source is required iff external_id is set — same
    // iff-pattern as account_facts.correction_reason.
    check(
      "people_external_id_iff_source",
      sql`(${t.externalId} IS NULL AND ${t.externalIdSource} IS NULL)
        OR (${t.externalId} IS NOT NULL AND ${t.externalIdSource} IS NOT NULL AND trim(${t.externalIdSource}) <> '')`,
    ),
    // Not identityless: at least one real identity attribute is
    // required.
    check(
      "people_has_identity_attribute",
      sql`${t.fullName} IS NOT NULL OR ${t.workEmail} IS NOT NULL OR ${t.linkedinUrl} IS NOT NULL OR ${t.externalId} IS NOT NULL`,
    ),
    uniqueIndex("people_work_email_uq")
      .on(t.workEmail)
      .where(sql`${t.workEmail} IS NOT NULL`),
    uniqueIndex("people_external_id_source_id_uq")
      .on(t.externalIdSource, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  ],
);

export const insertPersonSchema = createInsertSchema(people, {
  fullName: (schema) => schema.trim().min(1).nullable(),
  workEmail: (schema) => schema.trim().min(1).nullable(),
  linkedinUrl: (schema) => schema.trim().min(1).nullable(),
  externalId: (schema) => schema.trim().min(1).nullable(),
  externalIdSource: (schema) => schema.trim().min(1).nullable(),
})
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  // Mirrors the DB's people_has_identity_attribute CHECK at the app
  // layer too — a bare CHECK constraint isn't visible to Zod, so an
  // all-null (ghost) person would otherwise parse successfully here and
  // only get rejected once it reached the database.
  .superRefine((val, ctx) => {
    if (
      val.fullName == null &&
      val.workEmail == null &&
      val.linkedinUrl == null &&
      val.externalId == null
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "person must include at least one of fullName, workEmail, linkedinUrl, or externalId",
      });
    }
  });
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof people.$inferSelect;
