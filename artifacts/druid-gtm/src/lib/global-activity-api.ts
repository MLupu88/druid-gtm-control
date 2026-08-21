// LS4 — hand-written types + fetch function for the canonical global
// cross-account Recent Activity read (GET /api/internal/overview/activity).
// Shape verified directly against artifacts/api-server/src/routes/overview.ts
// and artifacts/api-server/src/services/accountActivity.ts's
// GlobalActivityItemDTO — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./account-activity-api.ts / ./overview-metrics-api.ts.

export interface GlobalActivityItem {
  id: string;
  provider: string;
  eventType: string;
  occurredAt: string;
  importedAt: string;
  rawValue: unknown;
  accountId: string;
  accountName: string | null;
  companyDomain: string | null;
}

export interface GlobalActivityResponse {
  items: GlobalActivityItem[];
}

export class GlobalActivityApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "GlobalActivityApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new GlobalActivityApiError(body.error ?? fallback, body.code);
}

export async function fetchGlobalActivity(limit?: number): Promise<GlobalActivityResponse> {
  const query = limit !== undefined ? `?limit=${limit}` : "";
  const res = await fetch(`/api/internal/overview/activity${query}`, {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load recent activity.");
  }
  return res.json() as Promise<GlobalActivityResponse>;
}

export function globalActivityQueryKey(limit?: number) {
  return ["overview", "activity", limit ?? "default"] as const;
}
