// Application service for controlled ICP profile management. Deliberately
// contains no HTTP-specific logic (no req/res, no status codes, no
// header/body parsing) — see ../routes/icpProfiles.ts for the HTTP boundary
// that wraps this.
//
// Only imports from @workspace/db/schema (table/type definitions), never
// from @workspace/db itself (the singleton `db`/`pool`, which throws at
// import time if DATABASE_URL is unset) — the database instance is always
// received via explicit injection, mirroring the convention already
// established by @workspace/evaluator-persistence's evaluateAndPersist()
// and ./accountEvaluations.ts.
//
// Every lifecycle rule enforced here (draft immutable-once-published, one
// draft per profile, active_version_id must point at a published version
// belonging to the same profile, activation events reference the correct
// profile/version) is ALSO enforced by a database trigger or constraint
// (see lib/db/drizzle/0001_integrity_triggers.sql) — the checks in this
// file are there to produce clean, typed, machine-readable errors before
// hitting the database, not to replace those triggers as the source of
// truth.
//
// Never creates account_evaluations, account_decisions, routing output,
// actions, or outbox records — this slice is profile lifecycle management
// only.

import { and, asc, desc, eq, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  icpProfiles,
  icpProfileVersions,
  icpProfileActivationEvents,
  type IcpProfile,
  type IcpProfileVersion,
  type IcpProfileActivationEvent,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  IcpProfileConfigV1Schema,
  evaluatePublicationReadiness,
  classifyProfileConfig,
  targetCriteria as extractTargetCriteria,
  type IcpProfileConfigV1,
  type NotReadyForPublishReason,
  type ProfileClassification,
  type TargetCriterion,
} from "@workspace/evaluator";

type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------
// Errors. One class per distinct lifecycle failure so the HTTP layer can
// map each to the exact status code the API contract requires without
// string-matching messages.
// ---------------------------------------------------------------------

export class ProfileNotFoundError extends Error {
  constructor(public readonly profileId: string) {
    super(`icpProfile with id "${profileId}" does not exist.`);
    this.name = "ProfileNotFoundError";
  }
}

export class VersionNotFoundError extends Error {
  constructor(public readonly versionId: string) {
    super(`icpProfileVersion with id "${versionId}" does not exist.`);
    this.name = "VersionNotFoundError";
  }
}

export class VersionBelongsToAnotherProfileError extends Error {
  constructor(
    public readonly versionId: string,
    public readonly profileId: string,
  ) {
    super(
      `icpProfileVersion "${versionId}" does not belong to profile "${profileId}".`,
    );
    this.name = "VersionBelongsToAnotherProfileError";
  }
}

export class DraftAlreadyExistsError extends Error {
  constructor(public readonly profileId: string) {
    super(`Profile "${profileId}" already has a draft version.`);
    this.name = "DraftAlreadyExistsError";
  }
}

export class NoDraftVersionError extends Error {
  constructor(public readonly profileId: string) {
    super(`Profile "${profileId}" has no draft version.`);
    this.name = "NoDraftVersionError";
  }
}

export class VersionNotPublishedError extends Error {
  constructor(public readonly versionId: string) {
    super(
      `icpProfileVersion "${versionId}" is not published and cannot be activated.`,
    );
    this.name = "VersionNotPublishedError";
  }
}

export class InvalidProfileConfigError extends Error {
  constructor(message: string) {
    super(`Invalid ICP profile config: ${message}`);
    this.name = "InvalidProfileConfigError";
  }
}

// Raised by publishDraft() when the draft is schema-valid but not yet
// ready to publish per business rules — distinct from
// InvalidProfileConfigError (schema validity, checked earlier by
// validateProfileConfig). The classification itself
// (evaluatePublicationReadiness/NotReadyForPublishReason) lives in
// @workspace/evaluator, not here, so the API server and the frontend's
// own pre-publish readiness display can never disagree about what
// "ready to publish" means.
export class NotReadyForPublishError extends Error {
  constructor(public readonly reasons: NotReadyForPublishReason[]) {
    super("This draft is not ready to publish.");
    this.name = "NotReadyForPublishError";
  }
}

/** Throws InvalidProfileConfigError; otherwise returns the validated, canonical config. */
export function validateProfileConfig(config: unknown): IcpProfileConfigV1 {
  const parsed = IcpProfileConfigV1Schema.safeParse(config);
  if (!parsed.success) {
    throw new InvalidProfileConfigError(parsed.error.message);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------
// Read-model shapes
// ---------------------------------------------------------------------

/** Lightweight per-version metadata for list views — deliberately excludes `config`. */
export interface ProfileVersionSummary {
  id: string;
  versionNumber: number;
  status: IcpProfileVersion["status"];
  createdAt: Date;
  createdBy: string | null;
  publishedAt: Date | null;
  notes: string | null;
}

export interface ProfileListItem {
  id: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  activeVersion: ProfileVersionSummary | null;
  draftVersion: ProfileVersionSummary | null;
  latestVersion: ProfileVersionSummary | null;
  /** Derived from the active version's config — see @workspace/evaluator's classifyProfileConfig. "no_active_definition" whenever activeVersion is null. Never a stored column. */
  classification: ProfileClassification;
  /** Structured target-company criteria extracted from the active version's simple, directly supported fit rules — see @workspace/evaluator's targetCriteria. Never points, rule ids, thresholds, or compound-rule internals. Empty when there's no active version or no simple meaningful criteria configured yet. */
  targetCriteria: TargetCriterion[];
}

export interface ProfileDetail {
  profile: IcpProfile;
  /** Ordered by versionNumber ascending. Config is the exact stored value — never mutated/normalized. */
  versions: IcpProfileVersion[];
}

export interface ActivateVersionResult {
  profile: IcpProfile;
  /** Null exactly when re-activating the already-active version (deterministic no-op — no duplicate event is created). */
  event: IcpProfileActivationEvent | null;
  alreadyActive: boolean;
}

function toVersionSummary(version: IcpProfileVersion): ProfileVersionSummary {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    publishedAt: version.publishedAt,
    notes: version.notes,
  };
}

/** Pure derivation of a list-view row from a profile and its versions — no DB access, unit-testable directly. */
export function buildProfileListItem(
  profile: IcpProfile,
  versions: IcpProfileVersion[],
): ProfileListItem {
  const active = profile.activeVersionId
    ? (versions.find((v) => v.id === profile.activeVersionId) ?? null)
    : null;
  const draft = versions.find((v) => v.status === "draft") ?? null;
  const latest = versions.reduce<IcpProfileVersion | null>(
    (best, v) => (!best || v.versionNumber > best.versionNumber ? v : best),
    null,
  );

  // Every version's config was already schema-validated when it was
  // written (createProfile/updateDraft both call validateProfileConfig,
  // and a published version is immutable thereafter) — re-validated here
  // rather than cast, since a silent default would risk misclassifying
  // corrupted or unexpected stored data instead of surfacing the problem.
  const activeConfig: IcpProfileConfigV1 | null = active
    ? validateProfileConfig(active.config)
    : null;

  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    archivedAt: profile.archivedAt,
    createdAt: profile.createdAt,
    createdBy: profile.createdBy,
    activeVersion: active ? toVersionSummary(active) : null,
    draftVersion: draft ? toVersionSummary(draft) : null,
    latestVersion: latest ? toVersionSummary(latest) : null,
    classification: classifyProfileConfig(activeConfig),
    targetCriteria: extractTargetCriteria(activeConfig),
  };
}

// ---------------------------------------------------------------------
// 1. Create profile — atomically creates the profile row and its initial
// (versionNumber 1) draft version. Config is validated before any write.
// ---------------------------------------------------------------------

export interface CreateProfileArgs {
  db: Db;
  name: string;
  description?: string | null;
  config: unknown;
  createdBy: string | null;
}

export async function createProfile(
  args: CreateProfileArgs,
): Promise<{ profile: IcpProfile; draftVersion: IcpProfileVersion }> {
  const { db, name, description = null, createdBy } = args;
  const validatedConfig = validateProfileConfig(args.config);

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .insert(icpProfiles)
      .values({ name, description, createdBy })
      .returning();
    if (!profile) throw new Error("createProfile: insert returned no row");

    const [draftVersion] = await tx
      .insert(icpProfileVersions)
      .values({
        profileId: profile.id,
        versionNumber: 1,
        config: validatedConfig,
        createdBy,
      })
      .returning();
    if (!draftVersion)
      throw new Error("createProfile: draft version insert returned no row");

    return { profile, draftVersion };
  });
}

// ---------------------------------------------------------------------
// 2. List profiles
// ---------------------------------------------------------------------

export async function listProfiles(db: Db): Promise<ProfileListItem[]> {
  const profiles = await db
    .select()
    .from(icpProfiles)
    .orderBy(desc(icpProfiles.createdAt));
  if (profiles.length === 0) return [];

  const versions = await db
    .select()
    .from(icpProfileVersions)
    .orderBy(asc(icpProfileVersions.versionNumber));

  const versionsByProfile = new Map<string, IcpProfileVersion[]>();
  for (const version of versions) {
    const list = versionsByProfile.get(version.profileId);
    if (list) list.push(version);
    else versionsByProfile.set(version.profileId, [version]);
  }

  return profiles.map((profile) =>
    buildProfileListItem(profile, versionsByProfile.get(profile.id) ?? []),
  );
}

// ---------------------------------------------------------------------
// 3. Retrieve profile
// ---------------------------------------------------------------------

export async function getProfile(
  db: Db,
  profileId: string,
): Promise<ProfileDetail | undefined> {
  const [profile] = await db
    .select()
    .from(icpProfiles)
    .where(eq(icpProfiles.id, profileId))
    .limit(1);
  if (!profile) return undefined;

  const versions = await db
    .select()
    .from(icpProfileVersions)
    .where(eq(icpProfileVersions.profileId, profileId))
    .orderBy(asc(icpProfileVersions.versionNumber));

  return { profile, versions };
}

// ---------------------------------------------------------------------
// 4. Update draft — only the current draft may be edited; full
// replacement semantics for config. notes: omitted leaves the stored
// value untouched, present (including null) replaces it.
// ---------------------------------------------------------------------

export interface UpdateDraftArgs {
  db: Db;
  profileId: string;
  config: unknown;
  /** undefined = leave unchanged; null/string = replace. */
  notes?: string | null;
}

export async function updateDraft(
  args: UpdateDraftArgs,
): Promise<IcpProfileVersion> {
  const { db, profileId, notes } = args;
  const validatedConfig = validateProfileConfig(args.config);

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(icpProfiles)
      .where(eq(icpProfiles.id, profileId))
      .limit(1);
    if (!profile) throw new ProfileNotFoundError(profileId);

    const [draft] = await tx
      .select()
      .from(icpProfileVersions)
      .where(
        and(
          eq(icpProfileVersions.profileId, profileId),
          eq(icpProfileVersions.status, "draft"),
        ),
      )
      .limit(1);
    if (!draft) throw new NoDraftVersionError(profileId);

    const [updated] = await tx
      .update(icpProfileVersions)
      .set({
        config: validatedConfig,
        ...(notes !== undefined ? { notes } : {}),
      })
      .where(
        and(
          eq(icpProfileVersions.id, draft.id),
          eq(icpProfileVersions.status, "draft"),
        ),
      )
      .returning();
    // Only possible if the draft was published concurrently between the
    // select above and this update — the immutability trigger would also
    // reject a plain UPDATE with no status filter, but filtering on
    // status here turns that race into a clean 0-row result instead of a
    // thrown database exception.
    if (!updated) throw new NoDraftVersionError(profileId);

    return updated;
  });
}

// ---------------------------------------------------------------------
// 5. Clone version into draft
// ---------------------------------------------------------------------

export interface CloneVersionArgs {
  db: Db;
  profileId: string;
  sourceVersionId: string;
  createdBy: string | null;
}

export async function cloneVersionIntoDraft(
  args: CloneVersionArgs,
): Promise<IcpProfileVersion> {
  const { db, profileId, sourceVersionId, createdBy } = args;

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(icpProfiles)
      .where(eq(icpProfiles.id, profileId))
      .limit(1);
    if (!profile) throw new ProfileNotFoundError(profileId);

    const [existingDraft] = await tx
      .select()
      .from(icpProfileVersions)
      .where(
        and(
          eq(icpProfileVersions.profileId, profileId),
          eq(icpProfileVersions.status, "draft"),
        ),
      )
      .limit(1);
    if (existingDraft) throw new DraftAlreadyExistsError(profileId);

    const [source] = await tx
      .select()
      .from(icpProfileVersions)
      .where(eq(icpProfileVersions.id, sourceVersionId))
      .limit(1);
    if (!source) throw new VersionNotFoundError(sourceVersionId);
    if (source.profileId !== profileId) {
      throw new VersionBelongsToAnotherProfileError(sourceVersionId, profileId);
    }

    const [{ value: maxVersionNumber } = { value: null }] = await tx
      .select({ value: max(icpProfileVersions.versionNumber) })
      .from(icpProfileVersions)
      .where(eq(icpProfileVersions.profileId, profileId));

    const [cloned] = await tx
      .insert(icpProfileVersions)
      .values({
        profileId,
        versionNumber: (maxVersionNumber ?? 0) + 1,
        // Exact clone — the source's stored config value, untouched and
        // unrevalidated (it was already validated when it was written).
        config: source.config,
        createdBy,
      })
      .returning();
    if (!cloned)
      throw new Error("cloneVersionIntoDraft: insert returned no row");

    return cloned;
  });
}

// ---------------------------------------------------------------------
// 6. Publish draft — operates on the profile's current draft (there is
// at most one). Does not touch activeVersionId.
// ---------------------------------------------------------------------

export async function publishDraft(
  db: Db,
  profileId: string,
): Promise<IcpProfileVersion> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(icpProfiles)
      .where(eq(icpProfiles.id, profileId))
      .limit(1);
    if (!profile) throw new ProfileNotFoundError(profileId);

    const [draft] = await tx
      .select()
      .from(icpProfileVersions)
      .where(
        and(
          eq(icpProfileVersions.profileId, profileId),
          eq(icpProfileVersions.status, "draft"),
        ),
      )
      .limit(1);
    if (!draft) throw new NoDraftVersionError(profileId);

    // Schema-validity was already enforced when this draft's config was
    // last written (createProfile/updateDraft both call
    // validateProfileConfig), so this re-parse should always succeed —
    // re-running it here (rather than trusting the stored jsonb blindly)
    // is what lets evaluatePublicationReadiness receive a real, typed
    // IcpProfileConfigV1 instead of `unknown`. No database migration and
    // no evaluator-semantic change: this only decides whether publishing
    // is ALLOWED, never what the config contains or how it's evaluated.
    const validatedConfig = validateProfileConfig(draft.config);
    const reasons = evaluatePublicationReadiness(validatedConfig);
    if (reasons.length > 0) {
      throw new NotReadyForPublishError(reasons);
    }

    const [published] = await tx
      .update(icpProfileVersions)
      .set({ status: "published", publishedAt: new Date() })
      .where(
        and(
          eq(icpProfileVersions.id, draft.id),
          eq(icpProfileVersions.status, "draft"),
        ),
      )
      .returning();
    if (!published) throw new NoDraftVersionError(profileId);

    return published;
  });
}

// ---------------------------------------------------------------------
// 7. Activate published version
// ---------------------------------------------------------------------

export interface ActivateVersionArgs {
  db: Db;
  profileId: string;
  versionId: string;
  performedBy: string | null;
}

export async function activateVersion(
  args: ActivateVersionArgs,
): Promise<ActivateVersionResult> {
  const { db, profileId, versionId, performedBy } = args;

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select()
      .from(icpProfiles)
      .where(eq(icpProfiles.id, profileId))
      .limit(1);
    if (!profile) throw new ProfileNotFoundError(profileId);

    const [version] = await tx
      .select()
      .from(icpProfileVersions)
      .where(eq(icpProfileVersions.id, versionId))
      .limit(1);
    if (!version) throw new VersionNotFoundError(versionId);
    if (version.profileId !== profileId) {
      throw new VersionBelongsToAnotherProfileError(versionId, profileId);
    }
    if (version.status !== "published") {
      throw new VersionNotPublishedError(versionId);
    }

    if (profile.activeVersionId === versionId) {
      // Deterministic no-op: re-activating the already-active version
      // creates no duplicate activation event (and the database's own
      // check constraint would reject one anyway).
      return { profile, event: null, alreadyActive: true };
    }

    const previousActiveVersionId = profile.activeVersionId;

    const [updatedProfile] = await tx
      .update(icpProfiles)
      .set({ activeVersionId: versionId })
      .where(eq(icpProfiles.id, profileId))
      .returning();
    if (!updatedProfile)
      throw new Error("activateVersion: profile update returned no row");

    const [event] = await tx
      .insert(icpProfileActivationEvents)
      .values({
        profileId,
        eventType: "activated",
        versionId,
        previousActiveVersionId,
        performedBy,
      })
      .returning();
    if (!event)
      throw new Error(
        "activateVersion: activation event insert returned no row",
      );

    return { profile: updatedProfile, event, alreadyActive: false };
  });
}
