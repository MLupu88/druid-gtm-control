// Append-only audit trail of every profile activation/deactivation event.
// Kept separate from icpProfiles.activeVersionId (the current-state
// pointer) and from icpProfileVersions (immutable version content) so
// that changing which version is active never requires rewriting either
// of those tables — this table is the only place history accumulates.
//
// Event shape is unambiguous by event_type:
//   - 'activated'   -> version_id IS NOT NULL (the version being
//                      activated); previous_active_version_id may be
//                      NULL (nothing was active before) or set (what it
//                      replaces).
//   - 'deactivated' -> version_id IS NULL (nothing is being activated);
//                      previous_active_version_id IS NOT NULL (the
//                      version that was active and is now being turned
//                      off).
//
// NOTE ON ATOMICITY: this schema does not itself guarantee that a change
// to icpProfiles.activeVersionId and the corresponding row here happen
// together. That atomicity (both writes in one transaction) is the
// responsibility of the application service that performs
// activation/deactivation — it is explicitly out of scope for this
// persistence-layer slice, which only defines the tables and the
// integrity rules a single row must satisfy on its own.
//
// Cross-table integrity rules are enforced by a database trigger rather
// than expressible here (icp_profile_activation_events_integrity, see
// drizzle/0001_integrity_triggers.sql):
//   - every non-null version reference on this row (version_id and, when
//     present, previous_active_version_id) must belong to this event's
//     profile_id;
//   - the version being activated (version_id, on 'activated' events)
//     must be published;
//   - the previous active version referenced during either an
//     activation or a deactivation (previous_active_version_id, when
//     present) must also be published — only published versions can
//     ever have been active in the first place.
// A second trigger blocks UPDATE and DELETE outright — this is an
// immutable event log, like every other history table in this schema.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { activationEventType } from "./enums";
import { icpProfiles } from "./icpProfiles";
import { icpProfileVersions } from "./icpProfileVersions";

export const icpProfileActivationEvents = pgTable(
  "icp_profile_activation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => icpProfiles.id),
    eventType: activationEventType("event_type").notNull(),
    // Required and NOT NULL for 'activated' events; must be NULL for
    // 'deactivated' events (enforced below).
    versionId: uuid("version_id").references(() => icpProfileVersions.id),
    // Optional for 'activated' events (what this replaced, if anything);
    // required and NOT NULL for 'deactivated' events (what's being
    // turned off).
    previousActiveVersionId: uuid("previous_active_version_id").references(
      () => icpProfileVersions.id,
    ),
    performedBy: text("performed_by"),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reason: text("reason"),
  },
  (t) => [
    index("icp_profile_activation_events_profile_id_idx").on(
      t.profileId,
      t.performedAt,
    ),
    check(
      "icp_profile_activation_events_required_reference_by_type",
      sql`(${t.eventType} = 'activated' AND ${t.versionId} IS NOT NULL)
        OR (${t.eventType} = 'deactivated' AND ${t.versionId} IS NULL AND ${t.previousActiveVersionId} IS NOT NULL)`,
    ),
    // Guard against recording a no-op "activation" that doesn't actually
    // change anything.
    check(
      "icp_profile_activation_events_activation_is_a_real_transition",
      sql`${t.eventType} <> 'activated' OR ${t.previousActiveVersionId} IS NULL OR ${t.previousActiveVersionId} <> ${t.versionId}`,
    ),
  ],
);

export const insertIcpProfileActivationEventSchema = createInsertSchema(
  icpProfileActivationEvents,
).omit({
  id: true,
  performedAt: true,
});
export type InsertIcpProfileActivationEvent = z.infer<
  typeof insertIcpProfileActivationEventSchema
>;
export type IcpProfileActivationEvent =
  typeof icpProfileActivationEvents.$inferSelect;
