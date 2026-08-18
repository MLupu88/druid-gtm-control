// Hand-written types + fetch functions for the canonical accounts API
// (GET /api/internal/accounts, GET /api/internal/accounts/:accountId).
// Shapes here are verified directly against
// artifacts/api-server/src/routes/accounts.ts and
// artifacts/api-server/src/services/accounts.ts — not guessed.
//
// Notes on the wire format:
// - createdAt/updatedAt are real Date objects server-side, but arrive
//   here as ISO strings once JSON-serialized — typed as `string`.
// - fitScore/intentScore/actionabilityScore are Postgres `numeric`
//   columns; drizzle-orm returns those as strings (not numbers) to avoid
//   float precision loss, and that is exactly what crosses the wire.
// - fitTier/intentTier are free-text values an ICP profile's own config
//   defines (e.g. "base", "high", "warm") — there is no fixed label
//   table for them anywhere in the codebase, unlike evaluationMode/
//   status/eligibilityOutcome, which are real enums. Render fitTier/
//   intentTier as-is; do not invent a translation table for them.
//
// Follows the existing raw-fetch + credentials:"include" convention used
// by ../hooks/use-auth.ts, ../pages/queue.tsx, and
// ../components/action-modal.tsx — no generated API client, since
// @workspace/api-client-react's OpenAPI spec does not cover these routes
// yet. React Query itself (useQuery/useMutation) stays in the page
// components; this module only exports plain fetch functions and stable
// query-key helpers, so it has no framework dependency of its own.

import type { RoutingOutput } from "@/lib/account-decisions-api";

export interface Account {
  id: string;
  accountKey: string;
  companyDomain: string | null;
  companyName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EvaluationMode = "preview" | "production";
export type EvaluationStatus = "completed" | "failed";
export type IdentityResolutionLevel =
  | "anonymous"
  | "company"
  | "contact"
  | "known_crm_contact";
export type IdentityConfidence = "low" | "medium" | "high";
export type EligibilityOutcome = "eligible" | "restricted" | "ineligible";

// Mirrors @workspace/evaluator's MqlNotReadyReasonCode/MqlNotReadyReason —
// hand-declared here (not imported) since this package has no dependency
// on @workspace/evaluator; the shape is verified directly against
// services/mqlDecisionReadiness.ts and services/accounts.ts.
export type MqlNotReadyReasonCode =
  | "official_evaluation_required"
  | "intent_not_configured"
  | "snapshot_evidence_unknown"
  | "required_condition_unresolved";

export interface MqlNotReadyReason {
  code: MqlNotReadyReasonCode;
  message: string;
  dimension?: "fit" | "intent";
  ruleId?: string;
  fields?: string[];
}

// Server-derived, authoritative — never recompute this client-side. See
// services/mqlDecisionReadiness.ts's deriveMqlDecisionReadiness (the
// single source of truth) and services/accounts.ts (where it is attached
// to every evaluation summary/detail row).
export interface MqlDecisionReadiness {
  ready: boolean;
  reasons: MqlNotReadyReason[];
}

// Scalar-only summary — list responses never include the jsonb payload
// fields (profileConfigSnapshot/eligibilityRestrictions/hardDisqualifiers/
// scoreComponents/matchedRules/missingInputs); see
// services/accounts.ts's AccountEvaluationSummary/EVALUATION_SUMMARY_COLUMNS,
// which this type mirrors field-for-field.
export interface AccountEvaluationSummary {
  id: string;
  accountId: string;
  snapshotId: string;
  profileVersionId: string;
  evaluatorVersionId: string;
  evaluationMode: EvaluationMode;
  status: EvaluationStatus;
  errorDetail: string | null;
  fitScore: string | null;
  fitTier: string | null;
  intentScore: string | null;
  intentTier: string | null;
  identityResolutionLevel: IdentityResolutionLevel | null;
  identityConfidence: IdentityConfidence | null;
  actionabilityScore: string | null;
  eligibilityOutcome: EligibilityOutcome | null;
  createdAt: string;
  createdBy: string | null;
  /** Derived server-side from the evaluation's own profileConfigSnapshot (see services/accounts.ts's toEvaluationSummary) — never the full config. False means intentTier necessarily resolved to the profile's fallback band, not a real evaluated buying-intent signal; render "Intent not configured" instead of intentTier in that case. */
  intentConfigured: boolean;
  /** Server-derived, authoritative result of whether this evaluation has enough evidence-backed, action-relevant fit/intent condition resolution to support a "Promote to MQL" decision. Render this verbatim (ready + reasons) — never recompute it from missingInputs, scores, or tiers. */
  mqlDecisionReadiness: MqlDecisionReadiness;
}

// The full, exact persisted row — only ever present on the detail
// endpoint's `evaluations` array. Adds the jsonb fields the list summary
// omits; see services/accounts.ts's AccountDetail/getAccountById.
export interface AccountEvaluation extends AccountEvaluationSummary {
  profileConfigSnapshot: unknown;
  eligibilityRestrictions: unknown;
  hardDisqualifiers: unknown;
  scoreComponents: unknown;
  matchedRules: unknown;
  missingInputs: unknown;
}

// Compact summary of an account's most recent canonical decision — see
// services/accounts.ts's AccountDecisionSummary, which this mirrors
// field-for-field. This is display/context data only; Needs Attention
// membership comes exclusively from open attention_items.
export interface AccountDecisionSummary {
  id: string;
  routingOutput: RoutingOutput;
  createdAt: string;
}

// Derived exclusively from open attention_items by the canonical accounts
// read model. A non-null summary therefore always represents at least one
// open item; null means the account has no open attention items.
export interface AccountAttentionSummary {
  openCount: number;
  oldestOpenAttentionAt: string;
  reasonCodes: string[];
}

export interface AccountListItem {
  account: Account;
  latestEvaluation: AccountEvaluationSummary | null;
  latestProductionEvaluation: AccountEvaluationSummary | null;
  latestDecision: AccountDecisionSummary | null;
  attention: AccountAttentionSummary | null;
}

export interface AccountsListResponse {
  items: AccountListItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface AccountDetail {
  account: Account;
  /** Ordered by createdAt descending, then id descending. */
  evaluations: AccountEvaluation[];
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

// Mirrors MAX_LIMIT in artifacts/api-server/src/routes/accounts.ts. The API
// rejects any `limit` above this with a 400 — every frontend call site that
// wants "as many as we can get in one page" (no pagination UI exists yet)
// must ask for exactly this, not some larger number.
export const ACCOUNTS_LIST_MAX_LIMIT = 100;

// Mirrors the existing frontend convention for turning a non-2xx JSON
// error body into a thrown Error — see ../hooks/use-auth.ts's
// loginMutation and ../components/action-modal.tsx's handleConfirm: a
// best-effort parse of the body, preferring its own `error` message
// (the api-server's sendError() shape is always `{ error, code }`, and
// that message is already written to be safe to show an operator), with
// a generic fallback if the body itself couldn't even be read.
async function throwForResponse(
  res: Response,
  fallback: string,
): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? fallback);
}

export async function fetchAccounts(
  args: { limit?: number; offset?: number; needsAttention?: boolean } = {},
): Promise<AccountsListResponse> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const offset = args.offset ?? DEFAULT_OFFSET;
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (args.needsAttention !== undefined) {
    params.set("needsAttention", String(args.needsAttention));
  }
  const res = await fetch(`/api/internal/accounts?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load accounts.");
  }
  return res.json() as Promise<AccountsListResponse>;
}

// Returns null (not a thrown error) for a well-formed "no such account"
// 404 — that is a legitimate answer from the API, not a failure. Every
// other non-2xx status is still thrown as an Error for the caller's
// error state to handle.
export async function fetchAccountDetail(
  accountId: string,
): Promise<AccountDetail | null> {
  const res = await fetch(
    `/api/internal/accounts/${encodeURIComponent(accountId)}`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    await throwForResponse(res, "Could not load this account.");
  }
  return res.json() as Promise<AccountDetail>;
}

// Stable query-key helpers — same intent as QUEUE_QUERY_KEY/
// ACTION_LOG_QUERY_KEY in @workspace/gtm-shared's gtmContract.js: every
// call site (and any future cache invalidation) agrees on the exact key
// shape without duplicating the literal array per call site.
export function accountsListQueryKey(
  args: { limit?: number; offset?: number; needsAttention?: boolean } = {},
) {
  return [
    "accounts",
    "list",
    args.limit ?? DEFAULT_LIMIT,
    args.offset ?? DEFAULT_OFFSET,
    args.needsAttention ?? false,
  ] as const;
}

export function accountDetailQueryKey(accountId: string) {
  return ["accounts", "detail", accountId] as const;
}
