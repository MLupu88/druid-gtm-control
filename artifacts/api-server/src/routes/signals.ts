// GTM V2 Unit 2 — POST /api/internal/signals: authenticated, idempotent
// signal ingestion. Service-to-service only: mounted behind
// ../middlewares/requireServiceAuth.ts (a shared-secret header), never
// ../middlewares/requireAuth.ts's browser session cookie — see ./index.ts
// for why this router's mount point must stay outside every requireAuth-
// gated /internal prefix.
//
// Accepts { normalizedSignal, rawPayload } as siblings — rawPayload is
// never embedded inside normalizedSignal, and normalizedSignal is
// validated against @workspace/identity's own NormalizedSignalV1Schema
// (imported, not redefined) before this route does anything else.
//
// This route creates or replays exactly one signals row and nothing else:
// no account/person/alias creation, no identity resolution, no
// evaluation/decision/action side effects. See ../services/signals.ts for
// the canonicalization and insert-first idempotency this route delegates
// to.
//
// Only imports from ../services/signals.js and @workspace/identity, never
// @workspace/db itself — the database instance is a constructor argument
// (see SignalsRouterDeps below), mirroring every other router in this
// package.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { NormalizedSignalV1Schema, type NormalizedSignalV1 } from "@workspace/identity";
import {
  recordSignal,
  findPgConstraintErrorInfo,
  InvalidSignalDomainError,
  InvalidSignalWorkEmailError,
  type RecordSignalResult,
} from "../services/signals.js";

// rawPayload's base shape (a JSON object) is enforced by z.record itself
// rejecting non-object inputs (strings/numbers/booleans/null); the
// superRefine below additionally rejects arrays, which JS/zod would
// otherwise treat as a kind of object.
const IngestSignalRequestSchema = z
  .object({
    normalizedSignal: NormalizedSignalV1Schema,
    rawPayload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (Array.isArray(val.rawPayload)) {
      ctx.addIssue({
        code: "custom",
        path: ["rawPayload"],
        message: "rawPayload must be a JSON object, not an array.",
      });
    }
  });

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

export type RecordSignalFn = (args: {
  normalizedSignal: NormalizedSignalV1;
  rawPayload: Record<string, unknown>;
}) => Promise<RecordSignalResult>;

interface SignalsRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  recordSignalFn?: RecordSignalFn;
}

interface SignalsRouterDepsInjected {
  db?: undefined;
  recordSignalFn: RecordSignalFn;
}

export type SignalsRouterDeps = SignalsRouterDepsWithDb | SignalsRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or a full recordSignalFn override, and tests can inject a fake
 * implementation with no PostgreSQL connection at all. Production wiring
 * (../routes/index.ts) passes the real @workspace/db singleton. Declares
 * only "/" — the caller mounts this router at the full, specific
 * "/internal/signals" prefix (not the shared "/internal" prefix every
 * requireAuth-gated router uses), so this handler is reached without ever
 * passing through the browser-session auth boundary.
 */
export function createSignalsRouter(deps: SignalsRouterDeps): IRouter {
  const router: IRouter = Router();

  let recordSignalFn: RecordSignalFn;
  if (deps.db) {
    const db = deps.db;
    recordSignalFn = deps.recordSignalFn ?? ((args) => recordSignal({ db, ...args }));
  } else {
    recordSignalFn = deps.recordSignalFn;
  }

  router.post("/", async (req: Request, res: Response) => {
    const parsed = IngestSignalRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log?.info("POST /internal/signals: invalid request body");
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const { normalizedSignal, rawPayload } = parsed.data;

    try {
      const result = await recordSignalFn({ normalizedSignal, rawPayload });

      if (result.outcome === "conflict") {
        req.log?.info(
          {
            source: result.existingSignal.source,
            sourceEventId: result.existingSignal.sourceEventId,
            signalId: result.existingSignal.id,
            result: "conflict",
          },
          "POST /internal/signals: conflict",
        );
        res.status(409).json({
          error:
            "A signal already exists for this source and sourceEventId with different content.",
          code: "signal_conflict",
          existingSignalId: result.existingSignal.id,
        });
        return;
      }

      const { signal } = result;
      req.log?.info(
        {
          source: signal.source,
          sourceEventId: signal.sourceEventId,
          signalType: signal.signalType,
          observedResolutionLevel: signal.observedResolutionLevel,
          signalId: signal.id,
          result: result.outcome,
        },
        `POST /internal/signals: ${result.outcome}`,
      );
      res.status(result.outcome === "created" ? 201 : 200).json({
        signalId: signal.id,
        status: result.outcome,
        source: signal.source,
        sourceEventId: signal.sourceEventId,
        createdAt: signal.createdAt,
      });
    } catch (err) {
      if (
        err instanceof InvalidSignalDomainError ||
        err instanceof InvalidSignalWorkEmailError
      ) {
        sendError(res, 400, "invalid_request", "The request body is invalid.");
        return;
      }

      const pgInfo = findPgConstraintErrorInfo(err);
      req.log?.error(
        { pgErrorCode: pgInfo?.code, pgConstraint: pgInfo?.constraint },
        "POST /internal/signals failed",
      );
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
