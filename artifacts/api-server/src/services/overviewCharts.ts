// LS5 — Live Shell Closure: canonical Overview charts. Two factual,
// canonical aggregates over the same `observations` table
// ./overviewMetrics.ts's signalsCaptured already counts — no scoring, no
// intent, no research-intelligence inference, no sample fallback.
//
// Deliberately contains no HTTP-specific logic — see ../routes/overview.ts
// for the HTTP boundary. Only imports from @workspace/db/schema, never
// @workspace/db itself — the database instance is always received via
// explicit injection, mirroring ./overviewMetrics.ts.
//
// Chart 1 (signalsOverTime) and Chart 2 (signalsByProvider) intentionally
// share the SAME window and the SAME importedAt field
// ./overviewMetrics.ts's "Signals captured" metric uses — via the same
// ./overviewTimeframe.ts helper both modules import, never a locally
// redefined "last N days" (see that module's own comment: this repo
// briefly had the KPI and the charts disagree about what "last 7 days"
// meant, which is the exact drift this shared helper exists to prevent).
// Together they tell one coherent story: this week's volume trend, and
// this week's breakdown by source. observedAt is not used: it is
// nullable and provider-claimed, not "when Mission Control captured
// this" (see observations.ts's own module comment; ./overviewMetrics.ts's
// identical reasoning).
//
// Provider composition was chosen over observation-class composition
// (see module-level design note in NEXT_SESSION.md's LS5 checkpoint):
// RB2B / HubSpot / Client Radar are the three integrations a GTM
// operator already recognizes by name, while observation_class
// (identity/firmographic_fact/crm_state/behavioral_signal/
// research_intelligence) is this repo's internal data-modeling
// taxonomy — meaningful to this codebase, not to the operator reading
// the chart. Provider is also the dimension the task's own preferred
// order lists first.
//
// LS5 terminology correction: both charts are rendered on Overview as
// "Observations over time" / "Observations by source", not "Signals
// over time" / "Signals by source". Both count raw canonical
// `observations` ROWS, not distinct external events — inspection
// confirmed no reliable cross-provider "one occurrence = one row"
// identity exists today (provider+sourceRecordId means a different
// thing per provider: one event for RB2B, one SUBJECT reused across
// every refresh for HubSpot, one sub-finding within a run for Client
// Radar). signalsByProvider in particular must never be read as a
// comparable event/occurrence count across providers — it is explicitly
// a view of canonical data VOLUME by provider only (one HubSpot refresh
// alone can emit up to 9 rows; see hubSpotObservationMapping.ts). The
// field names below (signalsOverTime/signalsByProvider) are left
// unchanged to avoid API churn — only the user-facing labels changed.

import { and, count, gte, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { observations } from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import {
  dailyBucketsFor,
  overviewWindowFor,
  DEFAULT_OVERVIEW_TIMEFRAME_DAYS,
  type OverviewTimeframe,
} from "./overviewTimeframe.js";

type Db = NodePgDatabase<typeof schema>;

export interface SignalsOverTimePoint {
  /** UTC calendar date, "YYYY-MM-DD" — never a localized or server-timezone date. */
  date: string;
  count: number;
}

export interface SignalsByProviderSlice {
  /** The exact canonical, lower/trim-normalized provider value stored on observations.provider (e.g. "rb2b", "hubspot", "client_radar") — never relabeled or merged here. */
  provider: string;
  count: number;
}

export interface OverviewCharts {
  timeframe: OverviewTimeframe;
  signalsOverTime: SignalsOverTimePoint[];
  signalsByProvider: SignalsByProviderSlice[];
}

// dailyBucketsFor is re-exported here so existing call sites/tests that
// imported it from this module keep working — the implementation itself
// lives solely in ./overviewTimeframe.ts.
export { dailyBucketsFor };

export interface GetOverviewChartsArgs {
  db: Db;
  /** Test-only override for both charts' window; defaults to 7. */
  days?: number;
  /** Test-only override for "now"; defaults to the real current time. */
  now?: Date;
}

export async function getOverviewCharts(args: GetOverviewChartsArgs): Promise<OverviewCharts> {
  const { db } = args;
  const days = args.days ?? DEFAULT_OVERVIEW_TIMEFRAME_DAYS;
  const now = args.now ?? new Date();
  const { from, to } = overviewWindowFor(days, now);
  const inWindow = and(gte(observations.importedAt, from), lte(observations.importedAt, to));

  const [dailyRows, providerRows] = await Promise.all([
    db
      .select({
        // UTC day bucket as an exact "YYYY-MM-DD" string, independent of
        // the DB session's timezone setting — AT TIME ZONE 'UTC' converts
        // the timestamptz to UTC wall-clock time before truncating.
        day: sql<string>`to_char(date_trunc('day', ${observations.importedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
        value: count(),
      })
      .from(observations)
      .where(inWindow)
      .groupBy(sql`1`),
    db
      .select({ provider: observations.provider, value: count() })
      .from(observations)
      .where(inWindow)
      .groupBy(observations.provider),
  ]);

  const countByDay = new Map(dailyRows.map((row) => [row.day, Number(row.value)]));
  const signalsOverTime: SignalsOverTimePoint[] = dailyBucketsFor(days, now).map((date) => ({
    date,
    count: countByDay.get(date) ?? 0,
  }));

  const signalsByProvider: SignalsByProviderSlice[] = providerRows
    .map((row) => ({ provider: row.provider, count: Number(row.value) }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.provider.localeCompare(b.provider)));

  return {
    timeframe: { days, from: from.toISOString(), to: to.toISOString() },
    signalsOverTime,
    signalsByProvider,
  };
}
