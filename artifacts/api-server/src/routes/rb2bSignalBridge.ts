// Milestone 3E.2a — POST /internal/rb2b/signals: authenticated,
// idempotent RB2B behavioral_signal observation ingestion. Service-to-
// service only, mounted behind ../middlewares/requireServiceAuth.ts — see
// ./index.ts for why this router's mount point must stay outside every
// requireAuth-gated /internal prefix, same rationale as ./signals.ts.
//
// This route does NOT derive sourceRecordId or importedAt — both are
// caller-supplied (source_record_id, ingestion_attempt_at) and passed
// through exactly as received. Milestone 3E.2b (the n8n fan-out that
// must supply defensible values for both) is explicitly deferred — see
// NEXT_SESSION.md's 3E.2 checkpoint and
// ../services/rb2bObservationMapping.ts's module comment. Deriving
// either here would repeat the raw-body-fingerprint strategy already
// rejected during design.
//
// Validates the inbound bridge DTO, maps it to a behavioral_signal
// candidate (../services/rb2bObservationMapping.ts, a pure function),
// then re-validates that candidate against the canonical
// ProviderObservationV1Schema (imported from @workspace/observation,
// never redefined) before calling recordObservation() — the same
// insert-first/catch-23505 idempotent write path Milestone 3D built,
// reused unmodified.
//
// Only imports from ../services/*.js, @workspace/observation, and
// @workspace/db/schema (types only) — never @workspace/db itself; the
// database instance is a constructor argument (see
// Rb2bSignalBridgeRouterDeps below), mirroring every other router in
// this package.

import { Router, type IRouter, type Request, type Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { ProviderObservationV1Schema } from "@workspace/observation";
import {
  Rb2bSignalBridgeRequestSchema,
  mapRb2bSignalToObservation,
} from "../services/rb2bObservationMapping.js";
import {
  recordObservation,
  type RecordObservationArgs,
  type RecordObservationResult,
} from "../services/observations.js";

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

export type RecordObservationFn = (
  args: Pick<RecordObservationArgs, "observation">,
) => Promise<RecordObservationResult>;

interface Rb2bSignalBridgeRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  recordObservationFn?: RecordObservationFn;
}

interface Rb2bSignalBridgeRouterDepsInjected {
  db?: undefined;
  recordObservationFn: RecordObservationFn;
}

export type Rb2bSignalBridgeRouterDeps =
  | Rb2bSignalBridgeRouterDepsWithDb
  | Rb2bSignalBridgeRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or a full recordObservationFn override, and tests can inject a fake
 * implementation with no PostgreSQL connection at all. Production wiring
 * (../routes/index.ts) passes the real @workspace/db singleton. Declares
 * only "/" — the caller mounts this router at the full, specific
 * "/internal/rb2b/signals" prefix.
 */
export function createRb2bSignalBridgeRouter(
  deps: Rb2bSignalBridgeRouterDeps,
): IRouter {
  const router: IRouter = Router();

  let recordObservationFn: RecordObservationFn;
  if (deps.db) {
    const db = deps.db;
    recordObservationFn =
      deps.recordObservationFn ?? ((args) => recordObservation({ db, ...args }));
  } else {
    recordObservationFn = deps.recordObservationFn;
  }

  router.post("/", async (req: Request, res: Response) => {
    const parsedRequest = Rb2bSignalBridgeRequestSchema.safeParse(req.body);
    if (!parsedRequest.success) {
      req.log?.info("POST /internal/rb2b/signals: invalid request body");
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const candidate = mapRb2bSignalToObservation(parsedRequest.data);
    const parsedObservation = ProviderObservationV1Schema.safeParse(candidate);
    if (!parsedObservation.success) {
      req.log?.info(
        "POST /internal/rb2b/signals: invalid observation mapping",
      );
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    try {
      const result = await recordObservationFn({
        observation: parsedObservation.data,
      });

      if (result.outcome === "conflict") {
        req.log?.info(
          {
            provider: result.existingObservation.provider,
            sourceRecordId: result.existingObservation.sourceRecordId,
            observationId: result.existingObservation.id,
            result: "conflict",
          },
          "POST /internal/rb2b/signals: conflict",
        );
        res.status(409).json({
          error:
            "An observation already exists for this occurrence with different content.",
          code: "observation_conflict",
          existingObservationId: result.existingObservation.id,
        });
        return;
      }

      const { observation } = result;
      req.log?.info(
        {
          provider: observation.provider,
          sourceRecordId: observation.sourceRecordId,
          semanticKey: observation.semanticKey,
          observationId: observation.id,
          result: result.outcome,
        },
        `POST /internal/rb2b/signals: ${result.outcome}`,
      );
      res.status(result.outcome === "created" ? 201 : 200).json({
        observationId: observation.id,
        status: result.outcome,
        provider: observation.provider,
        sourceRecordId: observation.sourceRecordId,
        semanticKey: observation.semanticKey,
        importedAt: observation.importedAt,
      });
    } catch (err) {
      req.log?.error({ err }, "POST /internal/rb2b/signals failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
