// Milestone 4B — computed, never-persisted factual activity aggregation
// for one account. This is analysis METADATA (event counts, provider
// coverage, first/last observed timestamps) — per the M4/4B design
// correction, this class of fact describes Mission Control's own
// evidence-gathering state, not a semantic assertion about the account
// itself, and must never be written to account_claims. It is computed
// fresh on every read from ./accountActivity.ts's own
// getAccountBoundActivity (the exact same bound-observation set the
// Activity tab already shows — no second binding mechanism, no new
// table).

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { getAccountBoundActivity } from "./accountActivity.js";

type Db = NodePgDatabase<typeof schema>;

export interface AccountActivitySummary {
  totalEvents: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  distinctDaysObserved: number;
  providers: string[];
}

/** The calendar-day (UTC) an ISO timestamp falls on, e.g. "2026-08-20". */
function calendarDay(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Aggregates getAccountBoundActivity's full (unbounded) result into the
 * small factual summary above. Throws AccountNotFoundError (from
 * ./accountActivity.js) for an unknown account, matching every other
 * account read model's convention.
 */
export async function getAccountActivitySummary(
  db: Db,
  accountId: string,
): Promise<AccountActivitySummary> {
  const items = await getAccountBoundActivity(db, accountId);

  if (items.length === 0) {
    return {
      totalEvents: 0,
      firstObservedAt: null,
      lastObservedAt: null,
      distinctDaysObserved: 0,
      providers: [],
    };
  }

  // items is already sorted newest-first by getAccountBoundActivity.
  const lastObservedAt = items[0]!.occurredAt;
  const firstObservedAt = items[items.length - 1]!.occurredAt;
  const distinctDays = new Set(items.map((item) => calendarDay(item.occurredAt)));
  const providers = [...new Set(items.map((item) => item.provider))].sort();

  return {
    totalEvents: items.length,
    firstObservedAt,
    lastObservedAt,
    distinctDaysObserved: distinctDays.size,
    providers,
  };
}
