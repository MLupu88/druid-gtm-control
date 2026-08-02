// Controlled endpoints for Client Radar research runs — starting a
// research request for a canonical account, reading its latest attempt,
// and refreshing a non-terminal run's status. No HTTP concerns beyond
// this boundary: every outbound call to Client Radar itself happens
// inside ../services/clientRadarResearchRuns.ts and
// ../lib/clientRadarClient.ts, neither of which this file touches
// directly.
//
// Mounted at /internal behind the existing requireAuth session boundary
// (see ./index.ts) — the same authenticated boundary already guarding
// /api/internal/accounts and /api/internal/account-decisions. This file
// assumes that boundary; it does not add or change any authentication
// middleware itself.
//
// Only imports from ../services/clientRadarResearchRuns.js, never
// @workspace/db itself — the database instance is a constructor argument
// (see ClientRadarResearchRunsRouterDeps below), so this module has no
// import-time side effects and route tests can inject fake service
// implementations without a real Postgres connection.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import type { ClientRadarResearchRun } from "@workspace/db/schema";
import {
  startClientRadarResearch,
  getLatestClientRadarResearchRun,
  refreshClientRadarResearchRun,
  AccountNotFoundError,
  AccountResearchInputError,
  ActiveResearchRunExistsError,
  ResearchRunNotFoundError,
} from "../services/clientRadarResearchRuns.js";
import { classifyClientRadarFailureReason } from "../lib/clientRadarClient.js";

// HTTP-contract-only addition: every research run this route returns is
// annotated with a computed (never persisted — no migration) failureReason,
// so the frontend can distinguish "Client Radar isn't configured in this
// environment" from a genuine runtime/request failure via a stable typed
// field instead of pattern-matching lastError text itself. See
// ../lib/clientRadarClient.ts's classifyClientRadarFailureReason.
function serializeResearchRun(run: ClientRadarResearchRun) {
  return {
    ...run,
    failureReason: classifyClientRadarFailureReason(run.status, run.lastError),
  };
}

const AccountIdParamsSchema = z.object({ accountId: z.string().uuid() }).strict();
const ResearchRunIdParamsSchema = z
  .object({ researchRunId: z.string().uuid() })
  .strict();

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

// Router-level service signatures — deliberately narrower than the real
// service functions: no db parameter. A real db is bound into the
// default implementation once, inside createClientRadarResearchRunsRouter
// (see below); callers that inject their own implementation supply one
// that needs no db at all, real or fake. ReturnType is used instead of
// naming the row type directly, so this file never needs to import
// @workspace/db/schema for anything but the Db type below.
export type StartClientRadarResearchFn = (args: {
  accountId: string;
}) => ReturnType<typeof startClientRadarResearch>;

export type GetLatestClientRadarResearchRunFn = (
  accountId: string,
) => ReturnType<typeof getLatestClientRadarResearchRun>;

export type RefreshClientRadarResearchRunFn = (
  researchRunId: string,
) => ReturnType<typeof refreshClientRadarResearchRun>;

// Two dependency shapes, chosen so a database is only ever required when
// it would actually be used:
//   - db supplied: the (optional) fn overrides fall back to the real
//     service, bound to that db. This is production wiring (routes/index.ts).
//   - all three fns supplied, no db: route tests can run the router with
//     no PostgreSQL connection at all, real or fake.
// TypeScript narrows on deps.db below: it is a required, always-truthy
// object in the first shape and always undefined in the second, so no
// cast is needed to recover either variant — same pattern as
// ../routes/accounts.ts's AccountsRouterDeps and
// ../routes/accountDecisions.ts's AccountDecisionsRouterDeps.
interface ClientRadarResearchRunsRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  startClientRadarResearchFn?: StartClientRadarResearchFn;
  getLatestClientRadarResearchRunFn?: GetLatestClientRadarResearchRunFn;
  refreshClientRadarResearchRunFn?: RefreshClientRadarResearchRunFn;
}

interface ClientRadarResearchRunsRouterDepsInjected {
  db?: undefined;
  startClientRadarResearchFn: StartClientRadarResearchFn;
  getLatestClientRadarResearchRunFn: GetLatestClientRadarResearchRunFn;
  refreshClientRadarResearchRunFn: RefreshClientRadarResearchRunFn;
}

export type ClientRadarResearchRunsRouterDeps =
  | ClientRadarResearchRunsRouterDepsWithDb
  | ClientRadarResearchRunsRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or full service overrides, and tests can inject fake service
 * implementations, running these routes with no PostgreSQL connection at
 * all. Production wiring (routes/index.ts) passes the real @workspace/db
 * singleton. Assumes it is mounted behind requireAuth — no auth
 * middleware is added here. Declares relative paths only (e.g.
 * "/accounts/:accountId/client-radar-research"); the caller mounts this
 * router at /internal.
 */
export function createClientRadarResearchRunsRouter(
  deps: ClientRadarResearchRunsRouterDeps,
): IRouter {
  const router: IRouter = Router();

  let startClientRadarResearchFn: StartClientRadarResearchFn;
  let getLatestClientRadarResearchRunFn: GetLatestClientRadarResearchRunFn;
  let refreshClientRadarResearchRunFn: RefreshClientRadarResearchRunFn;
  if (deps.db) {
    const db = deps.db;
    startClientRadarResearchFn =
      deps.startClientRadarResearchFn ??
      ((args) => startClientRadarResearch({ db, ...args }));
    getLatestClientRadarResearchRunFn =
      deps.getLatestClientRadarResearchRunFn ??
      ((accountId) => getLatestClientRadarResearchRun(db, accountId));
    refreshClientRadarResearchRunFn =
      deps.refreshClientRadarResearchRunFn ??
      ((researchRunId) => refreshClientRadarResearchRun(db, researchRunId));
  } else {
    startClientRadarResearchFn = deps.startClientRadarResearchFn;
    getLatestClientRadarResearchRunFn = deps.getLatestClientRadarResearchRunFn;
    refreshClientRadarResearchRunFn = deps.refreshClientRadarResearchRunFn;
  }

  // POST /accounts/:accountId/client-radar-research — start a new
  // research run for the canonical account. No request body is consumed:
  // the company/domain submitted to Client Radar is derived entirely from
  // the stored account row inside the service.
  router.post(
    "/accounts/:accountId/client-radar-research",
    async (req: Request, res: Response) => {
      const parsed = AccountIdParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
        return;
      }

      try {
        const researchRun = await startClientRadarResearchFn({
          accountId: parsed.data.accountId,
        });
        res.status(201).json({ researchRun: serializeResearchRun(researchRun) });
      } catch (err) {
        if (err instanceof AccountNotFoundError) {
          sendError(res, 404, "account_not_found", err.message);
          return;
        }
        if (err instanceof AccountResearchInputError) {
          sendError(res, 400, "account_research_input_invalid", err.message);
          return;
        }
        if (err instanceof ActiveResearchRunExistsError) {
          res.status(409).json({
            error: err.message,
            code: "active_research_run_exists",
            existingRun: serializeResearchRun(err.existingRun),
          });
          return;
        }
        req.log?.error(
          { err },
          "POST /internal/accounts/:accountId/client-radar-research failed",
        );
        sendError(res, 500, "internal_error", "An unexpected error occurred.");
      }
    },
  );

  // GET /accounts/:accountId/client-radar-research — the account's latest
  // research attempt, if any. A missing row (never researched, or an
  // unknown accountId) is a normal 200 with researchRun: null, not a 404
  // — this endpoint does not run a second query solely to distinguish
  // those two cases.
  router.get(
    "/accounts/:accountId/client-radar-research",
    async (req: Request, res: Response) => {
      const parsed = AccountIdParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
        return;
      }

      try {
        const researchRun = await getLatestClientRadarResearchRunFn(
          parsed.data.accountId,
        );
        res
          .status(200)
          .json({ researchRun: researchRun ? serializeResearchRun(researchRun) : null });
      } catch (err) {
        req.log?.error(
          { err },
          "GET /internal/accounts/:accountId/client-radar-research failed",
        );
        sendError(res, 500, "internal_error", "An unexpected error occurred.");
      }
    },
  );

  // POST /client-radar-research/:researchRunId/refresh — poll Client
  // Radar for a non-terminal run and persist the result. Terminal/
  // submitting rows are handled as no-ops inside the service itself; this
  // handler only maps ResearchRunNotFoundError and unexpected failures.
  router.post(
    "/client-radar-research/:researchRunId/refresh",
    async (req: Request, res: Response) => {
      const parsed = ResearchRunIdParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        sendError(
          res,
          400,
          "invalid_request",
          "researchRunId must be a valid UUID.",
        );
        return;
      }

      try {
        const researchRun = await refreshClientRadarResearchRunFn(
          parsed.data.researchRunId,
        );
        res.status(200).json({ researchRun: serializeResearchRun(researchRun) });
      } catch (err) {
        if (err instanceof ResearchRunNotFoundError) {
          sendError(res, 404, "research_run_not_found", err.message);
          return;
        }
        req.log?.error(
          { err },
          "POST /internal/client-radar-research/:researchRunId/refresh failed",
        );
        sendError(res, 500, "internal_error", "An unexpected error occurred.");
      }
    },
  );

  return router;
}
