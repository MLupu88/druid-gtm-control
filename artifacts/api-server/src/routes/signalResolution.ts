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
// GTM V2 Stage 2 Unit 4 — GET /api/internal/signals/:signalId/identity:
// the read-only counterpart. Returns the "current identity binding" —
// derived, never stored — for exactly one signal. Same auth boundary,
// same router, same "/internal/signals" mount point as the resolve route
// above (see ../services/identityResolution.ts's
// getCurrentIdentityBinding for the query itself). Distinguishes a
// missing signal (404) from a signal with no resolution event yet (200,
// hasBinding: false) from a signal with a current binding (200,
// hasBinding: true) — see that service function's own comment for why a
// single query can tell all three apart. Exposes only the same safe
// field set the resolve route's response already exposes (never
// resolutionMethod, confidence, resolverVersion, candidateMatches,
// reason, or anything from signals.raw_payload/normalized_payload).
//
// Only imports from ../services/identityResolution.js, never
// @workspace/db itself — the database instance is a constructor argument
// (see SignalResolutionRouterDeps below), mirroring ../routes/signals.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import type { IdentityResolutionEvent } from "@workspace/db/schema";
import {
  resolveSignal,
  getCurrentIdentityBinding,
  type ResolveSignalResult,
  type CurrentIdentityBindingResult,
} from "../services/identityResolution.js";

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
export type GetCurrentIdentityBindingFn = (args: {
  signalId: string;
}) => Promise<CurrentIdentityBindingResult>;

// The safe, allow-listed event fields both the resolve route's 200
// response and the identity read route's "bound" response expose —
// deliberately excludes resolutionMethod, confidence, resolverVersion,
// candidateMatches, reason, matchedAliasType, matchedAliasValue (see
// ../services/identityResolution.ts's IdentityResolutionEvent type for
// the full row shape this intentionally narrows).
function serializeEventFields(event: IdentityResolutionEvent) {
  return {
    eventId: event.id,
    outcome: event.outcome,
    resolutionLevel: event.resolutionLevel,
    accountId: event.accountId,
    personId: event.personId,
    accountMatchAction: event.accountMatchAction,
    personMatchAction: event.personMatchAction,
    createdAt: event.createdAt,
  };
}

interface SignalResolutionRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  resolveSignalFn?: ResolveSignalFn;
  getCurrentIdentityBindingFn?: GetCurrentIdentityBindingFn;
}

interface SignalResolutionRouterDepsInjected {
  db?: undefined;
  resolveSignalFn: ResolveSignalFn;
  getCurrentIdentityBindingFn: GetCurrentIdentityBindingFn;
}

export type SignalResolutionRouterDeps = SignalResolutionRouterDepsWithDb | SignalResolutionRouterDepsInjected;

/**
 * Factory (not a bare router), mirroring ../routes/signals.ts's
 * createSignalsRouter exactly: callers supply either a db instance or
 * full resolveSignalFn/getCurrentIdentityBindingFn overrides, so tests
 * can inject fake implementations with no PostgreSQL connection at all.
 * Declares "/:signalId/resolve" (POST) and "/:signalId/identity" (GET) —
 * the caller mounts this router at the full "/internal/signals" prefix
 * (see ../routes/index.ts), alongside the existing signal-ingestion
 * router, so both stay behind requireServiceAuth and never the
 * browser-session auth boundary.
 */
export function createSignalResolutionRouter(deps: SignalResolutionRouterDeps): IRouter {
  const router: IRouter = Router();

  let resolveSignalFn: ResolveSignalFn;
  let getCurrentIdentityBindingFn: GetCurrentIdentityBindingFn;
  if (deps.db) {
    const db = deps.db;
    resolveSignalFn = deps.resolveSignalFn ?? ((args) => resolveSignal({ db, ...args }));
    getCurrentIdentityBindingFn =
      deps.getCurrentIdentityBindingFn ?? ((args) => getCurrentIdentityBinding(db, args.signalId));
  } else {
    resolveSignalFn = deps.resolveSignalFn;
    getCurrentIdentityBindingFn = deps.getCurrentIdentityBindingFn;
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
        status,
        ...serializeEventFields(event),
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

  router.get("/:signalId/identity", async (req: Request, res: Response) => {
    const paramsParsed = SignalIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      req.log?.info("GET /internal/signals/:signalId/identity: invalid signalId");
      sendError(res, 400, "invalid_request", "signalId must be a valid UUID.");
      return;
    }

    const { signalId } = paramsParsed.data;

    try {
      const result = await getCurrentIdentityBindingFn({ signalId });

      if (result.kind === "signal_not_found") {
        req.log?.info({ signalId }, "GET /internal/signals/:signalId/identity: signal not found");
        sendError(res, 404, "signal_not_found", "The signal was not found.");
        return;
      }

      if (result.kind === "no_binding") {
        res.status(200).json({
          signalId,
          hasBinding: false,
          eventId: null,
          outcome: null,
          resolutionLevel: null,
          accountId: null,
          personId: null,
          accountMatchAction: null,
          personMatchAction: null,
          createdAt: null,
        });
        return;
      }

      res.status(200).json({
        signalId,
        hasBinding: true,
        ...serializeEventFields(result.event),
      });
    } catch (err) {
      const pgInfo = findPgConstraintErrorInfoForLogging(err);
      req.log?.error(
        { signalId, pgErrorCode: pgInfo?.code, pgConstraint: pgInfo?.constraint },
        "GET /internal/signals/:signalId/identity failed",
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
