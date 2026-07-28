// Controlled server-side endpoints exposing the canonical account
// evaluator (via @workspace/evaluator-persistence) to GTM Mission
// Control. No scoring logic, decisions, routing, actions, or UI live
// here — this route only requests/retrieves already-persisted
// account_evaluations rows.
//
// Mounted at /api/internal/account-evaluations behind the existing
// requireAuth session boundary (see ./index.ts) — the same authenticated
// boundary already guarding /api/n8n and /api/sheets. No new auth
// mechanism is introduced.
//
// POST is NOT idempotent: one accepted request creates exactly one new,
// immutable account_evaluations row. @workspace/evaluator-persistence has
// no idempotency/uniqueness contract for repeated identical requests
// (documented as a KNOWN GAP in that package) — this route adds no
// retries and no deduplication of its own; a caller that wants
// exactly-once semantics across retries must not retry blindly.
//
// Only imports from @workspace/db/schema, never @workspace/db itself —
// the database instance is a required constructor argument
// (AccountEvaluationsRouterDeps.db), so this module has no import-time
// side effects and route tests can inject a fake db/service without a
// real Postgres connection. See ./accountEvaluations.route.test.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  evaluationMode as evaluationModeEnum,
  type AccountEvaluation,
} from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  MissingRecordError,
  ProductionRequiresPublishedProfileError,
} from "@workspace/evaluator-persistence";
import { UnsupportedEvaluatorVersionError } from "@workspace/evaluator";
import {
  createAccountEvaluation,
  getAccountEvaluationById,
  type CreateAccountEvaluationArgs,
  type EvaluateAndPersistFn,
  type GetAccountEvaluationByIdFn,
} from "../services/accountEvaluations";

// evaluationMode's allowed values are read from the live pgEnum rather
// than hand-duplicated here, so this request schema can't silently drift
// from the database's own enum — same discipline as
// @workspace/evaluator-persistence's enumParity.test.ts.
const EVALUATION_MODE_VALUES = evaluationModeEnum.enumValues;

// createdBy is deliberately NOT part of this request schema. It is never
// accepted from the client — it is derived server-side from
// req.operator (see deriveCreatedBy below), exactly like n8n.ts's
// withOperatorStamp() derives approved_by/approved_by_email from the
// verified session rather than trusting a client-supplied approver
// identity (see ../types/express.d.ts: "Never populated from request
// body/query — identity is server-derived"). A POST body containing a
// createdBy field is rejected by .strict() below as an unknown field,
// same as any other unrecognized field.
const CreateAccountEvaluationRequestSchema = z
  .object({
    snapshotId: z.string().uuid(),
    profileVersionId: z.string().uuid(),
    evaluatorVersionId: z.string().uuid(),
    evaluationMode: z.enum(EVALUATION_MODE_VALUES),
  })
  .strict();

const EvaluationIdParamsSchema = z
  .object({ evaluationId: z.string().uuid() })
  .strict();

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

// ---------------------------------------------------------------------
// LIMITATION (see slice report): requireAuth guarantees req.operator is
// set, but its per-individual specificity depends on whether OPERATORS
// is configured (see ../lib/operators.ts).
//   - OPERATORS configured: req.operator.email uniquely, verifiably
//     identifies the signed-in person -> used as createdBy.
//   - OPERATORS NOT configured (single shared APP_PASSWORD fallback):
//     every session resolves to the same DEFAULT_OPERATOR record, whose
//     email is "" — there is no stable individual identity to attribute
//     the evaluation to, so createdBy is persisted as null rather than
//     falling back to a generic, non-distinguishing label.
//   - No req.operator at all (defensive only — requireAuth should always
//     have already rejected the request with 401 in that case): also
//     null.
// ---------------------------------------------------------------------
function deriveCreatedBy(req: Request): string | null {
  const email = req.operator?.email;
  return email ? email : null;
}

export interface AccountEvaluationsRouterDeps {
  db: NodePgDatabase<typeof schema>;
  evaluateAndPersistFn?: EvaluateAndPersistFn;
  getAccountEvaluationByIdFn?: GetAccountEvaluationByIdFn;
}

/**
 * Factory (not a bare router) so callers must supply a db instance
 * explicitly and tests can inject fake service implementations, running
 * these routes with no PostgreSQL connection at all. Production wiring
 * (routes/index.ts) passes the real @workspace/db singleton.
 */
export function createAccountEvaluationsRouter(
  deps: AccountEvaluationsRouterDeps,
): IRouter {
  const router: IRouter = Router();
  const {
    db,
    evaluateAndPersistFn,
    getAccountEvaluationByIdFn = getAccountEvaluationById,
  } = deps;

  // POST / (mounted as POST /api/internal/account-evaluations)
  // Body: { snapshotId, profileVersionId, evaluatorVersionId, evaluationMode }
  // createdBy is never read from the body — see deriveCreatedBy above.
  router.post("/", async (req: Request, res: Response) => {
    const parsed = CreateAccountEvaluationRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log?.info(
        { issues: parsed.error.issues },
        "POST /internal/account-evaluations: invalid request body",
      );
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const args: CreateAccountEvaluationArgs = {
      db,
      snapshotId: parsed.data.snapshotId,
      profileVersionId: parsed.data.profileVersionId,
      evaluatorVersionId: parsed.data.evaluatorVersionId,
      evaluationMode: parsed.data
        .evaluationMode as AccountEvaluation["evaluationMode"],
      createdBy: deriveCreatedBy(req),
    };

    try {
      // Calls the service exactly once — no automatic retries. A
      // truthful status: "failed" evaluation is still a successfully
      // persisted resource, so it falls through to the same 201 branch
      // below as a "completed" evaluation; only conditions where NO row
      // was persisted at all are caught and mapped below.
      const evaluation = await createAccountEvaluation(
        args,
        evaluateAndPersistFn,
      );
      res.status(201).json(evaluation);
    } catch (err) {
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
      req.log?.error({ err }, "POST /internal/account-evaluations failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /:evaluationId
  router.get("/:evaluationId", async (req: Request, res: Response) => {
    const parsed = EvaluationIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(
        res,
        400,
        "invalid_request",
        "evaluationId must be a valid UUID.",
      );
      return;
    }

    try {
      const evaluation = await getAccountEvaluationByIdFn(
        db,
        parsed.data.evaluationId,
      );
      if (!evaluation) {
        sendError(
          res,
          404,
          "evaluation_not_found",
          "No account evaluation exists with that ID.",
        );
        return;
      }
      res.status(200).json(evaluation);
    } catch (err) {
      req.log?.error(
        { err },
        "GET /internal/account-evaluations/:evaluationId failed",
      );
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
