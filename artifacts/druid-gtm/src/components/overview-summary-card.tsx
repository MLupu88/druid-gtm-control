// LS6 — Live Shell Closure: the compact "AI Summary" card. Deliberately
// NOT a chatbot — no freeform prompt box, no chat history, no Account
// Brain controls. This renders exactly the grounded, factual digest
// GET /api/internal/overview/summary returns (see
// ../../api-server/src/services/overviewSummary.ts for the grounding/
// forbidden-language guarantee behind it) — this component does no
// interpretation of its own, it just displays the sentence(s) and an
// honest loading/unavailable state. AI failure never breaks the rest of
// Overview: this card fails independently of metrics/charts/activity/
// needs-attention, all of which use their own separate queries.

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/inline-notice";
import { Skeleton } from "@/components/ui/skeleton";
import type { OverviewSummary } from "@/lib/overview-summary-api";

export interface OverviewSummaryCardProps {
  summary: OverviewSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function OverviewSummaryCard({ summary, isLoading, isError, onRetry }: OverviewSummaryCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">AI Summary</p>

      {isLoading && !isError && (
        <div className="space-y-1.5 pt-0.5">
          <Skeleton className="h-3.5 w-full rounded" />
          <Skeleton className="h-3.5 w-11/12 rounded" />
          <Skeleton className="h-3.5 w-2/3 rounded" />
        </div>
      )}

      {isError && (
        <InlineNotice tone="warning">
          <div className="space-y-1.5">
            <p>AI Summary is currently unavailable.</p>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </InlineNotice>
      )}

      {!isLoading && !isError && summary && (
        <p className="text-sm text-foreground leading-relaxed">{summary.summary}</p>
      )}
    </div>
  );
}
