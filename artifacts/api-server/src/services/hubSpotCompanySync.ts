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
  type HubSpotCompany,
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
  bootstrapCompanyIdentityFn?: BootstrapHubSpotCompanyIdentityFn;
  recordObservationFn?: RecordObservationFn;
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
  const bootstrapCompanyIdentityFn =
    args.bootstrapCompanyIdentityFn ?? bootstrapHubSpotCompanyIdentity;
  const recordObservationFn: RecordObservationFn =
    args.recordObservationFn ??
    ((observation) => recordObservation({ db: args.db, observation }));

  const company = await fetchCompanyFn(args.companyId);
  const importedAt = new Date().toISOString();

  const observationCandidates = mapHubSpotCompanyToObservations({
    company,
    importedAt,
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
