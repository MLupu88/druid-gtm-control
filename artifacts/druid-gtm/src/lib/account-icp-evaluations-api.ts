// Hand-written types + fetch function for the account-level ICP preview
// endpoint (POST /api/internal/accounts/:accountId/icp-evaluations).
// Shapes here are verified directly against
// artifacts/api-server/src/routes/accountIcpEvaluations.ts (returns the
// raw persisted account_evaluations row, 201, for both a "completed" and
// a truthfully persisted "failed" outcome — neither is an HTTP error) —
// not guessed.
//
// AccountEvaluation is imported, not redeclared: the backend returns the
// exact same row shape @/lib/accounts-api already types field-for-field
// (including its documented numeric-as-string convention for
// fitScore/intentScore/actionabilityScore).
//
// This endpoint is preview-only. The request body is built as a literal
// `{ profileId }` object — there is no request-args type here that could
// ever carry an evaluationMode field, nothing is spread into the body,
// and no caller input is read for a mode. Do not add one.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./accounts-api.ts / ./account-decisions-api.ts /
// ./client-radar-research-api.ts / ./icp-profiles-api.ts. React Query
// itself stays in the components; this module only exports a plain fetch
// function.
//
// No query-key helper is exported here: there is no GET/history endpoint
// for account ICP evaluations, so there is nothing to cache or invalidate
// by key. Each call creates a new snapshot and evaluation server-side;
// the response is meant to be held in the caller's own (e.g. mutation)
// state, not queried.

import type { AccountEvaluation } from "@/lib/accounts-api";

// Carries the backend's own `code` (see sendError() in
// routes/accountIcpEvaluations.ts: every error body is `{ error, code }`)
// plus the HTTP status. In particular, code "no_resolvable_preview_version"
// (409) is preserved verbatim so a future panel can render specific
// conflict copy instead of a generic error message.
export class AccountIcpEvaluationApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AccountIcpEvaluationApiError";
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
  throw new AccountIcpEvaluationApiError(
    body.error ?? fallback,
    body.code,
    res.status,
  );
}

export async function runAccountIcpPreview(
  accountId: string,
  profileId: string,
): Promise<AccountEvaluation> {
  const res = await fetch(
    `/api/internal/accounts/${encodeURIComponent(accountId)}/icp-evaluations`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not run ICP preview.");
  }
  return res.json() as Promise<AccountEvaluation>;
}
