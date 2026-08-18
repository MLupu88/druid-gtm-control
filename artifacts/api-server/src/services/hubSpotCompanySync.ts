// Controlled, company-only HubSpot synchronization. The HubSpot client is
// read-only; all canonical account/alias persistence is delegated to the
// existing provider-neutral identity bootstrap.

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  fetchHubSpotCompanyById,
  type HubSpotCompany,
} from "../lib/hubSpotClient.js";
import {
  bootstrapHubSpotCompanyIdentity,
  type BootstrapHubSpotCompanyIdentityResult,
} from "./hubSpotCompanyIdentity.js";

type Db = NodePgDatabase<typeof schema>;

export type FetchHubSpotCompanyFn = (companyId: string) => Promise<HubSpotCompany>;
export type BootstrapHubSpotCompanyIdentityFn = (
  args: Parameters<typeof bootstrapHubSpotCompanyIdentity>[0],
) => Promise<BootstrapHubSpotCompanyIdentityResult>;

export interface SyncHubSpotCompanyArgs {
  db: Db;
  companyId: string;
  fetchCompanyFn?: FetchHubSpotCompanyFn;
  bootstrapCompanyIdentityFn?: BootstrapHubSpotCompanyIdentityFn;
}

export async function syncHubSpotCompany(
  args: SyncHubSpotCompanyArgs,
): Promise<BootstrapHubSpotCompanyIdentityResult> {
  const fetchCompanyFn = args.fetchCompanyFn ?? fetchHubSpotCompanyById;
  const bootstrapCompanyIdentityFn =
    args.bootstrapCompanyIdentityFn ?? bootstrapHubSpotCompanyIdentity;
  const company = await fetchCompanyFn(args.companyId);

  return bootstrapCompanyIdentityFn({
    db: args.db,
    hubspotCompanyId: company.id,
    companyDomain: company.domain,
    companyName: company.name,
  });
}
