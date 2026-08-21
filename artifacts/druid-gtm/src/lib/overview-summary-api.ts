// LS6 — hand-written types + fetch function for the canonical Overview
// AI Summary read (GET /api/internal/overview/summary). Shape verified
// directly against artifacts/api-server/src/routes/overview.ts and
// artifacts/api-server/src/services/overviewSummary.ts — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./overview-metrics-api.ts / ./overview-charts-api.ts. A 503 response
// (AI Summary genuinely unavailable — not configured, provider failure,
// or a response that failed grounding/language validation) is a normal,
// expected outcome, not a bug — see OverviewSummaryApiError.

export interface OverviewSummaryTimeframe {
  days: number;
  from: string;
  to: string;
}

export interface OverviewSummary {
  timeframe: OverviewSummaryTimeframe;
  summary: string;
  factsUsed: string[];
  generatedAt: string;
}

export class OverviewSummaryApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "OverviewSummaryApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new OverviewSummaryApiError(body.error ?? fallback, body.code);
}

export async function fetchOverviewSummary(): Promise<OverviewSummary> {
  const res = await fetch("/api/internal/overview/summary", {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "AI Summary is currently unavailable.");
  }
  return res.json() as Promise<OverviewSummary>;
}

export function overviewSummaryQueryKey() {
  return ["overview", "summary"] as const;
}
