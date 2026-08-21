// LS3 — hand-written types + fetch function for the canonical Overview
// metrics API (GET /api/internal/overview/metrics). Shape verified
// directly against artifacts/api-server/src/routes/overview.ts and
// artifacts/api-server/src/services/overviewMetrics.ts — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./account-truth-api.ts / ./account-activity-api.ts.

export interface OverviewMetricsTimeframe {
  days: number;
  from: string;
  to: string;
}

export interface OverviewMetrics {
  timeframe: OverviewMetricsTimeframe;
  signalsCaptured: number;
  accountsNeedingAttention: number;
  totalAccounts: number;
}

export class OverviewMetricsApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "OverviewMetricsApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new OverviewMetricsApiError(body.error ?? fallback, body.code);
}

export async function fetchOverviewMetrics(): Promise<OverviewMetrics> {
  const res = await fetch("/api/internal/overview/metrics", {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load Overview metrics.");
  }
  return res.json() as Promise<OverviewMetrics>;
}

export function overviewMetricsQueryKey() {
  return ["overview", "metrics"] as const;
}
