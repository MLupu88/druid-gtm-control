// Hand-written types + fetch functions for the account-level ICP
// evaluation endpoints:
//   - POST /api/internal/accounts/:accountId/icp-evaluations — preview.
//   - POST /api/internal/accounts/:accountId/icp-evaluations/official —
//     runs and PERSISTS the account's official (production) evaluation.
// Shapes here are verified directly against
// artifacts/api-server/src/routes/accountIcpEvaluations.ts (both return
// the raw persisted account_evaluations row, 201, for both a "completed"
// and a truthfully persisted "failed" outcome — neither is an HTTP
// error) — not guessed.
//
// AccountEvaluation is imported, not redeclared: the backend returns the
// exact same row shape @/lib/accounts-api already types field-for-field
// (including its documented numeric-as-string convention for
// fitScore/intentScore/actionabilityScore).
//
// runAccountIcpPreview is preview-only — its request body is built as a
// literal `{ profileId }` object with no evaluationMode field, ever.
// runAccountIcpOfficialEvaluation is the separate, save-only
// counterpart: it always hits the /official path, always runs a FRESH
// server-side evaluation (fresh snapshot, the profile's current active
// published version, the canonical evaluator), and never accepts or
// echoes back a client-supplied preview result — there is no request
// field here that could carry a preview's own values through to be
// persisted as-is. The official evaluation may legitimately differ from
// whatever preview is currently displayed (see the account-icp-preview-
// panel's own comment on why).
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./accounts-api.ts / ./account-decisions-api.ts /
// ./client-radar-research-api.ts / ./icp-profiles-api.ts. React Query
// itself stays in the components; this module only exports plain fetch
// functions.
//
// No query-key helper is exported here: there is no GET/history endpoint
// for account ICP evaluations, so there is nothing to cache or invalidate
// by key for these two calls specifically. Each call creates a new
// snapshot and evaluation server-side; callers that need the account's
// persisted evaluation history to reflect a new official evaluation
// invalidate @/lib/accounts-api's accountDetailQueryKey instead (see
// ../components/account-icp-preview-panel.tsx) — that is the query the
// history/decision-availability UI actually reads.

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

// Runs and saves the account's official (production) ICP evaluation.
// Always a fresh server-side evaluation — the request body is a literal
// `{ profileId }` object, exactly like runAccountIcpPreview above; there
// is no field here through which a client-held preview result could be
// submitted directly. The backend resolves the account's current
// canonical snapshot and the profile's active published version itself
// (see ../../api-server/src/services/accountEvaluations.ts's
// runOfficialIcpEvaluationForAccount) — this function never receives or
// sends a snapshotId/profileVersionId/evaluatorVersionId.
export async function runAccountIcpOfficialEvaluation(
  accountId: string,
  profileId: string,
): Promise<AccountEvaluation> {
  const res = await fetch(
    `/api/internal/accounts/${encodeURIComponent(accountId)}/icp-evaluations/official`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    },
  );
  if (!res.ok) {
    await throwForResponse(res, "Could not run and save the official evaluation.");
  }
  return res.json() as Promise<AccountEvaluation>;
}
