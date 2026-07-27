import { useMemo } from "react";
import { rowOutputType } from "@/lib/queue-helpers";
import type { Row } from "@/lib/queue-helpers";

// This component previously computed a fabricated 0-100 "pulse score" and a
// Quiet/Building/Active/Hot label from a hand-picked heuristic with no relationship to any
// real scoring component, plus an animated waveform implying a calculated market-interest
// level — see product decision, 2026-07-24. It now shows ONLY real counts already computed
// elsewhere (rowOutputType), with no invented score or qualitative status of any kind.
// `activityRows` is kept in the prop signature (unused) to avoid a call-site change in
// dashboard.tsx in this PR.

export interface SignalPulseProps {
  rows: Row[];
  source: string;
  activityRows: Record<string, string>[];
  isSampleMode: boolean;
  isLoading?: boolean;
}

export function SignalPulse({
  rows,
  source,
  isSampleMode,
  isLoading = false,
}: SignalPulseProps) {
  const mqlCount = useMemo(
    () => rows.filter((r) => rowOutputType(r, source) === "MQL").length,
    [rows, source],
  );

  const worthALookCount = useMemo(
    () => rows.filter((r) => rowOutputType(r, source) === "Sales Review").length,
    [rows, source],
  );

  const totalRows = rows.length;
  const isAccountQueue = String(source).toLowerCase() === "account_queue";
  const totalLabel = isAccountQueue ? "Accounts represented" : "Signals captured";
  const isLiveEmpty = !isSampleMode && !isLoading && rows.length === 0;

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Queue Summary
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug max-w-sm">
            Counts of what's currently in the queue, by recommendation.
          </p>
        </div>
        {isSampleMode && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
            Sample data
          </span>
        )}
      </div>

      {/* ── Counts ── */}
      {isLiveEmpty ? (
        <p className="text-sm text-muted-foreground">No live signals need review right now.</p>
      ) : (
        !isLoading && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border border-border text-xs">
              <span className="font-semibold text-foreground">{mqlCount}</span>
              <span className="text-muted-foreground">MQLs / Ready for Sales</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border border-border text-xs">
              <span className="font-semibold text-foreground">{worthALookCount}</span>
              <span className="text-muted-foreground">Worth a Look</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 border border-border text-xs">
              <span className="font-semibold text-foreground">{totalRows}</span>
              <span className="text-muted-foreground">{totalLabel}</span>
            </span>
          </div>
        )
      )}
    </div>
  );
}
