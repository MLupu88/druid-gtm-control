// Controlled endpoints for canonical account decisions — the persisted
// record of an explicit human routing/business decision (e.g. "Promote
// to MQL", "Keep for review / Sales Review"). No automated routing or
// scoring policy engine, no outbound dispatch, no HubSpot/n8n/email/
// voice/Client Radar calls — this route only records and reads already-
// made human decisions via ../services/accountDecisions.ts.
//
// Mounted at /api/internal/account-decisions behind the existing
// requireAuth session boundary (see ./index.ts) — the same authenticated
// boundary already guarding /api/internal/accounts,
// /api/internal/account-evaluations, and /api/internal/icp-profiles. This
// file assumes that boundary; it does not add or change any
// authentication middleware itself.
//
// Only imports from ../services/accountDecisions.js, never @workspace/db
// itself — the database instance is a constructor argument (see
// AccountDecisionsRouterDeps below), so this module has no import-time
// side effects and route tests can inject fake service implementations
// without a real Postgres connection. See ./accountDecisions.route.test.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  createAccountDecision,
  listAccountDecisions,
  getAccountDecisionById,
  AccountEvaluationNotFoundError,
  AccountEvaluationNotEligibleError,
  IdempotencyKeyConflictError,
  type CreateAccountDecisionResult,
  type AccountDecisionWithAccountId,
  type AccountDecisionListResult,
  type RoutingOutput,
} from "../services/accountDecisions.js";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MIN_OFFSET = 0;

// Plain-integer string only: optional leading "-", one or more digits,
// nothing else — no decimals, no whitespace, no leading/trailing
// characters, no hex ("0x32") or scientific ("1e2") notation, all of
// which JS's own Number()/z.coerce.number() would silently accept.
const INTEGER_QUERY_PARAM_PATTERN = /^-?\d+$/;

// Strict query-string integer parsing, deliberately not z.coerce.number():
// coercion accepts "" and whitespace-only strings as 0 (Number("") === 0),
// silently treating an explicitly-supplied-but-empty value the same as a
// valid number. Here, the default is substituted only when the key is
// entirely absent (value === undefined) — an explicitly supplied empty
// string is routed through the same strict string validation as any
// other value and rejected. Scoped to this route only; the existing
// accounts.ts query schema is intentionally left unchanged.
function strictIntegerQueryParam(
  min: number,
  max: number,
  defaultValue: number,
) {
  return z.preprocess(
    (value) => (value === undefined ? String(defaultValue) : value),
    z
      .string()
      .regex(INTEGER_QUERY_PARAM_PATTERN)
      .transform((value) => Number(value))
      .refine((value) => value >= min && value <= max),
  );
}

const ListAccountDecisionsQuerySchema = z
  .object({
    limit: strictIntegerQueryParam(MIN_LIMIT, MAX_LIMIT, DEFAULT_LIMIT),
    offset: strictIntegerQueryParam(
      MIN_OFFSET,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_OFFSET,
    ),
    accountId: z.string().uuid().optional(),
  })
  .strict();

const DecisionIdParamsSchema = z
  .object({ decisionId: z.string().uuid() })
  .strict();

// createdBy is deliberately NOT part of this schema — it is never
// accepted from the client, always derived server-side from
// req.operator (see deriveCreatedBy below). A body containing a
// createdBy field is rejected by .strict() as an unknown field, same as
// any other unrecognized field.
const CreateAccountDecisionRequestSchema = z
  .object({
    accountEvaluationId: z.string().uuid(),
    routingOutput: z.enum(["mql", "sales_review", "dismissed"]),
    routingReason: z.string().nullable().optional(),
  })
  .strict();

// Client-supplied UUID, used verbatim as account_decisions.id — the
// idempotency mechanism itself (see ../services/accountDecisions.ts's
// createAccountDecision). Missing or malformed is a 400, never silently
// generated server-side.
const IdempotencyKeyHeaderSchema = z.string().uuid();

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

// ---------------------------------------------------------------------
// requireAuth (mounted by the caller — see ./index.ts) guarantees
// req.operator is set, but its email may be blank when OPERATORS is
// unconfigured (see ../lib/operators.ts's DEFAULT_OPERATOR, email: "").
// Unlike ../routes/accountEvaluations.ts's / ../routes/icpProfiles.ts's
// deriveCreatedBy (which fall back to createdBy: null for exactly that
// reason), a manual decision must always be attributable to a real
// person — a blank identity here is rejected outright by the POST
// handler (403 operator_identity_required) rather than ever being
// persisted as createdBy: null.
// ---------------------------------------------------------------------
function deriveCreatedBy(req: Request): string | null {
  const email = req.operator?.email?.trim();
  return email ? email : null;
}

// Router-level service signatures — deliberately narrower than the real
// service functions: no db parameter. A real db is bound into the
// default implementation once, inside createAccountDecisionsRouter (see
// below); callers that inject their own implementation supply one that
// needs no db at all, real or fake.
export type CreateAccountDecisionFn = (args: {
  idempotencyKey: string;
  accountEvaluationId: string;
  routingOutput: RoutingOutput;
  routingReason?: string | null;
  createdBy: string;
}) => Promise<CreateAccountDecisionResult>;

export type ListAccountDecisionsFn = (args: {
  limit: number;
  offset: number;
  accountId?: string;
}) => Promise<AccountDecisionListResult>;

export type GetAccountDecisionByIdFn = (
  decisionId: string,
) => Promise<AccountDecisionWithAccountId | undefined>;

// Two dependency shapes, chosen so a database is only ever required when
// it would actually be used:
//   - db supplied: the (optional) fn overrides fall back to the real
//     service, bound to that db. This is production wiring (routes/index.ts).
//   - all three fns supplied, no db: route tests can run the router with
//     no PostgreSQL connection at all, real or fake. See
//     ./accountDecisions.route.test.ts.
// TypeScript narrows on deps.db below: it is a required, always-truthy
// object in the first shape and always undefined in the second, so no
// cast is needed to recover either variant — same pattern as
// ../routes/accounts.ts's AccountsRouterDeps.
interface AccountDecisionsRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  createAccountDecisionFn?: CreateAccountDecisionFn;
  listAccountDecisionsFn?: ListAccountDecisionsFn;
  getAccountDecisionByIdFn?: GetAccountDecisionByIdFn;
}

interface AccountDecisionsRouterDepsInjected {
  db?: undefined;
  createAccountDecisionFn: CreateAccountDecisionFn;
  listAccountDecisionsFn: ListAccountDecisionsFn;
  getAccountDecisionByIdFn: GetAccountDecisionByIdFn;
}

export type AccountDecisionsRouterDeps =
  | AccountDecisionsRouterDepsWithDb
  | AccountDecisionsRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or full service overrides, and tests can inject fake service
 * implementations, running these routes with no PostgreSQL connection at
 * all. Production wiring (routes/index.ts) passes the real @workspace/db
 * singleton. Assumes it is mounted behind requireAuth — no auth
 * middleware is added here.
 */
export function createAccountDecisionsRouter(
  deps: AccountDecisionsRouterDeps,
): IRouter {
  const router: IRouter = Router();

  let createAccountDecisionFn: CreateAccountDecisionFn;
  let listAccountDecisionsFn: ListAccountDecisionsFn;
  let getAccountDecisionByIdFn: GetAccountDecisionByIdFn;
  if (deps.db) {
    const db = deps.db;
    createAccountDecisionFn =
      deps.createAccountDecisionFn ??
      ((args) => createAccountDecision({ db, ...args }));
    listAccountDecisionsFn =
      deps.listAccountDecisionsFn ??
      ((args) => listAccountDecisions({ db, ...args }));
    getAccountDecisionByIdFn =
      deps.getAccountDecisionByIdFn ??
      ((decisionId) => getAccountDecisionById(db, decisionId));
  } else {
    createAccountDecisionFn = deps.createAccountDecisionFn;
    listAccountDecisionsFn = deps.listAccountDecisionsFn;
    getAccountDecisionByIdFn = deps.getAccountDecisionByIdFn;
  }

  // POST / — record one explicit human decision. Idempotent on the
  // client-supplied Idempotency-Key header (used as the row's id) — a
  // replay of the same key + the same effective request returns the
  // already-persisted row (200) instead of creating a second one (201).
  router.post("/", async (req: Request, res: Response) => {
    const idempotencyKeyParsed = IdempotencyKeyHeaderSchema.safeParse(
      req.get("Idempotency-Key"),
    );
    if (!idempotencyKeyParsed.success) {
      sendError(
        res,
        400,
        "invalid_request",
        "A valid Idempotency-Key header (UUID) is required.",
      );
      return;
    }

    const bodyParsed = CreateAccountDecisionRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      req.log?.info(
        { issues: bodyParsed.error.issues },
        "POST /internal/account-decisions: invalid request body",
      );
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const createdBy = deriveCreatedBy(req);
    if (!createdBy) {
      sendError(
        res,
        403,
        "operator_identity_required",
        "A verified operator identity is required to record a manual decision.",
      );
      return;
    }

    try {
      const result = await createAccountDecisionFn({
        idempotencyKey: idempotencyKeyParsed.data,
        accountEvaluationId: bodyParsed.data.accountEvaluationId,
        routingOutput: bodyParsed.data.routingOutput,
        routingReason: bodyParsed.data.routingReason,
        createdBy,
      });
      res.status(result.created ? 201 : 200).json({
        decision: result.decision,
        accountId: result.accountId,
      });
    } catch (err) {
      if (err instanceof AccountEvaluationNotFoundError) {
        sendError(res, 404, "record_not_found", err.message);
        return;
      }
      if (err instanceof AccountEvaluationNotEligibleError) {
        sendError(res, 409, "evaluation_not_eligible", err.message);
        return;
      }
      if (err instanceof IdempotencyKeyConflictError) {
        sendError(res, 409, "idempotency_conflict", err.message);
        return;
      }
      req.log?.error({ err }, "POST /internal/account-decisions failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET / — paginated account decisions, optionally filtered to one
  // account via a SQL-level join filter (see listAccountDecisions).
  router.get("/", async (req: Request, res: Response) => {
    const parsed = ListAccountDecisionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      req.log?.info(
        { issues: parsed.error.issues },
        "GET /internal/account-decisions: invalid query parameters",
      );
      sendError(
        res,
        400,
        "invalid_request",
        "The query parameters are invalid.",
      );
      return;
    }

    const { limit, offset, accountId } = parsed.data;

    try {
      const result = accountId
        ? await listAccountDecisionsFn({ limit, offset, accountId })
        : await listAccountDecisionsFn({ limit, offset });
      res.status(200).json({
        items: result.items,
        pagination: { limit, offset, total: result.total },
      });
    } catch (err) {
      req.log?.error({ err }, "GET /internal/account-decisions failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /:decisionId — one persisted decision and the accountId of the
  // evaluation it references.
  router.get("/:decisionId", async (req: Request, res: Response) => {
    const parsed = DecisionIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(
        res,
        400,
        "invalid_request",
        "decisionId must be a valid UUID.",
      );
      return;
    }

    try {
      const result = await getAccountDecisionByIdFn(parsed.data.decisionId);
      if (!result) {
        sendError(
          res,
          404,
          "decision_not_found",
          "No account decision exists with that ID.",
        );
        return;
      }
      res
        .status(200)
        .json({ decision: result.decision, accountId: result.accountId });
    } catch (err) {
      req.log?.error(
        { err },
        "GET /internal/account-decisions/:decisionId failed",
      );
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
