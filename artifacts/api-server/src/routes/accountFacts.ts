// Controlled endpoints for manual account facts (Unit 2 Slice 1) — an
// operator confirming (or correcting) one of the five supported company
// attributes for a canonical account. No automated enrichment, no
// external providers (RB2B/Dealfront/HubSpot/Cognism) — every row this
// route can ever produce represents exactly one explicit human
// assertion, recorded truthfully via ../services/accountFacts.ts.
//
// Mounted at /internal behind the existing requireAuth session boundary
// (see ./index.ts) — the same authenticated boundary already guarding
// every other /api/internal/* router. This file assumes that boundary;
// it does not add or change any authentication middleware itself.
//
// Only imports from ../services/accountFacts.js (plus the error classes
// it composes), never @workspace/db itself — the database instance is a
// constructor argument (see AccountFactsRouterDeps below), so this
// module has no import-time side effects and route tests can inject
// fake service implementations without a real Postgres connection.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { ACCOUNT_FACT_FIELDS, type AccountFact } from "@workspace/db/schema";
import {
  recordAccountFact,
  listAccountFacts,
  CorrectionReasonRequiredError,
  CorrectionReasonNotAllowedError,
  InvalidAccountFactValueError,
  StaleFactCorrectionError,
  type RecordAccountFactArgs,
  type ListAccountFactsResult,
} from "../services/accountFacts.js";
import { AccountNotFoundError } from "../services/icpEvaluationResolvers.js";

const AccountIdParamsSchema = z.object({ accountId: z.string().uuid() }).strict();

// expectedCurrentFactId/correctionReason are both optional at the
// request-validation layer (a first-time confirmation supplies neither);
// ../services/accountFacts.ts is the single place that enforces the
// iff-and-only-if relationship between them (mirrored again by the
// database CHECK — see @workspace/db/schema/accountFacts.ts). recordedBy
// is deliberately NOT part of this schema — it is never accepted from
// the client, always derived server-side from req.operator (see
// deriveRecordedBy below); a body containing recordedBy is rejected by
// .strict() as an unrecognized field.
const RecordAccountFactRequestSchema = z
  .object({
    field: z.enum(ACCOUNT_FACT_FIELDS),
    value: z.string(),
    expectedCurrentFactId: z.string().uuid().nullable().optional(),
    correctionReason: z.string().nullable().optional(),
  })
  .strict();

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

function serializeFact(fact: AccountFact) {
  return {
    id: fact.id,
    field: fact.field,
    value: fact.value,
    recordedBy: fact.recordedBy,
    observedAt: fact.observedAt,
    recordedAt: fact.recordedAt,
    correctionReason: fact.correctionReason,
    supersedesFactId: fact.supersedesFactId,
  };
}

// requireAuth (mounted by the caller — see ./index.ts) guarantees
// req.operator is set, but its email may be blank when OPERATORS is
// unconfigured (see ../lib/operators.ts's DEFAULT_OPERATOR, email: "").
// Like ../routes/accountDecisions.ts's deriveCreatedBy (and unlike
// ../routes/accountEvaluations.ts's/../routes/accountIcpEvaluations.ts's,
// which tolerate a null actor), a manual fact must always be
// attributable to a real person — account_facts.recorded_by is NOT NULL
// — so a blank identity here is rejected outright (403
// operator_identity_required) rather than ever being persisted.
function deriveRecordedBy(req: Request): string | null {
  const email = req.operator?.email?.trim();
  return email ? email : null;
}

export type RecordAccountFactFn = (
  args: Omit<RecordAccountFactArgs, "db">,
) => ReturnType<typeof recordAccountFact>;

export type ListAccountFactsFn = (
  accountId: string,
) => Promise<ListAccountFactsResult>;

interface AccountFactsRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  recordAccountFactFn?: RecordAccountFactFn;
  listAccountFactsFn?: ListAccountFactsFn;
}

interface AccountFactsRouterDepsInjected {
  db?: undefined;
  recordAccountFactFn: RecordAccountFactFn;
  listAccountFactsFn: ListAccountFactsFn;
}

export type AccountFactsRouterDeps =
  | AccountFactsRouterDepsWithDb
  | AccountFactsRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or full service overrides, and tests can inject fake service
 * implementations, running these routes with no PostgreSQL connection at
 * all. Production wiring (routes/index.ts) passes the real @workspace/db
 * singleton. Assumes it is mounted behind requireAuth — no auth
 * middleware is added here. Declares relative paths only
 * ("/accounts/:accountId/facts"); the caller mounts this router at
 * /internal, mirroring ../routes/accountIcpEvaluations.ts.
 */
export function createAccountFactsRouter(deps: AccountFactsRouterDeps): IRouter {
  const router: IRouter = Router();

  let recordAccountFactFn: RecordAccountFactFn;
  let listAccountFactsFn: ListAccountFactsFn;
  if (deps.db) {
    const db = deps.db;
    recordAccountFactFn =
      deps.recordAccountFactFn ?? ((args) => recordAccountFact({ db, ...args }));
    listAccountFactsFn =
      deps.listAccountFactsFn ?? ((accountId) => listAccountFacts(db, accountId));
  } else {
    recordAccountFactFn = deps.recordAccountFactFn;
    listAccountFactsFn = deps.listAccountFactsFn;
  }

  // GET /accounts/:accountId/facts — current value (if any) per Slice 1
  // field, plus the full history of superseded assertions.
  router.get(
    "/accounts/:accountId/facts",
    async (req: Request, res: Response) => {
      const paramsParsed = AccountIdParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
        return;
      }

      try {
        const result = await listAccountFactsFn(paramsParsed.data.accountId);
        res.status(200).json({
          current: result.current.map(serializeFact),
          history: result.history.map(serializeFact),
        });
      } catch (err) {
        if (err instanceof AccountNotFoundError) {
          sendError(res, 404, "account_not_found", err.message);
          return;
        }
        req.log?.error(
          { err },
          "GET /internal/accounts/:accountId/facts failed",
        );
        sendError(res, 500, "internal_error", "An unexpected error occurred.");
      }
    },
  );

  // POST /accounts/:accountId/facts — confirm (expectedCurrentFactId
  // omitted/null) or correct (expectedCurrentFactId set, correctionReason
  // required) one field.
  router.post(
    "/accounts/:accountId/facts",
    async (req: Request, res: Response) => {
      const paramsParsed = AccountIdParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
        return;
      }

      const bodyParsed = RecordAccountFactRequestSchema.safeParse(req.body);
      if (!bodyParsed.success) {
        req.log?.info(
          { issues: bodyParsed.error.issues },
          "POST /internal/accounts/:accountId/facts: invalid request body",
        );
        sendError(res, 400, "invalid_request", "The request body is invalid.");
        return;
      }

      const recordedBy = deriveRecordedBy(req);
      if (!recordedBy) {
        sendError(
          res,
          403,
          "operator_identity_required",
          "A verified operator identity is required to record a manual account fact.",
        );
        return;
      }

      try {
        const fact = await recordAccountFactFn({
          accountId: paramsParsed.data.accountId,
          field: bodyParsed.data.field,
          value: bodyParsed.data.value,
          recordedBy,
          expectedCurrentFactId: bodyParsed.data.expectedCurrentFactId ?? null,
          correctionReason: bodyParsed.data.correctionReason ?? null,
        });
        res.status(201).json(serializeFact(fact));
      } catch (err) {
        if (err instanceof AccountNotFoundError) {
          sendError(res, 404, "account_not_found", err.message);
          return;
        }
        if (
          err instanceof CorrectionReasonRequiredError ||
          err instanceof CorrectionReasonNotAllowedError ||
          err instanceof InvalidAccountFactValueError
        ) {
          sendError(res, 400, "invalid_request", err.message);
          return;
        }
        if (err instanceof StaleFactCorrectionError) {
          sendError(res, 409, "stale_fact_correction", err.message);
          return;
        }
        req.log?.error(
          { err },
          "POST /internal/accounts/:accountId/facts failed",
        );
        sendError(res, 500, "internal_error", "An unexpected error occurred.");
      }
    },
  );

  return router;
}
