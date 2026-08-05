// GTM V2 Stage 3, Unit 2 — POST /api/internal/accounts/:accountId/attention-items:
// authenticated, idempotent creation of one open attention item for a
// canonical account. Service-to-service only: mounted behind
// ../middlewares/requireServiceAuth.ts (the same shared-secret header
// ../routes/signals.ts uses), never ../middlewares/requireAuth.ts's
// browser session cookie — there is no server-derivable operator identity
// at this boundary, which is why createdBy is a required, caller-supplied
// request field (contrast with ../routes/accountFacts.ts's
// deriveRecordedBy, which reads req.operator under requireAuth).
//
// Mounted at the full, specific "/internal/accounts/:accountId/attention-items"
// prefix (see ../routes/index.ts) — deliberately NOT the shared
// "/internal/accounts" prefix the requireAuth-gated ../routes/accounts.ts
// router already owns. Registering requireServiceAuth in front of the
// shared prefix would force the secret header onto every existing
// browser-session accounts request too; the specific prefix (which only
// ever matches a request carrying an ".../attention-items" path segment)
// avoids that collision entirely, mirroring signals.ts's own "mount at
// the full, specific prefix" rule. Because :accountId lives in the MOUNT
// pattern rather than this router's own route, the router below is
// constructed with { mergeParams: true } so req.params.accountId is still
// visible inside its handler.
//
// Only imports from ../services/attentionItems.js, never @workspace/db
// itself — the database instance is a constructor argument (see
// AttentionItemsRouterDeps below), mirroring every other router in this
// package.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { attentionSource, type AttentionItem } from "@workspace/db/schema";
import {
  createAttentionItem,
  AttentionAccountNotFoundError,
  type CreateAttentionItemResult,
} from "../services/attentionItems.js";

const AccountIdParamsSchema = z.object({ accountId: z.string().uuid() }).strict();

// context's base shape (a JSON object) is enforced by z.record itself
// rejecting non-object inputs (strings/numbers/booleans/null); the
// superRefine below additionally rejects arrays, which JS/zod would
// otherwise treat as a kind of object — mirrors ../routes/signals.ts's
// rawPayload check exactly. reasonDetail/sourceRef use
// .trim().min(1).nullable().optional(): absent (undefined) or explicit
// null both mean "not supplied"; a present-but-blank string is rejected
// as invalid rather than silently coerced, matching
// attention_items_reason_detail_not_blank_if_present /
// attention_items_source_ref_not_blank_if_present's CHECKs.
const CreateAttentionItemRequestSchema = z
  .object({
    reasonCode: z.string().trim().min(1),
    reasonDetail: z.string().trim().min(1).nullable().optional(),
    source: z.enum(attentionSource.enumValues),
    sourceRef: z.string().trim().min(1).nullable().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    createdBy: z.string().trim().min(1),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (Array.isArray(val.context)) {
      ctx.addIssue({
        code: "custom",
        path: ["context"],
        message: "context must be a JSON object, not an array.",
      });
    }
  });

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code });
}

// Allow-lists the fields returned to callers — never spreads a raw
// AttentionItem row into the HTTP response.
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

export type CreateAttentionItemFn = (args: {
  accountId: string;
  reasonCode: string;
  reasonDetail: string | null;
  source: AttentionItem["source"];
  sourceRef: string | null;
  context: Record<string, unknown>;
  createdBy: string;
}) => Promise<CreateAttentionItemResult>;

interface AttentionItemsRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  createAttentionItemFn?: CreateAttentionItemFn;
}

interface AttentionItemsRouterDepsInjected {
  db?: undefined;
  createAttentionItemFn: CreateAttentionItemFn;
}

export type AttentionItemsRouterDeps = AttentionItemsRouterDepsWithDb | AttentionItemsRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or a full createAttentionItemFn override, and tests can inject a fake
 * implementation with no PostgreSQL connection at all. Production wiring
 * (../routes/index.ts) passes the real @workspace/db singleton. Declares
 * only "/" (POST) — the caller mounts this router at the full, specific
 * "/internal/accounts/:accountId/attention-items" prefix with
 * { mergeParams: true } already applied here, so req.params.accountId is
 * available in the handler below despite :accountId being part of the
 * parent mount path, not this router's own route.
 */
export function createAttentionItemsRouter(deps: AttentionItemsRouterDeps): IRouter {
  const router: IRouter = Router({ mergeParams: true });

  let createAttentionItemFn: CreateAttentionItemFn;
  if (deps.db) {
    const db = deps.db;
    createAttentionItemFn = deps.createAttentionItemFn ?? ((args) => createAttentionItem({ db, ...args }));
  } else {
    createAttentionItemFn = deps.createAttentionItemFn;
  }

  router.post("/", async (req: Request, res: Response) => {
    const paramsParsed = AccountIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
      return;
    }

    const bodyParsed = CreateAttentionItemRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      req.log?.info(
        { issues: bodyParsed.error.issues },
        "POST /internal/accounts/:accountId/attention-items: invalid request body",
      );
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const { accountId } = paramsParsed.data;
    const { reasonCode, reasonDetail, source, sourceRef, context, createdBy } = bodyParsed.data;

    try {
      const result = await createAttentionItemFn({
        accountId,
        reasonCode,
        reasonDetail: reasonDetail ?? null,
        source,
        sourceRef: sourceRef ?? null,
        context: context ?? {},
        createdBy,
      });

      if (result.outcome === "conflict") {
        req.log?.info(
          {
            accountId,
            reasonCode,
            source,
            existingItemId: result.existingItem.id,
            result: "conflict",
          },
          "POST /internal/accounts/:accountId/attention-items: conflict",
        );
        res.status(409).json({
          error:
            "An open attention item already exists for this deduplication key with different content.",
          code: "attention_item_conflict",
          existingItemId: result.existingItem.id,
        });
        return;
      }

      req.log?.info(
        {
          accountId,
          reasonCode,
          source,
          itemId: result.item.id,
          result: result.outcome,
        },
        `POST /internal/accounts/:accountId/attention-items: ${result.outcome}`,
      );
      res.status(result.outcome === "created" ? 201 : 200).json({
        status: result.outcome,
        item: serializeAttentionItem(result.item),
      });
    } catch (err) {
      if (err instanceof AttentionAccountNotFoundError) {
        sendError(res, 404, "account_not_found", err.message);
        return;
      }
      req.log?.error({ err }, "POST /internal/accounts/:accountId/attention-items failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
