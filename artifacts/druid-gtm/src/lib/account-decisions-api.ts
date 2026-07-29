// Hand-written types + fetch functions for the canonical account
// decisions API (GET/POST /api/internal/account-decisions). Shapes here
// are verified directly against
// artifacts/api-server/src/routes/accountDecisions.ts,
// artifacts/api-server/src/services/accountDecisions.ts, and
// lib/db/src/schema/accountDecisions.ts — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./accounts-api.ts. React Query itself stays in the components; this
// module only exports plain fetch functions and stable query-key
// helpers.

// The full routingOutput enum a persisted row can carry (see
// lib/db/src/schema/enums.ts) — history may in principle contain values
// beyond the two this UI can create, so reads are typed against the full
// enum. CreatableRoutingOutput below is the (currently identical, but
// intentionally separate) subset this UI's POST is allowed to send —
// mirrors the backend's own RoutingOutput = Extract<...> split in
// services/accountDecisions.ts.
export type RoutingOutput =
  | "mql"
  | "sales_review"
  | "pipeline_assist"
  | "owner_alert"
  | "retarget"
  | "nurture"
  | "suppressed";

export type CreatableRoutingOutput = "mql" | "sales_review";

export type OverallDecisionGate = "actionable" | "restricted" | "blocked";

export interface AccountDecision {
  id: string;
  accountEvaluationId: string;
  decisionPolicyVersionId: string;
  operationalContextSnapshot: unknown;
  routingOutput: RoutingOutput;
  routingReason: string | null;
  channelAvailability: unknown;
  overallDecisionGate: OverallDecisionGate;
  blockers: unknown;
  createdAt: string;
  createdBy: string | null;
}

export interface AccountDecisionWithAccountId {
  decision: AccountDecision;
  accountId: string;
}

export interface AccountDecisionsListResponse {
  items: AccountDecisionWithAccountId[];
  pagination: { limit: number; offset: number; total: number };
}

export interface CreateAccountDecisionResponse {
  decision: AccountDecision;
  accountId: string;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

// Carries the backend's own `code` (see sendError() in
// routes/accountDecisions.ts: every error body is `{ error, code }`) so
// callers can render specific copy per code instead of just the generic
// message.
export class AccountDecisionsApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AccountDecisionsApiError";
  }
}

async function throwForResponse(
  res: Response,
  fallback: string,
): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new AccountDecisionsApiError(body.error ?? fallback, body.code);
}

export async function fetchAccountDecisions(args: {
  accountId: string;
  limit?: number;
  offset?: number;
}): Promise<AccountDecisionsListResponse> {
  const params = new URLSearchParams({
    accountId: args.accountId,
    limit: String(args.limit ?? DEFAULT_LIMIT),
    offset: String(args.offset ?? DEFAULT_OFFSET),
  });
  const res = await fetch(
    `/api/internal/account-decisions?${params.toString()}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not load decision history.");
  }
  return res.json() as Promise<AccountDecisionsListResponse>;
}

export interface CreateAccountDecisionArgs {
  idempotencyKey: string;
  accountEvaluationId: string;
  routingOutput: CreatableRoutingOutput;
  /**
   * Always explicit — never omitted — so "no reason supplied" is sent
   * identically (`null`) on every request, matching the backend's
   * `.nullable().optional()` schema (which treats an omitted key and an
   * explicit null the same way, but only one of those is under this
   * module's control at the call site).
   */
  routingReason: string | null;
}

export async function createAccountDecision(
  args: CreateAccountDecisionArgs,
): Promise<CreateAccountDecisionResponse> {
  const res = await fetch("/api/internal/account-decisions", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey,
    },
    body: JSON.stringify({
      accountEvaluationId: args.accountEvaluationId,
      routingOutput: args.routingOutput,
      routingReason: args.routingReason,
    }),
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not record this decision.");
  }
  return res.json() as Promise<CreateAccountDecisionResponse>;
}

// Stable query-key helper for account-scoped decision history — same
// intent as ./accounts-api.ts's accountsListQueryKey/
// accountDetailQueryKey. This slice never paginates decision history (a
// fixed first page, same convention as the accounts list), so every
// caller uses the same default limit/offset and a call with no args is
// also the correct invalidation-target prefix.
export function accountDecisionsQueryKey(
  accountId: string,
  args: { limit?: number; offset?: number } = {},
) {
  return [
    "account-decisions",
    accountId,
    args.limit ?? DEFAULT_LIMIT,
    args.offset ?? DEFAULT_OFFSET,
  ] as const;
}
