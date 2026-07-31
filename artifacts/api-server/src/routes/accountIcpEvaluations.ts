// Controlled endpoint for account-level ICP preview evaluations — starts
// a preview evaluation for a canonical account against an ICP profile,
// deriving its input entirely from the account's own current state (no
// signals, contact, or CRM data exists yet — see
// ../services/icpEvaluationResolvers.ts). Preview-only, deliberately:
// evaluationMode is never read from req.body/req.params/req.query/
// headers/a default here, and ../services/accountEvaluations.ts's
// runPreviewIcpEvaluationForAccount takes no evaluationMode parameter at
// all — "preview" is hardcoded inside it. There is no production branch,
// override, or generic mode parameter anywhere in this endpoint.
//
// Mounted at /internal behind the existing requireAuth session boundary
// (see ./index.ts) — the same authenticated boundary already guarding
// every other /api/internal/* router. This file assumes that boundary;
// it does not add or change any authentication middleware itself.
//
// Only imports from ../services/accountEvaluations.js (plus the error
// classes it composes), never @workspace/db itself — the database
// instance is a constructor argument (see
// AccountIcpEvaluationsRouterDeps below), so this module has no
// import-time side effects and route tests can inject fake service
// implementations without a real Postgres connection.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { runPreviewIcpEvaluationForAccount } from "../services/accountEvaluations.js";
import {
  AccountNotFoundError,
  NoResolvablePreviewVersionError,
} from "../services/icpEvaluationResolvers.js";
import { ProfileNotFoundError } from "../services/icpProfiles.js";
import { MissingRecordError } from "@workspace/evaluator-persistence";
import { UnsupportedEvaluatorVersionError } from "@workspace/evaluator";

const AccountIdParamsSchema = z.object({ accountId: z.string().uuid() }).strict();

// profileId only. A body containing evaluationMode (or any other field)
// is rejected by .strict() as an unrecognized field, same as any other
// unrecognized field elsewhere in this codebase — this is what makes
// "evaluationMode can never be smuggled in" an enforced property, not
// just a convention.
const CreateAccountIcpEvaluationRequestSchema = z
  .object({ profileId: z.string().uuid() })
  .strict();

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

// Router-level service signature — deliberately narrower than the real
// service function: no db parameter. A real db is bound into the
// default implementation once, inside createAccountIcpEvaluationsRouter
// (see below); callers that inject their own implementation supply one
// that needs no db at all, real or fake.
export type RunPreviewIcpEvaluationForAccountFn = (args: {
  accountId: string;
  profileId: string;
}) => ReturnType<typeof runPreviewIcpEvaluationForAccount>;

// Two dependency shapes, chosen so a database is only ever required when
// it would actually be used:
//   - db supplied: the (optional) fn override falls back to the real
//     service, bound to that db. This is production wiring (routes/index.ts).
//   - fn supplied, no db: route tests can run the router with no
//     PostgreSQL connection at all, real or fake.
// TypeScript narrows on deps.db below: it is a required, always-truthy
// object in the first shape and always undefined in the second, so no
// cast is needed to recover either variant — same pattern as
// ../routes/clientRadarResearchRuns.ts's Deps types.
interface AccountIcpEvaluationsRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  runPreviewIcpEvaluationForAccountFn?: RunPreviewIcpEvaluationForAccountFn;
}

interface AccountIcpEvaluationsRouterDepsInjected {
  db?: undefined;
  runPreviewIcpEvaluationForAccountFn: RunPreviewIcpEvaluationForAccountFn;
}

export type AccountIcpEvaluationsRouterDeps =
  | AccountIcpEvaluationsRouterDepsWithDb
  | AccountIcpEvaluationsRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or a full service override, and tests can inject a fake service
 * implementation, running this route with no PostgreSQL connection at
 * all. Production wiring (routes/index.ts) passes the real @workspace/db
 * singleton. Assumes it is mounted behind requireAuth — no auth
 * middleware is added here. Declares a relative path only
 * ("/accounts/:accountId/icp-evaluations"); the caller mounts this router
 * at /internal.
 */
export function createAccountIcpEvaluationsRouter(
  deps: AccountIcpEvaluationsRouterDeps,
): IRouter {
  const router: IRouter = Router();

  let runPreviewIcpEvaluationForAccountFn: RunPreviewIcpEvaluationForAccountFn;
  if (deps.db) {
    const db = deps.db;
    runPreviewIcpEvaluationForAccountFn =
      deps.runPreviewIcpEvaluationForAccountFn ??
      ((args) => runPreviewIcpEvaluationForAccount({ db, ...args }));
  } else {
    runPreviewIcpEvaluationForAccountFn = deps.runPreviewIcpEvaluationForAccountFn;
  }

  // POST /accounts/:accountId/icp-evaluations — start a preview ICP
  // evaluation for the account. A failed (but successfully persisted)
  // evaluation still returns 201, matching
  // ../routes/accountEvaluations.ts's existing behavior: a truthful
  // status: "failed" row is a successfully persisted resource, not an
  // HTTP error.
  router.post(
    "/accounts/:accountId/icp-evaluations",
    async (req: Request, res: Response) => {
      const paramsParsed = AccountIdParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
        return;
      }

      const bodyParsed = CreateAccountIcpEvaluationRequestSchema.safeParse(
        req.body,
      );
      if (!bodyParsed.success) {
        req.log?.info(
          { issues: bodyParsed.error.issues },
          "POST /internal/accounts/:accountId/icp-evaluations: invalid request body",
        );
        sendError(res, 400, "invalid_request", "The request body is invalid.");
        return;
      }

      try {
        const evaluation = await runPreviewIcpEvaluationForAccountFn({
          accountId: paramsParsed.data.accountId,
          profileId: bodyParsed.data.profileId,
        });
        res.status(201).json(evaluation);
      } catch (err) {
        if (err instanceof AccountNotFoundError) {
          sendError(res, 404, "account_not_found", err.message);
          return;
        }
        if (err instanceof ProfileNotFoundError) {
          sendError(res, 404, "profile_not_found", err.message);
          return;
        }
        if (err instanceof NoResolvablePreviewVersionError) {
          sendError(res, 409, "no_resolvable_preview_version", err.message);
          return;
        }
        if (err instanceof MissingRecordError) {
          sendError(res, 404, "record_not_found", err.message);
          return;
        }
        if (err instanceof UnsupportedEvaluatorVersionError) {
          sendError(res, 422, "unsupported_evaluator_version", err.message);
          return;
        }
        req.log?.error(
          { err },
          "POST /internal/accounts/:accountId/icp-evaluations failed",
        );
        sendError(res, 500, "internal_error", "An unexpected error occurred.");
      }
    },
  );

  return router;
}
