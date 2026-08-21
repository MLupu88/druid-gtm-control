// LS3 — Live Shell Closure: canonical Overview metrics strip. Replaces
// the former signal-pulse.tsx, which computed counts from legacy Google
// Sheets queue rows grouped by output type. This component renders only
// direct canonical aggregates from GET /internal/overview/metrics — no
// scoring, no recommendation grouping, no sample fallback. Each label
// below states exactly what its number measures; see
// ../lib/overview-metrics-api.ts and
// ../../api-server/src/services/overviewMetrics.ts for the exact
// definitions.

import { InlineNotice } from "@/components/inline-notice";
import { Button } from "@/components/ui/button";
import type { OverviewMetrics } from "@/lib/overview-metrics-api";

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
    <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Overview metrics
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug max-w-sm">
          Canonical counts recorded by Mission Control.
        </p>
      </div>

      {isError && (
        <InlineNotice tone="warning">
          <div className="space-y-1.5">
            <p>Overview metrics could not be loaded.</p>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </InlineNotice>
      )}

      {!isError && (isLoading || !metrics) ? (
        <div className="flex items-center gap-2 flex-wrap">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block h-6 w-40 animate-pulse rounded-full bg-muted/60"
            />
          ))}
        </div>
      ) : (
        !isError &&
        metrics && (
          <div className="flex items-center gap-2 flex-wrap">
            <MetricChip
              value={metrics.signalsCaptured}
              label={`Signals captured — last ${metrics.timeframe.days} days`}
            />
            <MetricChip
              value={metrics.accountsNeedingAttention}
              label="Accounts needing attention"
            />
            <MetricChip value={metrics.totalAccounts} label="Total accounts" />
          </div>
        )
      )}
    </div>
  );
}

function MetricChip({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border border-border text-xs">
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
