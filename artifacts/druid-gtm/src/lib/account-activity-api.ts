// M3.5 — hand-written types + fetch function for the RB2B live-signal
// last-mile Activity read API (GET /api/internal/accounts/:accountId/activity).
// Shapes here are verified directly against
// artifacts/api-server/src/routes/accounts.ts and
// artifacts/api-server/src/services/accountActivity.ts — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./account-truth-api.ts. Deliberately minimal — this is the minimum
// truthful visibility needed to prove the live RB2B path, not the final
// ZoomInfo-style Activity UX.

export interface AccountActivityItem {
  id: string;
  provider: string;
  eventType: string;
  occurredAt: string;
  importedAt: string;
  rawValue: unknown;
}

export interface AccountActivityResponse {
  items: AccountActivityItem[];
}

export class AccountActivityApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AccountActivityApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new AccountActivityApiError(body.error ?? fallback, body.code);
}

export async function fetchAccountActivity(accountId: string): Promise<AccountActivityResponse> {
  const res = await fetch(`/api/internal/accounts/${accountId}/activity`, {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load recent account activity.");
  }
  return res.json() as Promise<AccountActivityResponse>;
}

export function accountActivityQueryKey(accountId: string) {
  return ["account-activity", accountId] as const;
}
