// LS3 — Live Shell Closure: GET /internal/overview/metrics. Read-only
// canonical Overview aggregate — no writes, no Sheets dependency, no
// scoring. Mounted behind the existing requireAuth session boundary (see
// ./index.ts), same as every other /internal/* browser-facing route.
//
// Only imports from ../services/overviewMetrics.js and @workspace/db/schema
// (types only) — never @workspace/db itself; the database instance is a
// constructor argument (see OverviewRouterDeps below), mirroring every
// other router in this package.

import { Router, type IRouter, type Request, type Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  getOverviewMetrics,
  type OverviewMetrics,
} from "../services/overviewMetrics.js";

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

export type GetOverviewMetricsFn = () => Promise<OverviewMetrics>;

interface OverviewRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  getOverviewMetricsFn?: GetOverviewMetricsFn;
}

interface OverviewRouterDepsInjected {
  db?: undefined;
  getOverviewMetricsFn: GetOverviewMetricsFn;
}

export type OverviewRouterDeps = OverviewRouterDepsWithDb | OverviewRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or a full getOverviewMetricsFn override, and tests can inject a fake
 * implementation with no PostgreSQL connection at all. Production wiring
 * (../routes/index.ts) passes the real @workspace/db singleton. Declares
 * only "/metrics" — the caller mounts this router at the full, specific
 * "/internal/overview" prefix.
 */
export function createOverviewRouter(deps: OverviewRouterDeps): IRouter {
  const router: IRouter = Router();

  let getOverviewMetricsFn: GetOverviewMetricsFn;
  if (deps.db) {
    const db = deps.db;
    getOverviewMetricsFn = deps.getOverviewMetricsFn ?? (() => getOverviewMetrics({ db }));
  } else {
    getOverviewMetricsFn = deps.getOverviewMetricsFn;
  }

  router.get("/metrics", async (req: Request, res: Response) => {
    try {
      const metrics = await getOverviewMetricsFn();
      res.status(200).json(metrics);
    } catch (err) {
      req.log?.error({ err }, "GET /internal/overview/metrics failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
