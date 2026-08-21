// LS5 — hand-written types + fetch function for the canonical Overview
// charts read (GET /api/internal/overview/charts). Shape verified
// directly against artifacts/api-server/src/routes/overview.ts and
// artifacts/api-server/src/services/overviewCharts.ts — not guessed.
//
// Follows the same raw-fetch + credentials:"include" convention as
// ./overview-metrics-api.ts / ./global-activity-api.ts.

export interface OverviewChartsTimeframe {
  days: number;
  from: string;
  to: string;
}

export interface SignalsOverTimePoint {
  /** UTC calendar date, "YYYY-MM-DD". */
  date: string;
  count: number;
}

export interface SignalsByProviderSlice {
  /** The exact canonical provider value stored on observations.provider (e.g. "rb2b") — never relabeled server-side. */
  provider: string;
  count: number;
}

export interface OverviewCharts {
  timeframe: OverviewChartsTimeframe;
  signalsOverTime: SignalsOverTimePoint[];
  signalsByProvider: SignalsByProviderSlice[];
}

export class OverviewChartsApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
  ) {
    super(message);
    this.name = "OverviewChartsApiError";
  }
}

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  throw new OverviewChartsApiError(body.error ?? fallback, body.code);
}

export async function fetchOverviewCharts(): Promise<OverviewCharts> {
  const res = await fetch("/api/internal/overview/charts", {
    credentials: "include",
  });
  if (!res.ok) {
    await throwForResponse(res, "Could not load Overview charts.");
  }
  return res.json() as Promise<OverviewCharts>;
}

export function overviewChartsQueryKey() {
  return ["overview", "charts"] as const;
}
