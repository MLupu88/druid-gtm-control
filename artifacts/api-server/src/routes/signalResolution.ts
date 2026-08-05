// GTM V2 Unit 3 — POST /api/internal/signals/:signalId/resolve:
// authenticated, idempotent runtime identity resolution for exactly one
// already-persisted signal. Service-to-service only: mounted behind
// ../middlewares/requireServiceAuth.ts (the same shared-secret header
// Unit 2's signal-ingestion route uses), never
// ../middlewares/requireAuth.ts's browser session cookie.
//
// Accepts no resolution evidence from the caller — every input to
// resolution comes from the already-persisted, immutable signal row (see
// ../services/identityResolution.ts). The request body must be absent or
// an empty JSON object; any key at all is rejected as invalid.
//
// Only imports from ../services/identityResolution.js, never
// @workspace/db itself — the database instance is a constructor argument
// (see SignalResolutionRouterDeps below), mirroring ../routes/signals.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { resolveSignal, type ResolveSignalResult } from "../services/identityResolution.js";

// Allows an entirely absent body (express.json() leaves req.body as {}
// when no body/content-type is sent) or an explicit {} — anything with a
// key at all is invalid, since this route accepts no resolution evidence
// from the caller.
const ResolveSignalRequestSchema = z.object({}).strict();

// Mirrors ../routes/accounts.ts's AccountIdParamsSchema convention:
// validated up front so a malformed (non-UUID) signalId is a clean 400,
// never a raw Postgres "invalid input syntax for type uuid" surfacing as
// a 500.
const SignalIdParamsSchema = z.object({ signalId: z.string().uuid() }).strict();

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

export type ResolveSignalFn = (args: { signalId: string }) => Promise<ResolveSignalResult>;

interface SignalResolutionRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  resolveSignalFn?: ResolveSignalFn;
}

interface SignalResolutionRouterDepsInjected {
  db?: undefined;
  resolveSignalFn: ResolveSignalFn;
}

export type SignalResolutionRouterDeps = SignalResolutionRouterDepsWithDb | SignalResolutionRouterDepsInjected;

/**
 * Factory (not a bare router), mirroring ../routes/signals.ts's
 * createSignalsRouter exactly: callers supply either a db instance or a
 * full resolveSignalFn override, so tests can inject a fake
 * implementation with no PostgreSQL connection at all. Declares only
 * "/:signalId/resolve" — the caller mounts this router at the full
 * "/internal/signals" prefix (see ../routes/index.ts), alongside the
 * existing signal-ingestion router, so both stay behind
 * requireServiceAuth and never the browser-session auth boundary.
 */
export function createSignalResolutionRouter(deps: SignalResolutionRouterDeps): IRouter {
  const router: IRouter = Router();

  let resolveSignalFn: ResolveSignalFn;
  if (deps.db) {
    const db = deps.db;
    resolveSignalFn = deps.resolveSignalFn ?? ((args) => resolveSignal({ db, ...args }));
  } else {
    resolveSignalFn = deps.resolveSignalFn;
  }

  router.post("/:signalId/resolve", async (req: Request, res: Response) => {
    const paramsParsed = SignalIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      req.log?.info("POST /internal/signals/:signalId/resolve: invalid signalId");
      sendError(res, 400, "invalid_request", "signalId must be a valid UUID.");
      return;
    }

    const bodyParsed = ResolveSignalRequestSchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      req.log?.info("POST /internal/signals/:signalId/resolve: invalid request body");
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const { signalId } = paramsParsed.data;

    try {
      const result = await resolveSignalFn({ signalId });

      if (result.kind === "signal_not_found") {
        req.log?.info({ signalId }, "POST /internal/signals/:signalId/resolve: signal not found");
        sendError(res, 404, "signal_not_found", "The signal was not found.");
        return;
      }

      const { event, status } = result;
      req.log?.info(
        {
          signalId,
          eventId: event.id,
          status,
          outcome: event.outcome,
          resolutionLevel: event.resolutionLevel,
          accountId: event.accountId,
          personId: event.personId,
          accountMatchAction: event.accountMatchAction,
          personMatchAction: event.personMatchAction,
          resolutionMethod: event.resolutionMethod,
          resolverVersion: event.resolverVersion,
        },
        `POST /internal/signals/:signalId/resolve: ${status}`,
      );
      res.status(200).json({
        signalId,
        eventId: event.id,
        status,
        outcome: event.outcome,
        resolutionLevel: event.resolutionLevel,
        accountId: event.accountId,
        personId: event.personId,
        accountMatchAction: event.accountMatchAction,
        personMatchAction: event.personMatchAction,
        createdAt: event.createdAt,
      });
    } catch (err) {
      const pgInfo = findPgConstraintErrorInfoForLogging(err);
      req.log?.error(
        { signalId, pgErrorCode: pgInfo?.code, pgConstraint: pgInfo?.constraint },
        "POST /internal/signals/:signalId/resolve failed",
      );
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}

// Local mirror of ../services/identityResolution.ts's own constraint-info
// walk, used only to pick safe (code/constraint, never raw values) fields
// for the failure log line above — same localized-copy convention as
// ../services/signals.ts and ../services/accountFacts.ts.
const MAX_ERROR_CAUSE_DEPTH = 5;

function findPgConstraintErrorInfoForLogging(err: unknown): { code: string; constraint: string } | null {
  const visited = new Set<unknown>();
  let current: unknown = err;

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    if (visited.has(current)) return null;
    visited.add(current);

    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.constraint === "string") {
      return { code: candidate.code, constraint: candidate.constraint };
    }

    current = candidate.cause;
  }
  return null;
}
