// Milestone 4B — hand-written types + fetch functions for the Grounded
// Account Brain read model (GET /api/internal/accounts/:accountId/brain,
// POST /api/internal/accounts/:accountId/brain/analyze). Shapes verified
// directly against artifacts/api-server/src/routes/accounts.ts and
// artifacts/api-server/src/services/accountBrainSummary.ts — not
// guessed.
//
// Mirrors ./account-claims-api.ts's exact conventions (raw fetch +
// credentials: "include", same error-shape handling, same query-key
// helper pattern). GET is cheap (no LLM); POST is the explicit
// "Analyze this account" action (one DeepSeek call) — never fired
// automatically, only from a deliberate user click (see
// ../components/account-brain-panel.tsx).

import type { AccountTruthField } from "@/lib/account-truth-api";
import type { AccountPerson } from "@/lib/account-people-api";
import type { AccountClaim } from "@/lib/account-claims-api";

export interface AccountActivitySummary {
  totalEvents: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  distinctDaysObserved: number;
  providers: string[];
}

export type AccountBrainNarrativeUnavailableReason =
  | "not_configured"
  | "api_error"
  | "invalid_json"
  | "invalid_shape"
  | "forbidden_language"
  | "ungrounded";

export interface AccountBrainNarrative {
  text: string;
  generatedAt: string;
}

export interface AccountBrainSummary {
  accountTruth: AccountTruthField[];
  people: AccountPerson[];
  activitySummary: AccountActivitySummary;
  claims: AccountClaim[];
  narrative: AccountBrainNarrative | null;
  narrativeUnavailableReason: AccountBrainNarrativeUnavailableReason | null;
}

export class AccountBrainApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AccountBrainApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new AccountBrainApiError(body.error ?? fallback, body.code);
}

/** Cheap, no LLM call — safe to fire on every Intelligence-tab load. narrative is always null in the response. */
export async function fetchAccountBrain(accountId: string): Promise<AccountBrainSummary> {
  const res = await fetch(`/api/internal/accounts/${accountId}/brain`, {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load this account's understanding.");
  }
  return res.json() as Promise<AccountBrainSummary>;
}

/** The explicit "Analyze this account" action — one DeepSeek call. Only ever call this from a deliberate user click. */
export async function analyzeAccountBrain(accountId: string): Promise<AccountBrainSummary> {
  const res = await fetch(`/api/internal/accounts/${accountId}/brain/analyze`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not analyze this account.");
  }
  return res.json() as Promise<AccountBrainSummary>;
}

export function accountBrainQueryKey(accountId: string) {
  return ["account-brain", accountId] as const;
}
