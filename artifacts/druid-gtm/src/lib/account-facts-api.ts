// Hand-written types + fetch functions for the manual account facts API
// (GET/POST /api/internal/accounts/:accountId/facts). Shapes here are
// verified directly against
// artifacts/api-server/src/routes/accountFacts.ts,
// artifacts/api-server/src/services/accountFacts.ts, and
// lib/db/src/schema/accountFacts.ts — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./account-decisions-api.ts. React Query itself stays in the
// components; this module only exports plain fetch functions and a
// stable query-key helper.

// Exactly the five Slice 1 fields — see
// lib/db/src/schema/accountFacts.ts's ACCOUNT_FACT_FIELDS.
export const ACCOUNT_FACT_FIELDS = [
  "company.industry",
  "company.country",
  "company.region",
  "company.employeeRange",
  "company.revenueRange",
] as const;
export type AccountFactField = (typeof ACCOUNT_FACT_FIELDS)[number];

// The only field with a closed value set — mirrors
// artifacts/api-server/src/services/accountFactValueValidation.ts's
// ManualRegionValueSchema (RegionV1 minus "unknown", which can never be a
// manually-confirmed value).
export const ACCOUNT_FACT_REGION_VALUES = ["us", "emea", "other"] as const;
export type AccountFactRegionValue = (typeof ACCOUNT_FACT_REGION_VALUES)[number];

export interface AccountFact {
  id: string;
  field: AccountFactField;
  value: string;
  recordedBy: string;
  observedAt: string;
  recordedAt: string;
  correctionReason: string | null;
  supersedesFactId: string | null;
}

export interface AccountFactsResponse {
  current: AccountFact[];
  history: AccountFact[];
}

export class AccountFactsApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AccountFactsApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new AccountFactsApiError(body.error ?? fallback, body.code);
}

export async function fetchAccountFacts(accountId: string): Promise<AccountFactsResponse> {
  const res = await fetch(`/api/internal/accounts/${accountId}/facts`, {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load company facts.");
  }
  return res.json() as Promise<AccountFactsResponse>;
}

export interface RecordAccountFactArgs {
  accountId: string;
  field: AccountFactField;
  value: string;
  /** null => this must be the first-ever confirmation for this field. */
  expectedCurrentFactId: string | null;
  /** Required, non-blank iff expectedCurrentFactId is set; null otherwise. */
  correctionReason: string | null;
}

export async function recordAccountFact(args: RecordAccountFactArgs): Promise<AccountFact> {
  const res = await fetch(`/api/internal/accounts/${args.accountId}/facts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      field: args.field,
      value: args.value,
      expectedCurrentFactId: args.expectedCurrentFactId,
      correctionReason: args.correctionReason,
    }),
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not record this fact.");
  }
  return res.json() as Promise<AccountFact>;
}

export function accountFactsQueryKey(accountId: string) {
  return ["account-facts", accountId] as const;
}
