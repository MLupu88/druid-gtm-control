// Controlled endpoints for account-level ICP evaluations — starting an
// evaluation for a canonical account against an ICP profile, deriving
// its input entirely from the account's own current state (no signals,
// contact, or CRM data exists yet — see
// ../services/icpEvaluationResolvers.ts). Two distinct POSTs, each
// hardcoding its own evaluationMode — never a shared/generic mode
// parameter, and evaluationMode is never read from req.body/req.params/
// req.query/headers/a default on either:
//   - POST /accounts/:accountId/icp-evaluations — preview. Calls
//     ../services/accountEvaluations.js's runPreviewIcpEvaluationForAccount,
//     which hardcodes "preview" and takes no mode parameter at all.
//   - POST /accounts/:accountId/icp-evaluations/official — the official
//     (production) evaluation. Calls runOfficialIcpEvaluationForAccount,
//     which hardcodes "production" and likewise takes no mode parameter.
//     This is the row ../../druid-gtm/src/pages/account-detail.tsx's
//     findLatestCompletedProductionEvaluation treats as the account's
//     official saved evaluation, and the only kind account_decisions may
//     ever reference. Requires the profile's active PUBLISHED version —
//     resolveProfileVersionForEvaluation's production branch throws
//     NoActiveProfileVersionError otherwise, never falling back to a
//     draft the way preview does.
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
import {
  runPreviewIcpEvaluationForAccount,
  runOfficialIcpEvaluationForAccount,
} from "../services/accountEvaluations.js";
import {
  AccountNotFoundError,
  NoActiveProfileVersionError,
  NoResolvablePreviewVersionError,
} from "../services/icpEvaluationResolvers.js";
import { ProfileNotFoundError } from "../services/icpProfiles.js";
import {
  MissingRecordError,
  ProductionRequiresPublishedProfileError,
} from "@workspace/evaluator-persistence";
import { UnsupportedEvaluatorVersionError } from "@workspace/evaluator";

const AccountIdParamsSchema = z.object({ accountId: z.string().uuid() }).strict();

// profileId only. A body containing evaluationMode (or any other field)
// is rejected by .strict() as an unrecognized field, same as any other
// unrecognized field elsewhere in this codebase — this is what makes
// "evaluationMode can never be smuggled in" an enforced property, not
// just a convention. Reused verbatim by both POST handlers below — both
// accept exactly the same body shape; only the path and hardcoded
// evaluation mode differ.
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

// requireAuth (mounted by the caller — see ./index.ts) guarantees
// req.operator is set, but its email may be blank when OPERATORS is
// unconfigured (see ../lib/operators.ts's DEFAULT_OPERATOR, email: "").
// Mirrors ../routes/accountEvaluations.ts's identical deriveCreatedBy: an
// official evaluation may legitimately be attributed to no one in that
// configuration.
function deriveCreatedBy(req: Request): string | null {
  const email = req.operator?.email;
  return email ? email : null;
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
export type RunOfficialIcpEvaluationForAccountFn = (args: {
  accountId: string;
  profileId: string;
  createdBy: string | null;
}) => ReturnType<typeof runOfficialIcpEvaluationForAccount>;

interface AccountIcpEvaluationsRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  runPreviewIcpEvaluationForAccountFn?: RunPreviewIcpEvaluationForAccountFn;
  runOfficialIcpEvaluationForAccountFn?: RunOfficialIcpEvaluationForAccountFn;
}

interface AccountIcpEvaluationsRouterDepsInjected {
  db?: undefined;
  runPreviewIcpEvaluationForAccountFn: RunPreviewIcpEvaluationForAccountFn;
  runOfficialIcpEvaluationForAccountFn: RunOfficialIcpEvaluationForAccountFn;
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
  let runOfficialIcpEvaluationForAccountFn: RunOfficialIcpEvaluationForAccountFn;
  if (deps.db) {
    const db = deps.db;
    runPreviewIcpEvaluationForAccountFn =
      deps.runPreviewIcpEvaluationForAccountFn ??
      ((args) => runPreviewIcpEvaluationForAccount({ db, ...args }));
    runOfficialIcpEvaluationForAccountFn =
      deps.runOfficialIcpEvaluationForAccountFn ??
      ((args) => runOfficialIcpEvaluationForAccount({ db, ...args }));
  } else {
    runPreviewIcpEvaluationForAccountFn = deps.runPreviewIcpEvaluationForAccountFn;
    runOfficialIcpEvaluationForAccountFn = deps.runOfficialIcpEvaluationForAccountFn;
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

  // POST /accounts/:accountId/icp-evaluations/official — run and persist
  // the account's official (production) ICP evaluation. Always runs a
  // fresh server-side evaluation (fresh snapshot, the profile's current
  // active published version, the canonical evaluator) and persists
  // exactly one new immutable row — it never accepts or echoes back a
  // client-supplied preview result. A failed (but successfully
  // persisted) evaluation still returns 201, matching this file's own
  // preview-endpoint convention above.
  router.post(
    "/accounts/:accountId/icp-evaluations/official",
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
          "POST /internal/accounts/:accountId/icp-evaluations/official: invalid request body",
        );
        sendError(res, 400, "invalid_request", "The request body is invalid.");
        return;
      }

      try {
        const evaluation = await runOfficialIcpEvaluationForAccountFn({
          accountId: paramsParsed.data.accountId,
          profileId: bodyParsed.data.profileId,
          createdBy: deriveCreatedBy(req),
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
        if (err instanceof NoActiveProfileVersionError) {
          sendError(res, 409, "no_active_profile_version", err.message);
          return;
        }
        if (err instanceof MissingRecordError) {
          sendError(res, 404, "record_not_found", err.message);
          return;
        }
        if (err instanceof ProductionRequiresPublishedProfileError) {
          sendError(
            res,
            409,
            "production_requires_published_profile",
            err.message,
          );
          return;
        }
        if (err instanceof UnsupportedEvaluatorVersionError) {
          sendError(res, 422, "unsupported_evaluator_version", err.message);
          return;
        }
        req.log?.error(
          { err },
          "POST /internal/accounts/:accountId/icp-evaluations/official failed",
        );
        sendError(res, 500, "internal_error", "An unexpected error occurred.");
      }
    },
  );

  return router;
}
