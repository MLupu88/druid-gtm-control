// Immutable (once published) ICP profile version content. A profile has at
// most one "draft" version at a time (enforced by a partial unique index
// below) and any number of "published" versions accumulated over time.
// Publishing is a one-way transition (draft -> published, with
// published_at set in that same operation); after that, both UPDATE and
// DELETE on the row are rejected by a database trigger, not just
// application convention — see the hand-authored trigger migration
// (drizzle/0001_integrity_triggers.sql) for
// `icp_profile_versions_immutable_after_publish`. That is the only
// lifecycle mutation this table ever permits.
//
// Whether a published version is *currently active* is a property of
// icp_profiles.active_version_id (a pointer that can change over time),
// never a property of this row — activation/deactivation never mutates a
// published version's content.

import { sql } from "drizzle-orm";
import {
  check,
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
import { icpProfileVersionStatus } from "./enums";
import { icpProfiles } from "./icpProfiles";

export const icpProfileVersions = pgTable(
  "icp_profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => icpProfiles.id),
    versionNumber: integer("version_number").notNull(),
    status: icpProfileVersionStatus("status").notNull().default("draft"),
    // The actual fit/intent weights, thresholds, disqualifier rules, and
    // gate definitions for this version. Kept as jsonb rather than fully
    // normalized columns: Phase 2 has not yet designed the canonical
    // evaluator's exact input contract, and this slice must not guess at
    // (or copy from the legacy n8n formulas) a shape that Phase 2 may
    // need to change. jsonb_typeof is checked below so at least the
    // top-level shape can never be malformed.
    config: jsonb("config").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("icp_profile_versions_profile_version_number_key").on(
      t.profileId,
      t.versionNumber,
    ),
    // At most one draft version per profile at any time.
    uniqueIndex("icp_profile_versions_one_draft_per_profile")
      .on(t.profileId)
      .where(sql`${t.status} = 'draft'`),
    index("icp_profile_versions_profile_id_idx").on(t.profileId),
    check(
      "icp_profile_versions_version_number_positive",
      sql`${t.versionNumber} > 0`,
    ),
    check(
      "icp_profile_versions_config_is_object",
      sql`jsonb_typeof(${t.config}) = 'object'`,
    ),
    // Lifecycle/timestamp consistency: a draft never has a publish
    // timestamp, and a published row always does. Combined with the
    // immutability trigger, this means published_at can only ever be set
    // once, in the same operation that flips status to 'published'.
    check(
      "icp_profile_versions_published_at_matches_status",
      sql`(${t.status} = 'draft' AND ${t.publishedAt} IS NULL) OR (${t.status} = 'published' AND ${t.publishedAt} IS NOT NULL)`,
    ),
  ],
);

// Callers may only ever create a new version as a draft through this
// schema — `status` and `publishedAt` are intentionally omitted so there
// is no application-level path to insert a row that is already
// "published". Publishing is a distinct, explicit operation performed by
// the application service (UPDATE draft -> published, setting
// published_at in the same statement), not something expressible via a
// plain insert.
export const insertIcpProfileVersionSchema = createInsertSchema(
  icpProfileVersions,
).omit({
  id: true,
  createdAt: true,
  status: true,
  publishedAt: true,
});
export type InsertIcpProfileVersion = z.infer<
  typeof insertIcpProfileVersionSchema
>;
export type IcpProfileVersion = typeof icpProfileVersions.$inferSelect;
