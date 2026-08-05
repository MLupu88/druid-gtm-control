// GTM V2 Stage 3, Unit 2 — POST /api/internal/attention-items/:attentionItemId/resolve:
// authenticated, idempotent one-way resolution (open -> resolved) of one
// already-created attention item. Service-to-service only: mounted behind
// ../middlewares/requireServiceAuth.ts, never
// ../middlewares/requireAuth.ts's browser session cookie.
//
// Unlike ../routes/signalResolution.ts's POST /:signalId/resolve (which
// accepts no body at all, since every input to signal resolution is
// derivable from the already-persisted signal), this endpoint requires a
// body: resolvedBy and resolutionReason are caller-supplied and cannot be
// derived from anything already stored, and there is no req.operator at
// this auth boundary to fall back on.
//
// Mounted at "/internal/attention-items" (see ../routes/index.ts) — a
// prefix no other router in this package uses, so no ordering hazard with
// any requireAuth-gated mount.
//
// Only imports from ../services/attentionItems.js, never @workspace/db
// itself — the database instance is a constructor argument (see
// AttentionItemResolutionRouterDeps below), mirroring every other router
// in this package.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import type { AttentionItem } from "@workspace/db/schema";
import {
  resolveAttentionItem,
  type ResolveAttentionItemResult,
} from "../services/attentionItems.js";

const AttentionItemIdParamsSchema = z.object({ attentionItemId: z.string().uuid() }).strict();

const ResolveAttentionItemRequestSchema = z
  .object({
    resolvedBy: z.string().trim().min(1),
    resolutionReason: z.string().trim().min(1),
  })
  .strict();

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

// Allow-lists the fields returned to callers — never spreads a raw
// AttentionItem row into the HTTP response. Kept identical to
// ../routes/attentionItems.ts's own serializer (a small localized copy,
// not a shared cross-file helper, mirroring this package's existing
// convention for small per-route-file utilities).
function serializeAttentionItem(item: AttentionItem) {
  return {
    id: item.id,
    accountId: item.accountId,
    reasonCode: item.reasonCode,
    reasonDetail: item.reasonDetail,
    source: item.source,
    sourceRef: item.sourceRef,
    context: item.context,
    status: item.status,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    resolvedAt: item.resolvedAt,
    resolvedBy: item.resolvedBy,
    resolutionReason: item.resolutionReason,
  };
}

export type ResolveAttentionItemFn = (args: {
  attentionItemId: string;
  resolvedBy: string;
  resolutionReason: string;
}) => Promise<ResolveAttentionItemResult>;

interface AttentionItemResolutionRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  resolveAttentionItemFn?: ResolveAttentionItemFn;
}

interface AttentionItemResolutionRouterDepsInjected {
  db?: undefined;
  resolveAttentionItemFn: ResolveAttentionItemFn;
}

export type AttentionItemResolutionRouterDeps =
  | AttentionItemResolutionRouterDepsWithDb
  | AttentionItemResolutionRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or a full resolveAttentionItemFn override, and tests can inject a fake
 * implementation with no PostgreSQL connection at all. Production wiring
 * (../routes/index.ts) passes the real @workspace/db singleton. Declares
 * only "/:attentionItemId/resolve" (POST) — the caller mounts this router
 * at the "/internal/attention-items" prefix.
 */
export function createAttentionItemResolutionRouter(deps: AttentionItemResolutionRouterDeps): IRouter {
  const router: IRouter = Router();

  let resolveAttentionItemFn: ResolveAttentionItemFn;
  if (deps.db) {
    const db = deps.db;
    resolveAttentionItemFn = deps.resolveAttentionItemFn ?? ((args) => resolveAttentionItem({ db, ...args }));
  } else {
    resolveAttentionItemFn = deps.resolveAttentionItemFn;
  }

  router.post("/:attentionItemId/resolve", async (req: Request, res: Response) => {
    const paramsParsed = AttentionItemIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      sendError(res, 400, "invalid_request", "attentionItemId must be a valid UUID.");
      return;
    }

    const bodyParsed = ResolveAttentionItemRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      req.log?.info(
        { issues: bodyParsed.error.issues },
        "POST /internal/attention-items/:attentionItemId/resolve: invalid request body",
      );
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const { attentionItemId } = paramsParsed.data;
    const { resolvedBy, resolutionReason } = bodyParsed.data;

    try {
      const result = await resolveAttentionItemFn({ attentionItemId, resolvedBy, resolutionReason });

      if (result.kind === "not_found") {
        req.log?.info({ attentionItemId }, "POST /internal/attention-items/:attentionItemId/resolve: not found");
        sendError(res, 404, "attention_item_not_found", "The attention item was not found.");
        return;
      }

      if (result.kind === "conflict") {
        req.log?.info(
          { attentionItemId, result: "conflict" },
          "POST /internal/attention-items/:attentionItemId/resolve: conflict",
        );
        res.status(409).json({
          error: "The attention item was already resolved with different resolution data.",
          code: "attention_item_resolution_conflict",
          attentionItemId,
        });
        return;
      }

      req.log?.info(
        { attentionItemId, result: result.kind },
        `POST /internal/attention-items/:attentionItemId/resolve: ${result.kind}`,
      );
      res.status(200).json({
        status: result.kind,
        item: serializeAttentionItem(result.item),
      });
    } catch (err) {
      req.log?.error({ err }, "POST /internal/attention-items/:attentionItemId/resolve failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
