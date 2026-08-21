// LS3 — Live Shell Closure: canonical Overview metrics. Replaces the
// legacy Google-Sheets-backed "Signals to review" concept on Overview
// with truthful, provider-neutral canonical aggregates.
//
// Deliberately contains no HTTP-specific logic (no req/res, no status
// codes) — see ../routes/overview.ts for the HTTP boundary that wraps
// this. Only imports from @workspace/db/schema, never @workspace/db
// itself — the database instance is always received via explicit
// injection, mirroring ../services/accounts.ts.
//
// Every number here is a direct, deterministic canonical aggregate — no
// scoring, no intent, no research-intelligence inference, no sample
// fallback. A zero-data account always returns real zeros, never null.
//
// LS5 correction — signalsCaptured's window is no longer defined here.
// It now derives from ./overviewTimeframe.ts's overviewWindowFor, the
// single canonical "last N UTC calendar days" definition also used by
// ./overviewCharts.ts's two charts, so the KPI and the charts can never
// silently disagree about what "last 7 days" means. timeframeFor below
// is kept as this module's own name for that shared function (never a
// second, independent definition) so existing call sites/tests don't
// need to change their import path.

import { and, count, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { accounts, observations } from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import { listAccounts } from "./accounts.js";
import {
  overviewWindowFor,
  DEFAULT_OVERVIEW_TIMEFRAME_DAYS,
  type OverviewTimeframe,
} from "./overviewTimeframe.js";

type Db = NodePgDatabase<typeof schema>;

/** @deprecated kept only so existing imports keep working — this is exactly OverviewTimeframe from ./overviewTimeframe.ts. */
export type OverviewMetricsTimeframe = OverviewTimeframe;

export interface OverviewMetrics {
  timeframe: OverviewMetricsTimeframe;
  /**
   * Count of canonical `observations` rows recorded (imported_at) by
   * Mission Control within `timeframe` — every provider, every
   * observation class. Never a Sheets queue row count, never a sample
   * count, never an action count, never an account count, never a
   * HubSpot-specific count. imported_at (not the nullable, provider-
   * claimed observed_at) is the correct field for "captured BY Mission
   * Control" — see observations.ts's own module comment: imported_at is
   * the caller-supplied ingestion-boundary timestamp, never server-
   * defaulted, always present. The window itself is the last 7 UTC
   * CALENDAR days including today (see ./overviewTimeframe.ts) — the
   * same window ./overviewCharts.ts's signalsOverTime buckets sum to.
   *
   * LS5 terminology correction: rendered on Overview as "Observations
   * captured", not "Signals captured" — a raw observation-ROW count is
   * NOT the same thing as a count of distinct external events. One RB2B
   * visit, one HubSpot refresh, or one Client Radar research run can
   * each legitimately emit multiple observation rows (HubSpot alone: up
   * to 9 per refresh — see hubSpotObservationMapping.ts), so this field
   * intentionally does not claim to count "signals" in that sense. The
   * field name itself (signalsCaptured) is left unchanged to avoid API
   * churn — only the user-facing label changed.
   */
  signalsCaptured: number;
  /**
   * Count of DISTINCT canonical accounts with at least one open
   * attention_items row, right now (not timeframe-scoped — this is
   * current state, not a period count). Reuses ../services/accounts.ts's
   * own listAccounts(needsAttention: true) EXISTS-filtered count
   * unmodified, rather than re-deriving the open-attention rule here —
   * the exact same semantics the canonical Needs Attention screen
   * already uses, so an account with 5 open items still counts once.
   */
  accountsNeedingAttention: number;
  /**
   * Total canonical accounts, right now — a plain COUNT(*) over
   * `accounts`, not timeframe-scoped, not claiming any "active" or
   * "observed in this window" semantics the current schema cannot
   * cheaply and correctly prove (observations carry no account_id;
   * bulk-resolving "which accounts have a recent observation" would
   * require a new whole-table identity-binding join this milestone does
   * not build — see NEXT_SESSION.md's LS3 checkpoint). A plain, honestly
   * labeled total was chosen over inventing that semantic.
   */
  totalAccounts: number;
}

/** The single canonical Overview timeframe, re-exported under this module's established name — see ./overviewTimeframe.ts for the actual definition. Never redefine "last N days" independently here. */
export const timeframeFor = overviewWindowFor;

export interface GetOverviewMetricsArgs {
  db: Db;
  /** Test-only override for the signalsCaptured window; defaults to 7. */
  days?: number;
  /** Test-only override for "now"; defaults to the real current time. */
  now?: Date;
}

export async function getOverviewMetrics(
  args: GetOverviewMetricsArgs,
): Promise<OverviewMetrics> {
  const { db } = args;
  const days = args.days ?? DEFAULT_OVERVIEW_TIMEFRAME_DAYS;
  const { from, to } = timeframeFor(days, args.now ?? new Date());

  const [signalsCapturedRow, totalAccountsRow, attentionResult] = await Promise.all([
    db
      .select({ value: count() })
      .from(observations)
      .where(and(gte(observations.importedAt, from), lte(observations.importedAt, to))),
    db.select({ value: count() }).from(accounts),
    listAccounts({ db, limit: 1, offset: 0, needsAttention: true }),
  ]);

  return {
    timeframe: {
      days,
      from: from.toISOString(),
      to: to.toISOString(),
    },
    signalsCaptured: Number(signalsCapturedRow[0]?.value ?? 0),
    accountsNeedingAttention: attentionResult.total,
    totalAccounts: Number(totalAccountsRow[0]?.value ?? 0),
  };
}
