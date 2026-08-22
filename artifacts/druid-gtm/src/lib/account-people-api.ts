// LS8 — hand-written types + fetch function for the canonical People read
// API (GET /api/internal/accounts/:accountId/people). Shapes verified
// directly against artifacts/api-server/src/routes/accounts.ts and
// artifacts/api-server/src/services/people.ts — not guessed.
//
// Mirrors ./account-activity-api.ts's exact conventions (raw fetch +
// credentials: "include", same error-shape handling, same query-key
// helper pattern).

export interface AccountPerson {
  id: string;
  fullName: string | null;
  workEmail: string | null;
  linkedinUrl: string | null;
  title: string | null;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AccountPeopleResponse {
  items: AccountPerson[];
}

export class AccountPeopleApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AccountPeopleApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new AccountPeopleApiError(body.error ?? fallback, body.code);
}

export async function fetchAccountPeople(accountId: string): Promise<AccountPeopleResponse> {
  const res = await fetch(`/api/internal/accounts/${accountId}/people`, {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load this account's people.");
  }
  return res.json() as Promise<AccountPeopleResponse>;
}

export function accountPeopleQueryKey(accountId: string) {
  return ["account-people", accountId] as const;
}
