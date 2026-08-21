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

import { count, gte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { accounts, observations } from "@workspace/db/schema";
import type * as schema from "@workspace/db/schema";
import { listAccounts } from "./accounts.js";

type Db = NodePgDatabase<typeof schema>;

const DEFAULT_TIMEFRAME_DAYS = 7;

export interface OverviewMetricsTimeframe {
  days: number;
  from: string;
  to: string;
}

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
   * defaulted, always present.
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

export function timeframeFor(days: number, now: Date): { from: Date; to: Date } {
  const to = now;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

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
  const days = args.days ?? DEFAULT_TIMEFRAME_DAYS;
  const { from, to } = timeframeFor(days, args.now ?? new Date());

  const [signalsCapturedRow, totalAccountsRow, attentionResult] = await Promise.all([
    db
      .select({ value: count() })
      .from(observations)
      .where(gte(observations.importedAt, from)),
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
