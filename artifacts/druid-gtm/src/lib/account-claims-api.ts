// Milestone 4A — hand-written types + fetch function for the Account
// Brain claims read API (GET /api/internal/accounts/:accountId/claims).
// Shapes verified directly against
// artifacts/api-server/src/routes/accounts.ts and
// artifacts/api-server/src/services/accountClaims.ts — not guessed.
//
// Mirrors ./account-people-api.ts's exact conventions (raw fetch +
// credentials: "include", same error-shape handling, same query-key
// helper pattern).

export type ClaimValueType = "boolean" | "number" | "string" | "list" | "object";
export type ClaimOrigin = "observed" | "derived" | "research" | "human_confirmed" | "human_corrected";
export type ClaimConfidence = "low" | "medium" | "high";
export type ClaimStatus = "active" | "rejected";

export type ClaimEvidence =
  | {
      kind: "observation";
      id: string;
      provider: string;
      value: unknown;
      observedAt: string | null;
      importedAt: string;
    }
  | {
      kind: "manual_account_fact";
      id: string;
      value: string;
      recordedBy: string;
      observedAt: string;
    }
  | { kind: "unknown"; id: string };

export interface AccountClaim {
  id: string;
  claimKey: string;
  status: ClaimStatus;
  valueType: ClaimValueType | null;
  value: unknown;
  origin: ClaimOrigin;
  confidence: ClaimConfidence | null;
  isCurrent: boolean;
  supersedesClaimId: string | null;
  correctionReason: string | null;
  recordedBy: string | null;
  generatedByVersion: string | null;
  observedAt: string | null;
  createdAt: string;
  evidence: ClaimEvidence[];
}

export interface AccountClaimsResponse {
  items: AccountClaim[];
}

export class AccountClaimsApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AccountClaimsApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new AccountClaimsApiError(body.error ?? fallback, body.code);
}

export async function fetchAccountClaims(accountId: string): Promise<AccountClaimsResponse> {
  const res = await fetch(`/api/internal/accounts/${accountId}/claims`, {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load this account's claims.");
  }
  return res.json() as Promise<AccountClaimsResponse>;
}

export function accountClaimsQueryKey(accountId: string) {
  return ["account-claims", accountId] as const;
}
