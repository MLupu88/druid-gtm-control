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
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  getOverviewMetrics,
  type OverviewMetrics,
} from "../services/overviewMetrics.js";
import {
  getGlobalRecentActivity,
  type GlobalActivityItemDTO,
} from "../services/accountActivity.js";
import {
  getOverviewCharts,
  type OverviewCharts,
} from "../services/overviewCharts.js";
import {
  getOverviewSummary,
  OverviewSummaryUnavailableError,
  type OverviewSummaryResult,
} from "../services/overviewSummary.js";
import { createTtlCachedFn } from "../lib/ttlCache.js";

const DEFAULT_ACTIVITY_LIMIT = 20;
const MIN_ACTIVITY_LIMIT = 1;
const MAX_ACTIVITY_LIMIT = 100;

// Mirrors ./accounts.ts's ListAccountsQuerySchema convention exactly:
// z.coerce.number() then int/min/max, invalid input is a 400, never a
// silently-clamped value.
const GetActivityQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(MIN_ACTIVITY_LIMIT)
      .max(MAX_ACTIVITY_LIMIT)
      .default(DEFAULT_ACTIVITY_LIMIT),
  })
  .strict();

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

export type GetOverviewMetricsFn = () => Promise<OverviewMetrics>;
export type GetGlobalActivityFn = (limit: number) => Promise<GlobalActivityItemDTO[]>;
export type GetOverviewChartsFn = () => Promise<OverviewCharts>;
export type GetOverviewSummaryFn = () => Promise<OverviewSummaryResult>;

// LS6 — a fresh AI Summary is expensive (a paid LLM call) and never
// needs to be regenerated on every Overview render/refetch; the
// underlying canonical data changes at most once per ingestion cycle,
// not once per page view. See ../lib/ttlCache.ts's own comment: this
// deliberately caches only successful generations, so a user-initiated
// retry after a failure always attempts a fresh call.
const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;

interface OverviewRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  getOverviewMetricsFn?: GetOverviewMetricsFn;
  getGlobalActivityFn?: GetGlobalActivityFn;
  getOverviewChartsFn?: GetOverviewChartsFn;
  getOverviewSummaryFn?: GetOverviewSummaryFn;
}

interface OverviewRouterDepsInjected {
  db?: undefined;
  getOverviewMetricsFn: GetOverviewMetricsFn;
  getGlobalActivityFn: GetGlobalActivityFn;
  getOverviewChartsFn: GetOverviewChartsFn;
  getOverviewSummaryFn: GetOverviewSummaryFn;
}

export type OverviewRouterDeps = OverviewRouterDepsWithDb | OverviewRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or full service-function overrides, and tests can inject fake
 * implementations with no PostgreSQL connection at all. Production wiring
 * (../routes/index.ts) passes the real @workspace/db singleton. Declares
 * only "/metrics", "/activity", "/charts", and "/summary" — the caller
 * mounts this router at the full, specific "/internal/overview" prefix.
 */
export function createOverviewRouter(deps: OverviewRouterDeps): IRouter {
  const router: IRouter = Router();

  let getOverviewMetricsFn: GetOverviewMetricsFn;
  let getGlobalActivityFn: GetGlobalActivityFn;
  let getOverviewChartsFn: GetOverviewChartsFn;
  let getOverviewSummaryFn: GetOverviewSummaryFn;
  if (deps.db) {
    const db = deps.db;
    getOverviewMetricsFn = deps.getOverviewMetricsFn ?? (() => getOverviewMetrics({ db }));
    getGlobalActivityFn =
      deps.getGlobalActivityFn ?? ((limit) => getGlobalRecentActivity(db, limit));
    getOverviewChartsFn = deps.getOverviewChartsFn ?? (() => getOverviewCharts({ db }));
    getOverviewSummaryFn =
      deps.getOverviewSummaryFn ??
      createTtlCachedFn(() => getOverviewSummary({ db }), SUMMARY_CACHE_TTL_MS);
  } else {
    getOverviewMetricsFn = deps.getOverviewMetricsFn;
    getGlobalActivityFn = deps.getGlobalActivityFn;
    getOverviewChartsFn = deps.getOverviewChartsFn;
    getOverviewSummaryFn = deps.getOverviewSummaryFn;
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

  // GET /activity — LS4. Canonical global cross-account Recent Activity,
  // newest first. Postgres-only, reuses the same account-binding
  // machinery ./accounts.ts's /:accountId/activity route uses (see
  // ../services/accountActivity.ts's getGlobalRecentActivity).
  router.get("/activity", async (req: Request, res: Response) => {
    const parsed = GetActivityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "The query parameters are invalid.");
      return;
    }

    try {
      const items = await getGlobalActivityFn(parsed.data.limit);
      res.status(200).json({ items });
    } catch (err) {
      req.log?.error({ err }, "GET /internal/overview/activity failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /charts — LS5. The two canonical Overview charts (signals over
  // time, signals by provider), both over the same 7-day/importedAt
  // window ./services/overviewMetrics.ts's signalsCaptured uses. See
  // ../services/overviewCharts.ts for exact semantics.
  router.get("/charts", async (req: Request, res: Response) => {
    try {
      const charts = await getOverviewChartsFn();
      res.status(200).json(charts);
    } catch (err) {
      req.log?.error({ err }, "GET /internal/overview/charts failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /summary — LS6. A compact, grounded, factual digest of the same
  // canonical aggregates the routes above already expose. AI failure
  // (any reason — not configured, provider error, ungrounded/forbidden
  // output) maps to a distinct, safe 503 the frontend renders as an
  // honest "unavailable" state — it never breaks the rest of Overview,
  // and never falls back to fake/template "AI-generated" content. See
  // ../services/overviewSummary.ts for the grounding guarantee.
  router.get("/summary", async (req: Request, res: Response) => {
    try {
      const summary = await getOverviewSummaryFn();
      res.status(200).json(summary);
    } catch (err) {
      if (err instanceof OverviewSummaryUnavailableError) {
        req.log?.info({ reason: err.reason }, "GET /internal/overview/summary unavailable");
        sendError(res, 503, "ai_summary_unavailable", "AI Summary is currently unavailable.");
        return;
      }
      req.log?.error({ err }, "GET /internal/overview/summary failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
