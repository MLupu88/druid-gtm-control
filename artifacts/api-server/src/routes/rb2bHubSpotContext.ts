// RB2B -> HubSpot context link (minimal current slice) — POST
// /internal/rb2b/hubspot-context. Service-to-service only, mounted behind
// ../middlewares/requireServiceAuth.ts, the same shared-secret boundary
// already used by ./rb2bSignalBridge.ts (see ../routes/index.ts for why
// this router's mount point must stay outside every requireAuth-gated
// /internal prefix, same rationale as that router's own comment).
//
// n8n calls this AFTER POST /internal/rb2b/signals has already resolved a
// canonical Account, passing that observation response's identity.account
// data back here. companyDomain is accepted for shape-compatibility with
// the RB2B ingestion response but is never trusted for the actual HubSpot
// search — see ../services/hubSpotContextRefresh.ts's own module comment:
// only the resolved account's own stored companyDomain is ever searched.
//
// This route performs no HubSpot or canonical-account logic directly —
// both are owned by ../services/hubSpotContextRefresh.ts, which in turn
// delegates matched-company sync entirely to the existing
// ../services/hubSpotCompanySync.ts path. Only imports from
// ../services/hubSpotContextRefresh.js — never @workspace/db itself; the
// database instance is a constructor argument, mirroring every other
// router in this package.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  AccountNotFoundError,
  refreshHubSpotContextForAccount,
  type RefreshHubSpotContextResult,
} from "../services/hubSpotContextRefresh.js";

const Rb2bHubSpotContextRequestSchema = z
  .object({
    accountId: z.string().uuid(),
    // Accepted, never trusted as the search input — see module comment.
    companyDomain: z.string().nullable().optional(),
  })
  .strict();

export type RefreshHubSpotContextFn = (args: {
  accountId: string;
}) => Promise<RefreshHubSpotContextResult>;

interface Rb2bHubSpotContextRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  refreshHubSpotContextFn?: RefreshHubSpotContextFn;
}

interface Rb2bHubSpotContextRouterDepsInjected {
  db?: undefined;
  refreshHubSpotContextFn: RefreshHubSpotContextFn;
}

export type Rb2bHubSpotContextRouterDeps =
  | Rb2bHubSpotContextRouterDepsWithDb
  | Rb2bHubSpotContextRouterDepsInjected;

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

export function createRb2bHubSpotContextRouter(
  deps: Rb2bHubSpotContextRouterDeps,
): IRouter {
  const router: IRouter = Router();

  let refreshHubSpotContextFn: RefreshHubSpotContextFn;
  if (deps.db) {
    const db = deps.db;
    refreshHubSpotContextFn =
      deps.refreshHubSpotContextFn ??
      ((args) => refreshHubSpotContextForAccount({ db, ...args }));
  } else {
    refreshHubSpotContextFn = deps.refreshHubSpotContextFn;
  }

  router.post("/", async (req: Request, res: Response) => {
    const parsed = Rb2bHubSpotContextRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log?.info("POST /internal/rb2b/hubspot-context: invalid request body");
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const { accountId } = parsed.data;
    try {
      const result = await refreshHubSpotContextFn({ accountId });
      req.log?.info(
        {
          accountId,
          lookupStatus: result.hubspot.lookupStatus,
          syncStatus: result.hubspot.syncStatus,
          conflict: result.hubspot.conflict?.code ?? null,
        },
        "POST /internal/rb2b/hubspot-context: complete",
      );
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AccountNotFoundError) {
        sendError(res, 404, "account_not_found", err.message);
        return;
      }
      req.log?.error({ err }, "POST /internal/rb2b/hubspot-context failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
