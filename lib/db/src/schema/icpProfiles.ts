// The top-level named ICP profile (e.g. "Enterprise Banking ICP"). A
// profile row itself holds no scoring rules — those live in versioned,
// immutable icpProfileVersions rows. activeVersionId is a pointer to
// whichever published version is currently active; it can change over
// time without ever mutating the version content it points to.
//
// A database trigger (icp_profiles_active_version_must_be_published, see
// drizzle/0001_integrity_triggers.sql) enforces that activeVersionId, when
// set, always references a PUBLISHED version belonging to this same
// profile. Setting activeVersionId back to NULL is how a profile is
// deactivated; icpProfileActivationEvents is the append-only audit trail
// of every activation/deactivation, kept separate so activating a new
// version never requires rewriting history.

import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { icpProfileVersions } from "./icpProfileVersions";

export const icpProfiles = pgTable("icp_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  // Nullable: null means this profile currently has no active version
  // (freshly created, or explicitly deactivated). Circular reference to
  // icpProfileVersions — see AnyPgColumn usage, the standard drizzle-orm
  // pattern for cross-table references that would otherwise form an
  // import cycle.
  activeVersionId: uuid("active_version_id").references(
    (): AnyPgColumn => icpProfileVersions.id,
  ),
  // Whole-profile archival, independent of any version's own status. A
  // published version's content is never mutated to represent this —
  // archiving a profile does not touch icpProfileVersions at all.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text("created_by"),
});

export const insertIcpProfileSchema = createInsertSchema(icpProfiles).omit({
  id: true,
  createdAt: true,
  // activeVersionId is set only via an explicit activation operation
  // (which also records an icpProfileActivationEvents row), never at
  // profile-creation time — a brand-new profile always starts inactive.
  activeVersionId: true,
});
export type InsertIcpProfile = z.infer<typeof insertIcpProfileSchema>;
export type IcpProfile = typeof icpProfiles.$inferSelect;
