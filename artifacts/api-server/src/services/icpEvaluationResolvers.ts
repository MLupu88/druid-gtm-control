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
  accountFacts,
  accountFactCurrent,
  accountSnapshots,
  evaluatorVersions,
  icpProfiles,
  icpProfileVersions,
  type Account,
  type AccountFact,
  type AccountFactField,
  type AccountSnapshot,
  type EvaluatorVersion,
  type IcpProfileVersion,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  SUPPORTED_EVALUATOR_VERSIONS,
  type NormalizedAccountInputV1,
  type RegionV1,
} from "@workspace/evaluator";
import { ProfileNotFoundError } from "./icpProfiles.js";
import { buildAccountFactsSnapshotEvidence } from "./accountFactsSnapshotEvidence.js";
import { ManualRegionValueSchema } from "./accountFactValueValidation.js";

type Db = NodePgDatabase<typeof schema>;

// v1 source constant, kept only for two reasons: (1) historical
// interpretability of any snapshot already persisted with this source
// before this slice shipped, and (2) its evidence resolver in
// ../services/mqlDecisionReadiness.ts remains registered and unchanged.
// createCurrentAccountSnapshot below no longer creates snapshots with
// this source — see CURRENT_STATE_V2_SNAPSHOT_SOURCE.
export const CURRENT_STATE_SNAPSHOT_SOURCE = "gtm-account-current-state-v1";

// The source every NEW preview/official snapshot is created with,
// unconditionally — no separate "evaluate with facts" action exists.
// Adds real evidence for the five Slice 1 company fields (via
// account_facts/account_fact_current) on top of everything
// gtm-account-current-state-v1 already truthfully provided; still
// genuinely sparse for engagement/contact/crm/consent, exactly as v1
// was — Slice 1 introduces no evidence source for those.
export const CURRENT_STATE_V2_SNAPSHOT_SOURCE = "gtm-account-current-state-v2";

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
// 1b. v2: derive NormalizedAccountInputV1's company.* fields from real,
// currently-accepted manual facts (see ../services/accountFacts.ts),
// falling back to the exact same truthful "unknown" representation as v1
// for any Slice 1 field with no current fact. NormalizedAccountInputV1's
// SHAPE is unchanged from v1 — only which values it truthfully carries
// differs. engagement/contact/crm/consent remain exactly as sparse as
// v1: Slice 1 introduces no evidence source for those.
// ---------------------------------------------------------------------

export function buildNormalizedAccountInputFromAccountAndFacts(
  account: Account,
  currentFactsByField: ReadonlyMap<AccountFactField, AccountFact>,
): NormalizedAccountInputV1 {
  const base = buildNormalizedAccountInputFromAccount(account);

  const regionFact = currentFactsByField.get("company.region");
  // ManualRegionValueSchema.parse (not the DB CHECK alone) is the
  // defense-in-depth boundary here: a stored company.region value that
  // somehow failed to satisfy the closed 'us'|'emea'|'other' set would
  // be a genuine data-integrity bug, and this throws loudly rather than
  // silently coercing it into the evaluator's typed RegionV1 shape.
  const region: RegionV1 = regionFact
    ? ManualRegionValueSchema.parse(regionFact.value)
    : "unknown";

  return {
    ...base,
    company: {
      ...base.company,
      industry: currentFactsByField.get("company.industry")?.value ?? null,
      employeeRange:
        currentFactsByField.get("company.employeeRange")?.value ?? null,
      revenueRange:
        currentFactsByField.get("company.revenueRange")?.value ?? null,
      region,
      country: currentFactsByField.get("company.country")?.value ?? null,
    },
    source: CURRENT_STATE_V2_SNAPSHOT_SOURCE,
  };
}

// ---------------------------------------------------------------------
// 1c. Load the account_fact_current-winning account_facts row per
// Slice 1 field for one account (at most five rows) — the single query
// both the v2 normalizedInput builder and the v2 evidence-envelope
// builder (buildAccountFactsSnapshotEvidence) consume.
// ---------------------------------------------------------------------

async function resolveCurrentAccountFacts(
  db: Db,
  accountId: string,
): Promise<Map<AccountFactField, AccountFact>> {
  const rows = await db
    .select({ fact: accountFacts })
    .from(accountFactCurrent)
    .innerJoin(accountFacts, eq(accountFactCurrent.factId, accountFacts.id))
    .where(eq(accountFactCurrent.accountId, accountId));

  const byField = new Map<AccountFactField, AccountFact>();
  for (const row of rows) {
    byField.set(row.fact.field as AccountFactField, row.fact);
  }
  return byField;
}

// ---------------------------------------------------------------------
// 2. Persist a new, immutable snapshot of the account's current state.
// No deduplication/reuse in this slice — every call inserts a new row.
// Unconditionally uses CURRENT_STATE_V2_SNAPSHOT_SOURCE: every new
// preview/official evaluation automatically gets real company-fact
// evidence when it exists, with no separate "evaluate with facts" user
// action.
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

  const currentFactsByField = await resolveCurrentAccountFacts(db, accountId);
  const currentFacts = Array.from(currentFactsByField.values());

  const normalizedInput = buildNormalizedAccountInputFromAccountAndFacts(
    account,
    currentFactsByField,
  );
  const rawInput = buildAccountFactsSnapshotEvidence(account, currentFacts);

  const [snapshot] = await db
    .insert(accountSnapshots)
    .values({
      accountId,
      source: CURRENT_STATE_V2_SNAPSHOT_SOURCE,
      rawInput,
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
