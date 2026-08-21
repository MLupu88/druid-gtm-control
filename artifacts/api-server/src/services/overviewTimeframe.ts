// LS5 correction — the single canonical Overview signal timeframe,
// shared by ./overviewMetrics.ts's "Signals captured" KPI and
// ./overviewCharts.ts's two charts, so the KPI and the charts can never
// silently drift apart. They briefly used two different "last 7 days"
// definitions in the same turn — an exact rolling 7*24h window for the
// KPI vs. calendar-day-aligned buckets for the charts — which could
// legitimately show different totals while both claimed "last 7 days".
// That ambiguity is not acceptable in the production cockpit (see
// NEXT_SESSION.md's LS5 checkpoint).
//
// The single canonical definition: the last `days` UTC CALENDAR days,
// INCLUDING today — deliberately calendar-aligned, not an exact rolling
// window, so every consumer's zero-count/partial-today handling is
// identical. Every Overview signal aggregate MUST derive its window from
// overviewWindowFor below, never redefine "last N days" independently.
//
// importedAt is the sole timestamp field this canonical timeframe is
// ever applied to (see observations.ts's own module comment: it's the
// caller-supplied, NOT NULL ingestion-boundary timestamp — never the
// nullable, provider-claimed observedAt).

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_OVERVIEW_TIMEFRAME_DAYS = 7;

export interface OverviewTimeframe {
  days: number;
  from: string;
  to: string;
}

/**
 * The `days` UTC calendar dates ending with "today" (the UTC calendar
 * date `now` falls on), oldest first — e.g. days=7 at
 * 2026-08-21T10:00:00Z yields ["2026-08-15", ..., "2026-08-21"]. Pure
 * and exported for unit testing.
 */
export function dailyBucketsFor(days: number, now: Date): string[] {
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(todayUtcMs - i * MS_PER_DAY).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * The exact [from, to] window every Overview signal aggregate must
 * query: FROM the UTC day-start of the oldest bucket dailyBucketsFor
 * would return, TO `now` (inclusive). "Today"'s bucket is legitimately
 * partial — it only contains observations imported so far today — an
 * honest reflection of a still-in-progress calendar day, not a bug.
 */
export function overviewWindowFor(days: number, now: Date): { from: Date; to: Date } {
  const oldestBucketDate = dailyBucketsFor(days, now)[0]!;
  const from = new Date(`${oldestBucketDate}T00:00:00.000Z`);
  return { from, to: now };
}
