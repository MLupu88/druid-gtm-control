// Controlled read-only endpoints exposing canonical accounts and their
// persisted evaluation history (Package 3.1). No lead/contact/person data,
// no ownership/lifecycle state, no writes, no evaluation/decision logic —
// this route only reads already-persisted accounts/account_evaluations
// rows via ../services/accounts.ts.
//
// Mounted at /api/internal/accounts behind the existing requireAuth
// session boundary (see ./index.ts) — the same authenticated boundary
// already guarding /api/internal/account-evaluations and
// /api/internal/icp-profiles. No new auth mechanism is introduced.
//
// Only imports from @workspace/db/schema, never @workspace/db itself — the
// database instance is a constructor argument (see AccountsRouterDeps
// below), so this module has no import-time side effects and route tests
// can inject fake service implementations without a real Postgres
// connection. See ./accounts.route.test.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  listAccounts,
  getAccountById,
  type AccountListResult,
  type AccountDetail,
} from "../services/accounts.js";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MIN_OFFSET = 0;

// Query params arrive as strings (or are absent) — z.coerce.number()
// converts, then the usual int/min/max checks apply. Absent fields fall
// back to their defaults; anything else invalid (non-numeric, out of
// range, wrong type) is a 400, not a silently-clamped value.
const ListAccountsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(MIN_LIMIT)
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(MIN_OFFSET).default(DEFAULT_OFFSET),
  })
  .strict();

const AccountIdParamsSchema = z
  .object({ accountId: z.string().uuid() })
  .strict();

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

// Router-level service signatures — deliberately narrower than
// typeof listAccounts / typeof getAccountById: no db parameter. A real db
// is bound into the default implementation once, inside
// createAccountsRouter (see below); callers that inject their own
// implementation supply one that needs no db at all, real or fake.
export type ListAccountsFn = (args: {
  limit: number;
  offset: number;
}) => Promise<AccountListResult>;

export type GetAccountByIdFn = (
  accountId: string,
) => Promise<AccountDetail | undefined>;

// Two dependency shapes, chosen so a database is only ever required when
// it would actually be used:
//   - db supplied: the (optional) fn overrides fall back to the real
//     service, bound to that db. This is production wiring (routes/index.ts).
//   - both fns supplied, no db: route tests can run the router with no
//     PostgreSQL connection at all, real or fake. See ./accounts.route.test.ts.
// TypeScript narrows on deps.db below: it is a required, always-truthy
// object in the first shape and always undefined in the second, so no
// cast is needed to recover either variant.
interface AccountsRouterDepsWithDb {
  db: NodePgDatabase<typeof schema>;
  listAccountsFn?: ListAccountsFn;
  getAccountByIdFn?: GetAccountByIdFn;
}

interface AccountsRouterDepsInjected {
  db?: undefined;
  listAccountsFn: ListAccountsFn;
  getAccountByIdFn: GetAccountByIdFn;
}

export type AccountsRouterDeps =
  | AccountsRouterDepsWithDb
  | AccountsRouterDepsInjected;

/**
 * Factory (not a bare router) so callers must supply either a db instance
 * or full service overrides, and tests can inject fake service
 * implementations, running these routes with no PostgreSQL connection at
 * all. Production wiring (routes/index.ts) passes the real @workspace/db
 * singleton.
 */
export function createAccountsRouter(deps: AccountsRouterDeps): IRouter {
  const router: IRouter = Router();

  let listAccountsFn: ListAccountsFn;
  let getAccountByIdFn: GetAccountByIdFn;
  if (deps.db) {
    const db = deps.db;
    listAccountsFn =
      deps.listAccountsFn ?? ((args) => listAccounts({ db, ...args }));
    getAccountByIdFn =
      deps.getAccountByIdFn ?? ((accountId) => getAccountById(db, accountId));
  } else {
    listAccountsFn = deps.listAccountsFn;
    getAccountByIdFn = deps.getAccountByIdFn;
  }

  // GET / — paginated canonical accounts, each with its latest and latest
  // production evaluation summaries (no jsonb payloads, no recomputation).
  router.get("/", async (req: Request, res: Response) => {
    const parsed = ListAccountsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      req.log?.info(
        { issues: parsed.error.issues },
        "GET /internal/accounts: invalid query parameters",
      );
      sendError(
        res,
        400,
        "invalid_request",
        "The query parameters are invalid.",
      );
      return;
    }

    const { limit, offset } = parsed.data;

    try {
      const result = await listAccountsFn({ limit, offset });
      res.status(200).json({
        items: result.items,
        pagination: { limit, offset, total: result.total },
      });
    } catch (err) {
      req.log?.error({ err }, "GET /internal/accounts failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /:accountId — the account and its full, exact evaluation history.
  router.get("/:accountId", async (req: Request, res: Response) => {
    const parsed = AccountIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
      return;
    }

    try {
      const result = await getAccountByIdFn(parsed.data.accountId);
      if (!result) {
        sendError(
          res,
          404,
          "account_not_found",
          "No account exists with that ID.",
        );
        return;
      }
      res.status(200).json(result);
    } catch (err) {
      req.log?.error({ err }, "GET /internal/accounts/:accountId failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
