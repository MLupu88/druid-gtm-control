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
  type AccountListSortKey,
} from "../services/accounts.js";
import {
  getAccountCanonicalTruth,
  AccountNotFoundError as AccountTruthNotFoundError,
  type AccountTruthFieldDTO,
} from "../services/accountTruth.js";
import {
  getAccountRecentActivity,
  AccountNotFoundError as AccountActivityNotFoundError,
  type AccountActivityItemDTO,
} from "../services/accountActivity.js";
import {
  getAccountPeople,
  AccountNotFoundError as AccountPeopleNotFoundError,
  type AccountPersonDTO,
} from "../services/people.js";
import {
  getAccountClaims,
  AccountNotFoundError as AccountClaimsNotFoundError,
  type AccountClaimDTO,
} from "../services/accountClaims.js";
import {
  getAccountBrainSummary,
  analyzeAccountBrain,
  AccountNotFoundError as AccountBrainNotFoundError,
  type AccountBrainSummary,
} from "../services/accountBrainSummary.js";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
// Still a per-PAGE cap, not a population cap — the fix for "Accounts is
// capped at 100" is real server-side pagination + search (see
// ../services/accounts.ts), never raising this number. A caller that
// wants "the 242nd account" asks for offset=200&limit=50 (or searches for
// it directly), never limit=1000.
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MIN_OFFSET = 0;
const MAX_SEARCH_LENGTH = 200;

// Query params arrive as strings (or are absent) — z.coerce.number()
// converts, then the usual int/min/max checks apply. Absent fields fall
// back to their defaults; anything else invalid (non-numeric, out of
// range, wrong type) is a 400, not a silently-clamped value.
//
// needsAttention deliberately uses z.enum(["true", "false"]), never
// z.coerce.boolean() — coerce.boolean() runs JS's Boolean(string), which
// is true for ANY non-empty string, including the literal text "false".
// The enum form makes exactly two spellings legal and rejects everything
// else (1, yes, TRUE, "") with the same 400 the numeric params get.
const ListAccountsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(MIN_LIMIT)
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(MIN_OFFSET).default(DEFAULT_OFFSET),
    needsAttention: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Optional free-text search against company name/domain — see
    // ../services/accounts.ts's listAccounts. Trimmed to "" (treated as
    // absent) rather than rejected, so a caller that clears a search box
    // doesn't need to omit the param entirely.
    search: z.coerce.string().trim().max(MAX_SEARCH_LENGTH).optional(),
    sort: z.enum(["updated", "name"]).default("updated"),
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
  needsAttention: boolean;
  search?: string;
  sort?: AccountListSortKey;
}) => Promise<AccountListResult>;

export type GetAccountByIdFn = (
  accountId: string,
) => Promise<AccountDetail | undefined>;

// Milestone 3H — throws AccountNotFoundError for an unknown account
// (mirrors ../services/icpEvaluationResolvers.ts's identical convention)
// rather than returning undefined; the route below maps that to the same
// 404 shape GET /:accountId already uses.
export type GetAccountTruthFn = (
  accountId: string,
) => Promise<AccountTruthFieldDTO[]>;

// M3.5 — mirrors GetAccountTruthFn's own AccountNotFoundError convention.
export type GetAccountActivityFn = (
  accountId: string,
) => Promise<AccountActivityItemDTO[]>;

// LS8 — mirrors GetAccountTruthFn's own AccountNotFoundError convention.
export type GetAccountPeopleFn = (
  accountId: string,
) => Promise<AccountPersonDTO[]>;

// Milestone 4A — mirrors GetAccountTruthFn's own AccountNotFoundError convention.
export type GetAccountClaimsFn = (
  accountId: string,
) => Promise<AccountClaimDTO[]>;

// Milestone 4B — mirrors GetAccountTruthFn's own AccountNotFoundError
// convention. Two distinct fns (not one with an "analyze" flag) so route
// tests can inject different behavior for the cheap GET and the
// explicit, LLM-calling POST independently.
export type GetAccountBrainFn = (accountId: string) => Promise<AccountBrainSummary>;
export type AnalyzeAccountBrainFn = (accountId: string) => Promise<AccountBrainSummary>;

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
  getAccountTruthFn?: GetAccountTruthFn;
  getAccountActivityFn?: GetAccountActivityFn;
  getAccountPeopleFn?: GetAccountPeopleFn;
  getAccountClaimsFn?: GetAccountClaimsFn;
  getAccountBrainFn?: GetAccountBrainFn;
  analyzeAccountBrainFn?: AnalyzeAccountBrainFn;
}

interface AccountsRouterDepsInjected {
  db?: undefined;
  listAccountsFn: ListAccountsFn;
  getAccountByIdFn: GetAccountByIdFn;
  getAccountTruthFn: GetAccountTruthFn;
  getAccountActivityFn: GetAccountActivityFn;
  getAccountPeopleFn: GetAccountPeopleFn;
  getAccountClaimsFn: GetAccountClaimsFn;
  getAccountBrainFn: GetAccountBrainFn;
  analyzeAccountBrainFn: AnalyzeAccountBrainFn;
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
  let getAccountTruthFn: GetAccountTruthFn;
  let getAccountActivityFn: GetAccountActivityFn;
  let getAccountPeopleFn: GetAccountPeopleFn;
  let getAccountClaimsFn: GetAccountClaimsFn;
  let getAccountBrainFn: GetAccountBrainFn;
  let analyzeAccountBrainFn: AnalyzeAccountBrainFn;
  if (deps.db) {
    const db = deps.db;
    listAccountsFn =
      deps.listAccountsFn ?? ((args) => listAccounts({ db, ...args }));
    getAccountByIdFn =
      deps.getAccountByIdFn ?? ((accountId) => getAccountById(db, accountId));
    getAccountTruthFn =
      deps.getAccountTruthFn ?? ((accountId) => getAccountCanonicalTruth(db, accountId));
    getAccountActivityFn =
      deps.getAccountActivityFn ?? ((accountId) => getAccountRecentActivity(db, accountId));
    getAccountPeopleFn =
      deps.getAccountPeopleFn ?? ((accountId) => getAccountPeople(db, accountId));
    getAccountClaimsFn =
      deps.getAccountClaimsFn ?? ((accountId) => getAccountClaims(db, accountId));
    getAccountBrainFn =
      deps.getAccountBrainFn ?? ((accountId) => getAccountBrainSummary(db, accountId));
    analyzeAccountBrainFn =
      deps.analyzeAccountBrainFn ?? ((accountId) => analyzeAccountBrain(db, accountId));
  } else {
    listAccountsFn = deps.listAccountsFn;
    getAccountByIdFn = deps.getAccountByIdFn;
    getAccountTruthFn = deps.getAccountTruthFn;
    getAccountActivityFn = deps.getAccountActivityFn;
    getAccountPeopleFn = deps.getAccountPeopleFn;
    getAccountClaimsFn = deps.getAccountClaimsFn;
    getAccountBrainFn = deps.getAccountBrainFn;
    analyzeAccountBrainFn = deps.analyzeAccountBrainFn;
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

    const { limit, offset, needsAttention, search, sort } = parsed.data;

    try {
      const result = await listAccountsFn({ limit, offset, needsAttention, search, sort });
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

  // GET /:accountId/truth — Milestone 3H. Current canonical truth for
  // every field Milestone 3F can resolve (all 11 RESOLVED_FACT_CANONICAL_FIELDS,
  // including crm.lifecycleStage — this is not an evaluator-input view),
  // freshly computed (never a stale resolved_facts read, never written by
  // this GET) with resolved, display-ready provenance. See
  // ../services/accountTruth.ts.
  router.get("/:accountId/truth", async (req: Request, res: Response) => {
    const parsed = AccountIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
      return;
    }

    try {
      const fields = await getAccountTruthFn(parsed.data.accountId);
      res.status(200).json({ fields });
    } catch (err) {
      if (err instanceof AccountTruthNotFoundError) {
        sendError(res, 404, "account_not_found", "No account exists with that ID.");
        return;
      }
      req.log?.error({ err }, "GET /internal/accounts/:accountId/truth failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /:accountId/activity — M3.5. Minimum truthful Account Workspace
  // Activity visibility: every behavioral_signal observation bound to
  // this account, newest first. Not the final ZoomInfo-style Activity
  // UX — see ../services/accountActivity.ts.
  router.get("/:accountId/activity", async (req: Request, res: Response) => {
    const parsed = AccountIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
      return;
    }

    try {
      const items = await getAccountActivityFn(parsed.data.accountId);
      res.status(200).json({ items });
    } catch (err) {
      if (err instanceof AccountActivityNotFoundError) {
        sendError(res, 404, "account_not_found", "No account exists with that ID.");
        return;
      }
      req.log?.error({ err }, "GET /internal/accounts/:accountId/activity failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /:accountId/people — LS8. Canonical people associated with this
  // account (people/account_people rows only — never observation JSON
  // parsed directly). See ../services/people.ts.
  router.get("/:accountId/people", async (req: Request, res: Response) => {
    const parsed = AccountIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
      return;
    }

    try {
      const items = await getAccountPeopleFn(parsed.data.accountId);
      res.status(200).json({ items });
    } catch (err) {
      if (err instanceof AccountPeopleNotFoundError) {
        sendError(res, 404, "account_not_found", "No account exists with that ID.");
        return;
      }
      req.log?.error({ err }, "GET /internal/accounts/:accountId/people failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /:accountId/claims — Milestone 4A. Every Account Brain claim ever
  // recorded for this account (including superseded/contradicting rows),
  // with resolved evidence. Read-only — 4A has no write HTTP route;
  // recordClaim() is called directly by service-layer callers only. See
  // ../services/accountClaims.ts.
  router.get("/:accountId/claims", async (req: Request, res: Response) => {
    const parsed = AccountIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
      return;
    }

    try {
      const items = await getAccountClaimsFn(parsed.data.accountId);
      res.status(200).json({ items });
    } catch (err) {
      if (err instanceof AccountClaimsNotFoundError) {
        sendError(res, 404, "account_not_found", "No account exists with that ID.");
        return;
      }
      req.log?.error({ err }, "GET /internal/accounts/:accountId/claims failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /:accountId/brain — Milestone 4B. The Grounded Account Brain read
  // model: canonical Account Truth + People + a computed factual activity
  // summary + existing genuine account_claims. No LLM call, no writes —
  // safe to call on every Intelligence-tab load. narrative is always null
  // here; see POST /:accountId/brain/analyze for the explicit,
  // LLM-generated synthesis. See ../services/accountBrainSummary.ts.
  router.get("/:accountId/brain", async (req: Request, res: Response) => {
    const parsed = AccountIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
      return;
    }

    try {
      const summary = await getAccountBrainFn(parsed.data.accountId);
      res.status(200).json(summary);
    } catch (err) {
      if (err instanceof AccountBrainNotFoundError) {
        sendError(res, 404, "account_not_found", "No account exists with that ID.");
        return;
      }
      req.log?.error({ err }, "GET /internal/accounts/:accountId/brain failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // POST /:accountId/brain/analyze — Milestone 4B. The explicit,
  // user-triggered "Analyze this account" action: same read model as GET
  // /brain, plus an attempted grounded narrative (one DeepSeek call).
  // Never called automatically — only ever in response to a deliberate
  // click, so a tab load never silently spends a paid model call. Writes
  // nothing: the 4B claim registry is empty and the narrative itself is
  // never persisted — generatedAt describes only the analysis this
  // response returns, never a durable "last analyzed" state. A narrative
  // failure never fails the whole request; narrativeUnavailableReason
  // explains why when narrative is null. See
  // ../services/accountBrainSummary.ts.
  router.post("/:accountId/brain/analyze", async (req: Request, res: Response) => {
    const parsed = AccountIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "accountId must be a valid UUID.");
      return;
    }

    try {
      const summary = await analyzeAccountBrainFn(parsed.data.accountId);
      res.status(200).json(summary);
    } catch (err) {
      if (err instanceof AccountBrainNotFoundError) {
        sendError(res, 404, "account_not_found", "No account exists with that ID.");
        return;
      }
      req.log?.error({ err }, "POST /internal/accounts/:accountId/brain/analyze failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}
