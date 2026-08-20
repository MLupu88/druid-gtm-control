// Manual, authenticated operator trigger for one controlled HubSpot company.
// This router assumes routes/index.ts mounts it behind requireAuth. It performs
// no provider or database work directly; both are owned by the sync service.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  HubSpotApiError,
  HubSpotCompanyArchivedError,
  HubSpotCompanyDomainUnavailableError,
  HubSpotNotConfiguredError,
  HubSpotResponseError,
} from "../lib/hubSpotClient.js";
import {
  InvalidHubSpotCompanyDomainError,
  InvalidHubSpotCompanyIdError,
  InvalidHubSpotCompanyNameError,
} from "../services/hubSpotCompanyIdentity.js";
import { syncHubSpotCompany } from "../services/hubSpotCompanySync.js";

const HubSpotCompanySyncRequestSchema = z
  .object({ companyId: z.string().trim().min(1).max(500) })
  .strict();

export type SyncHubSpotCompanyFn = (args: {
  companyId: string;
}) => ReturnType<typeof syncHubSpotCompany>;

interface HubSpotCompanySyncRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  syncHubSpotCompanyFn?: SyncHubSpotCompanyFn;
}

interface HubSpotCompanySyncRouterDepsInjected {
  db?: undefined;
  syncHubSpotCompanyFn: SyncHubSpotCompanyFn;
}

export type HubSpotCompanySyncRouterDeps =
  | HubSpotCompanySyncRouterDepsWithDb
  | HubSpotCompanySyncRouterDepsInjected;

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

export function createHubSpotCompanySyncRouter(
  deps: HubSpotCompanySyncRouterDeps,
): IRouter {
  const router: IRouter = Router();
  let syncHubSpotCompanyFn: SyncHubSpotCompanyFn;
  if (deps.db) {
    const db = deps.db;
    syncHubSpotCompanyFn =
      deps.syncHubSpotCompanyFn ?? ((args) => syncHubSpotCompany({ db, ...args }));
  } else {
    syncHubSpotCompanyFn = deps.syncHubSpotCompanyFn;
  }

  router.post("/", async (req: Request, res: Response) => {
    const parsed = HubSpotCompanySyncRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log?.info("POST /internal/hubspot/company-sync: invalid request body");
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const { companyId } = parsed.data;
    try {
      const result = await syncHubSpotCompanyFn({ companyId });
      if (result.outcome === "conflict") {
        req.log?.info(
          { companyId, result: "conflict" },
          "POST /internal/hubspot/company-sync: canonical identity conflict",
        );
        res.status(409).json({
          error: "The HubSpot company id and domain resolve to different canonical accounts.",
          code: result.code,
          source: result.source,
          candidateMatches: result.candidateMatches,
          // Milestone 3E.3: observations are pre-resolution evidence and
          // are recorded regardless of identity conflict — see
          // ../services/hubSpotCompanySync.ts's module comment.
          observations: result.observations,
        });
        return;
      }

      req.log?.info(
        { companyId, accountId: result.accountId, result: result.outcome },
        `POST /internal/hubspot/company-sync: ${result.outcome}`,
      );
      res.status(200).json({
        status: result.outcome,
        source: result.source,
        accountId: result.accountId,
        attachedAliasTypes: result.attachedAliasTypes,
        observations: result.observations,
      });
    } catch (err) {
      if (err instanceof HubSpotNotConfiguredError) {
        sendError(res, 503, "hubspot_not_configured", "HubSpot synchronization is unavailable.");
        return;
      }
      if (err instanceof HubSpotApiError) {
        if (err.status === 404) {
          sendError(res, 404, "hubspot_company_not_found", "The HubSpot company was not found.");
          return;
        }
        sendError(res, 502, "hubspot_request_failed", "HubSpot could not be read.");
        return;
      }
      if (err instanceof HubSpotCompanyArchivedError) {
        sendError(res, 422, "hubspot_company_archived", err.message);
        return;
      }
      if (
        err instanceof HubSpotCompanyDomainUnavailableError ||
        err instanceof InvalidHubSpotCompanyDomainError
      ) {
        sendError(
          res,
          422,
          "hubspot_company_domain_unavailable",
          "The HubSpot company has no usable domain.",
        );
        return;
      }
      if (
        err instanceof HubSpotResponseError ||
        err instanceof InvalidHubSpotCompanyIdError ||
        err instanceof InvalidHubSpotCompanyNameError
      ) {
        sendError(res, 502, "hubspot_response_invalid", "HubSpot returned invalid company data.");
        return;
      }

      req.log?.error({ err }, "POST /internal/hubspot/company-sync failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
