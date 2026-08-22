// LS3 — Live Shell Closure: canonical Overview metrics strip. Replaces
// the former signal-pulse.tsx, which computed counts from legacy Google
// Sheets queue rows grouped by output type. This component renders only
// direct canonical aggregates from GET /internal/overview/metrics — no
// scoring, no recommendation grouping, no sample fallback. Each label
// below states exactly what its number measures; see
// ../lib/overview-metrics-api.ts and
// ../../api-server/src/services/overviewMetrics.ts for the exact
// definitions.
//
// LS5 terminology correction: the "Observations captured" stat label
// below reads from `metrics.signalsCaptured` — the API field name is
// deliberately left unchanged (no API churn), but the count is a raw
// canonical `observations` ROW count (every provider, every
// observationClass), not a count of distinct external events. "Signals
// captured" was retired as user-facing copy because it implied one row
// = one meaningful external occurrence, which is not true across every
// provider (see overviewMetrics.ts's own comment for why).
//
// LS7 — restyled from a horizontal pill/chip row into a compact stat
// grid: the number is the primary scan target (large, bold), the label
// is secondary (small, muted) — the same hierarchy convention ZoomInfo-
// style operational dashboards use for headline counts. DefinitionHint
// added only where the term genuinely benefits from it (observations
// captured/accounts needing attention); "Total accounts" needs none.

import { InlineNotice } from "@/components/inline-notice";
import { Button } from "@/components/ui/button";
import { DefinitionHint } from "@/components/definition-hint";
import type { OverviewMetrics } from "@/lib/overview-metrics-api";
import type { DefinitionKey } from "@/lib/definitions";

export interface OverviewMetricsStripProps {
  metrics: OverviewMetrics | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function OverviewMetricsStrip({
  metrics,
  isLoading,
  isError,
  onRetry,
}: OverviewMetricsStripProps) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">
        Overview metrics
      </p>

      {isError && (
        <InlineNotice tone="warning" className="mt-3">
          <div className="space-y-1.5">
            <p>Overview metrics could not be loaded.</p>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </InlineNotice>
      )}

      {!isError && (isLoading || !metrics) ? (
        <div className="mt-3 grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-11 w-full animate-pulse rounded-md bg-muted/60" />
          ))}
        </div>
      ) : (
        !isError &&
        metrics && (
          <div className="mt-3 grid grid-cols-3 divide-x divide-border">
            <StatBlock
              value={metrics.signalsCaptured}
              label="Observations captured"
              hint="observations_captured"
              sublabel={`Last ${metrics.timeframe.days} calendar days`}
            />
            <StatBlock
              value={metrics.accountsNeedingAttention}
              label="Accounts needing attention"
              hint="accounts_needing_attention"
            />
            <StatBlock value={metrics.totalAccounts} label="Total accounts" />
          </div>
        )
      )}
    </div>
  );
}

function StatBlock({
  value,
  label,
  sublabel,
  hint,
}: {
  value: number;
  label: string;
  sublabel?: string;
  hint?: DefinitionKey;
}) {
  return (
    <div className="min-w-0 px-4 first:pl-0 last:pr-0">
      <p className="text-2xl font-semibold tabular-nums text-foreground leading-none">{value}</p>
      <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {hint && <DefinitionHint term={hint} />}
      </p>
      {sublabel && <p className="mt-0.5 text-[10px] text-muted-foreground/60">{sublabel}</p>}
    </div>
  );
}
