// Foundation Slice 1 for the account-level ICP evaluation flow: derives a
// truthful (sparse) NormalizedAccountInputV1 from the canonical account
// row, persists it as a new immutable account_snapshots row, and resolves
// the canonical evaluator version and the ICP profile version an
// evaluation should run against.
//
// Only imports from @workspace/db/schema, never @workspace/db itself —
// the database instance is always received via explicit injection,
// mirroring ./accountDecisions.ts and ./icpProfiles.ts.
//
// SAFETY BOUNDARY: the account row (id, accountKey, companyDomain,
// companyName only) cannot truthfully populate most of
// NormalizedAccountInputV1 — engagement, contact, CRM, and consent facts
// are all genuinely unknown, not verified negatives. Whether an
// evaluationMode is even appropriate for a snapshot built this way is
// deliberately NOT decided here: these resolvers are generic and
// mode-agnostic by design. The account-level evaluation orchestration
// endpoint that will be built on top of this module is responsible for
// restricting snapshots produced by createCurrentAccountSnapshot to
// preview evaluations only — nothing in this file should be read as
// asserting that a sparse snapshot is safe to use for a production
// decision.

import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  accounts,
  accountSnapshots,
  evaluatorVersions,
  icpProfiles,
  icpProfileVersions,
  type Account,
  type AccountSnapshot,
  type EvaluatorVersion,
  type IcpProfileVersion,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  SUPPORTED_EVALUATOR_VERSIONS,
  type NormalizedAccountInputV1,
} from "@workspace/evaluator";
import { ProfileNotFoundError } from "./icpProfiles.js";

type Db = NodePgDatabase<typeof schema>;

export const CURRENT_STATE_SNAPSHOT_SOURCE = "gtm-account-current-state-v1";

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class AccountNotFoundError extends Error {
  constructor(public readonly accountId: string) {
    super(`account with id "${accountId}" was not found.`);
    this.name = "AccountNotFoundError";
  }
}

export class NoActiveProfileVersionError extends Error {
  constructor(public readonly profileId: string) {
    super(
      `icpProfile "${profileId}" has no active version; a production evaluation requires an active, published profile version.`,
    );
    this.name = "NoActiveProfileVersionError";
  }
}

export class NoResolvablePreviewVersionError extends Error {
  constructor(public readonly profileId: string) {
    super(
      `icpProfile "${profileId}" has neither a draft version nor an active version available for a preview evaluation.`,
    );
    this.name = "NoResolvablePreviewVersionError";
  }
}

// ---------------------------------------------------------------------
// 1. Derive a truthful, sparse NormalizedAccountInputV1 from the account
// row alone. Only companyName/companyDomain are real facts; every other
// field is set to the most truthful "unknown" representation the schema
// permits (see the field-by-field comments below).
// ---------------------------------------------------------------------

export function buildNormalizedAccountInputFromAccount(
  account: Account,
): NormalizedAccountInputV1 {
  return {
    schemaVersion: "v1",
    company: {
      domain: account.companyDomain ?? null,
      name: account.companyName ?? null,
      industry: null,
      employeeRange: null,
      revenueRange: null,
      region: "unknown",
      country: null,
    },
    engagement: {
      sources: [],
      pagesVisited: [],
      distinctSourceCount: 0,
      repeatVisit: false,
      lastSeenAt: null,
    },
    // No engagement source exists to surface contact evidence from.
    contact: null,
    crm: {
      hubspotCompanyId: null,
      hubspotContactId: null,
      hubspotOwner: null,
      openOpportunity: false,
      existingCustomer: false,
      competitorFlag: false,
      partnerFlag: false,
    },
    // NormalizedAccountInputV1 has no tri-state/"unknown" representation
    // for doNotContact (unlike consent below) — it is a plain boolean.
    // This sparse adapter has no verified contact-preference data at all,
    // so it conservatively defaults to true (treat as do-not-contact)
    // rather than false, which would falsely assert confirmed permission.
    doNotContact: true,
    consent: {
      email: "unknown",
      call: "unknown",
      liBasisCleared: "unknown",
      dpoVoiceCleared: "unknown",
    },
    source: CURRENT_STATE_SNAPSHOT_SOURCE,
  };
}

// ---------------------------------------------------------------------
// 2. Persist a new, immutable snapshot of the account's current state.
// No deduplication/reuse in this slice — every call inserts a new row.
// ---------------------------------------------------------------------

export async function createCurrentAccountSnapshot(
  db: Db,
  accountId: string,
): Promise<AccountSnapshot> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!account) {
    throw new AccountNotFoundError(accountId);
  }

  const normalizedInput = buildNormalizedAccountInputFromAccount(account);

  const [snapshot] = await db
    .insert(accountSnapshots)
    .values({
      accountId,
      source: CURRENT_STATE_SNAPSHOT_SOURCE,
      rawInput: {
        companyDomain: account.companyDomain,
        companyName: account.companyName,
      },
      normalizedInput,
      schemaVersion: "v1",
      // capturedAt intentionally omitted -> database default (now()).
    })
    .returning();
  if (!snapshot) {
    throw new Error(
      `createCurrentAccountSnapshot: insert returned no row for account "${accountId}"`,
    );
  }

  return snapshot;
}

// ---------------------------------------------------------------------
// 3. Race-safe get-or-create for the canonical evaluator_versions row —
// exact mirror of ./accountDecisions.ts's
// resolveManualDecisionPolicyVersion, keyed off evaluatorVersions'
// existing unique constraint on `version` rather than a transaction.
// ---------------------------------------------------------------------

export async function resolveCanonicalEvaluatorVersion(
  db: Db,
): Promise<EvaluatorVersion> {
  const version = SUPPORTED_EVALUATOR_VERSIONS[0];

  const [inserted] = await db
    .insert(evaluatorVersions)
    .values({ version })
    .onConflictDoNothing({ target: evaluatorVersions.version })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db
    .select()
    .from(evaluatorVersions)
    .where(eq(evaluatorVersions.version, version))
    .limit(1);
  if (!existing) {
    throw new Error(
      `resolveCanonicalEvaluatorVersion: insert conflicted on version "${version}" but no existing row was found`,
    );
  }
  return existing;
}

// ---------------------------------------------------------------------
// 4. Resolve which icp_profile_versions row an evaluation should run
// against, given a profile and the requested evaluationMode.
// ---------------------------------------------------------------------

async function loadProfileVersionForProfile(
  db: Db,
  profileId: string,
  versionId: string,
): Promise<IcpProfileVersion | undefined> {
  const [version] = await db
    .select()
    .from(icpProfileVersions)
    .where(
      and(
        eq(icpProfileVersions.id, versionId),
        eq(icpProfileVersions.profileId, profileId),
      ),
    )
    .limit(1);
  return version;
}

async function loadActiveVersionOrThrowIntegrityError(
  db: Db,
  profileId: string,
  activeVersionId: string,
): Promise<IcpProfileVersion> {
  const version = await loadProfileVersionForProfile(
    db,
    profileId,
    activeVersionId,
  );
  if (!version) {
    throw new Error(
      `resolveProfileVersionForEvaluation: profile "${profileId}" has activeVersionId "${activeVersionId}" but no matching icp_profile_versions row was found (data integrity failure).`,
    );
  }
  return version;
}

export async function resolveProfileVersionForEvaluation(
  db: Db,
  profileId: string,
  evaluationMode: "preview" | "production",
): Promise<IcpProfileVersion> {
  const [profile] = await db
    .select()
    .from(icpProfiles)
    .where(eq(icpProfiles.id, profileId))
    .limit(1);
  if (!profile) {
    throw new ProfileNotFoundError(profileId);
  }

  if (evaluationMode === "production") {
    if (!profile.activeVersionId) {
      throw new NoActiveProfileVersionError(profileId);
    }
    return loadActiveVersionOrThrowIntegrityError(
      db,
      profileId,
      profile.activeVersionId,
    );
  }

  // preview: prefer the draft, then fall back to the active version.
  const [draft] = await db
    .select()
    .from(icpProfileVersions)
    .where(
      and(
        eq(icpProfileVersions.profileId, profileId),
        eq(icpProfileVersions.status, "draft"),
      ),
    )
    .limit(1);
  if (draft) return draft;

  if (profile.activeVersionId) {
    return loadActiveVersionOrThrowIntegrityError(
      db,
      profileId,
      profile.activeVersionId,
    );
  }

  throw new NoResolvablePreviewVersionError(profileId);
}
