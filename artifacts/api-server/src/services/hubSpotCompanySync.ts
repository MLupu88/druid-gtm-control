// Controlled, company-only HubSpot synchronization. The HubSpot client is
// read-only; canonical account/alias persistence is delegated to the
// existing provider-neutral identity bootstrap, and (Milestone 3E.3)
// observation persistence is delegated to recordObservation() via
// ./hubSpotObservationMapping.ts's pure mapping.
//
// Identity bootstrap and observation recording are deliberately
// independent, not sequenced/gated on one another: observations are
// pre-resolution provider evidence (Milestone 3D) and must persist
// regardless of whether canonical identity resolution succeeds, matches,
// or conflicts — the same corrected principle Milestone 3E.2 established
// for RB2B. A company whose domain/external id conflicts with an
// existing account still gets its firmographic/crm_state observations
// recorded; canonical binding is Milestone 3F's job, not this function's.
//
// importedAt is assigned exactly once per syncHubSpotCompany() call and
// reused unchanged across every observation this call records — never
// regenerated per observation, never reconstructed from observations
// table history (see ./hubSpotObservationMapping.ts and
// ./observations.ts's own importedAt invariant comments).

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import type { ProviderObservationV1 } from "@workspace/observation";
import {
  fetchHubSpotCompanyById,
  fetchHubSpotOwnerById,
  type HubSpotCompany,
  type HubSpotOwner,
} from "../lib/hubSpotClient.js";
import {
  bootstrapHubSpotCompanyIdentity,
  type BootstrapHubSpotCompanyIdentityResult,
} from "./hubSpotCompanyIdentity.js";
import { mapHubSpotCompanyToObservations } from "./hubSpotObservationMapping.js";
import {
  recordObservation,
  type RecordObservationResult,
} from "./observations.js";

type Db = NodePgDatabase<typeof schema>;

export type FetchHubSpotCompanyFn = (companyId: string) => Promise<HubSpotCompany>;
export type FetchHubSpotOwnerFn = (ownerId: string) => Promise<HubSpotOwner | null>;
export type BootstrapHubSpotCompanyIdentityFn = (
  args: Parameters<typeof bootstrapHubSpotCompanyIdentity>[0],
) => Promise<BootstrapHubSpotCompanyIdentityResult>;
export type RecordObservationFn = (
  observation: ProviderObservationV1,
) => Promise<RecordObservationResult>;

export interface SyncHubSpotCompanyArgs {
  db: Db;
  companyId: string;
  fetchCompanyFn?: FetchHubSpotCompanyFn;
  fetchOwnerFn?: FetchHubSpotOwnerFn;
  bootstrapCompanyIdentityFn?: BootstrapHubSpotCompanyIdentityFn;
  recordObservationFn?: RecordObservationFn;
}

function ownerDisplayNameFrom(owner: HubSpotOwner): string | null {
  const name = [owner.firstName, owner.lastName].filter((part) => part !== null).join(" ").trim();
  return name !== "" ? name : owner.email;
}

// Additive: every existing field (outcome/accountId/source/
// attachedAliasTypes/code/candidateMatches, depending on branch) is
// unchanged from BootstrapHubSpotCompanyIdentityResult — callers that
// only ever read those keep working unmodified. `observations` is the
// only new field.
export type SyncHubSpotCompanyResult = BootstrapHubSpotCompanyIdentityResult & {
  observations: RecordObservationResult[];
};

export async function syncHubSpotCompany(
  args: SyncHubSpotCompanyArgs,
): Promise<SyncHubSpotCompanyResult> {
  const fetchCompanyFn = args.fetchCompanyFn ?? fetchHubSpotCompanyById;
  const fetchOwnerFn = args.fetchOwnerFn ?? fetchHubSpotOwnerById;
  const bootstrapCompanyIdentityFn =
    args.bootstrapCompanyIdentityFn ?? bootstrapHubSpotCompanyIdentity;
  const recordObservationFn: RecordObservationFn =
    args.recordObservationFn ??
    ((observation) => recordObservation({ db: args.db, observation }));

  const company = await fetchCompanyFn(args.companyId);
  const importedAt = new Date().toISOString();

  // M3.5 real-data defect fix: resolve the owner's human display name
  // during ingestion, once, rather than on every GET /truth read (see
  // ../lib/hubSpotClient.ts's own comment on why this lives here). A
  // failure to resolve it (HubSpot error, unexpected shape) must never
  // fail the whole company sync — the owner id itself was already read
  // successfully as part of the company fetch above; this is best-effort
  // enrichment only, degrading to no display name.
  let ownerDisplayName: string | null = null;
  if (company.hubspotOwnerId !== null) {
    try {
      const owner = await fetchOwnerFn(company.hubspotOwnerId);
      ownerDisplayName = owner ? ownerDisplayNameFrom(owner) : null;
    } catch {
      ownerDisplayName = null;
    }
  }

  const observationCandidates = mapHubSpotCompanyToObservations({
    company,
    importedAt,
    ownerDisplayName,
  });
  const observations: RecordObservationResult[] = [];
  for (const candidate of observationCandidates) {
    observations.push(await recordObservationFn(candidate));
  }

  const identityResult = await bootstrapCompanyIdentityFn({
    db: args.db,
    hubspotCompanyId: company.id,
    companyDomain: company.domain,
    companyName: company.name,
  });

  return { ...identityResult, observations };
}
