import { useMemo } from "react";
import { rowOutputType, rowNeedsReview } from "@/lib/queue-helpers";
import type { Row } from "@/lib/queue-helpers";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
type PulseStatus = "Quiet" | "Building" | "Active" | "Hot";

export interface SignalPulseProps {
  rows: Row[];
  source: string;
  activityRows: Record<string, string>[];
  isSampleMode: boolean;
  isLoading?: boolean;
}

// ── Score ─────────────────────────────────────────────────────────────────────
function computePulseScore(
  rows: Row[],
  source: string,
  activityRows: Record<string, string>[],
): number {
  let score = 0;
  const validRows = rows.filter((r) => rowOutputType(r, source) !== "Suppressed");
  const accountScores: number[] = [];

  for (const row of validRows) {
    const type = rowOutputType(row, source);
    if (type === "MQL") score += 35;
    else if (type === "Sales Review") score += 15;
    if (rowNeedsReview(row, source)) score += 5;
    const raw = parseFloat(row.account_score ?? row.score ?? "");
    if (!isNaN(raw) && raw > 0) accountScores.push(raw);
  }

  if (accountScores.length > 0) {
    const avg = accountScores.reduce((a, b) => a + b, 0) / accountScores.length;
    score += Math.min(avg / 5, 20);
  }

  if (activityRows.length > 0) score += 10;
  return Math.max(0, Math.min(100, score));
}

function statusFromScore(score: number): PulseStatus {
  if (score <= 15) return "Quiet";
  if (score <= 39) return "Building";
  if (score <= 69) return "Active";
  return "Hot";
}

// ── Copy ──────────────────────────────────────────────────────────────────────
const STATUS_COPY: Record<PulseStatus, string> = {
  Quiet: "Marketplace interest is quiet right now.",
  Building: "Marketplace interest is building.",
  Active: "Marketplace interest is active.",
  Hot: "Marketplace interest is hot — review sales-ready accounts first.",
};

// ── Waveforms ─────────────────────────────────────────────────────────────────
// Each path is 800 px wide with identical first/second 400 px halves so
// translateX(0 → −400 px) creates a seamless loop.
// y=32 is the baseline in a 64 px canvas.

// Quiet: nearly flat, two tiny undulations per 400 px unit
const PATH_QUIET =
  "M0,32 L90,32 L94,27 L98,32 L250,32 L254,25 L258,32 L400,32" +
  " L490,32 L494,27 L498,32 L650,32 L654,25 L658,32 L800,32";

// Building: 3 moderate spikes per 400 px unit
const PATH_BUILDING =
  "M0,32 L55,32 L59,19 L63,32 L165,32 L169,14 L173,32 L305,32 L309,21 L313,32 L400,32" +
  " L455,32 L459,19 L463,32 L565,32 L569,14 L573,32 L705,32 L709,21 L713,32 L800,32";

// Active: 4 stronger spikes per 400 px unit, varying heights
const PATH_ACTIVE =
  "M0,32 L38,32 L42,11 L46,32 L125,32 L129,8 L133,32 L215,32 L219,13 L223,32 L325,32 L329,9 L333,32 L400,32" +
  " L438,32 L442,11 L446,32 L525,32 L529,8 L533,32 L615,32 L619,13 L623,32 L725,32 L729,9 L733,32 L800,32";

// Hot: 6 tall spikes per 400 px unit, close together
const PATH_HOT =
  "M0,32 L22,32 L26,5 L30,32 L85,32 L89,7 L93,32 L155,32 L159,5 L163,32 L225,32 L229,7 L233,32 L295,32 L299,5 L303,32 L365,32 L369,7 L373,32 L400,32" +
  " L422,32 L426,5 L430,32 L485,32 L489,7 L493,32 L555,32 L559,5 L563,32 L625,32 L629,7 L633,32 L695,32 L699,5 L703,32 L765,32 L769,7 L773,32 L800,32";

const WAVE_PATH: Record<PulseStatus, string> = {
  Quiet: PATH_QUIET,
  Building: PATH_BUILDING,
  Active: PATH_ACTIVE,
  Hot: PATH_HOT,
};

// Close each path to form a fill area (down to y=64, back to origin)
function fillPath(d: string) {
  return d + " L800,64 L0,64 Z";
}

// ── Visual config per status ───────────────────────────────────────────────────
const STROKE_WIDTH: Record<PulseStatus, number> = {
  Quiet: 1.5,
  Building: 2,
  Active: 2.5,
  Hot: 3,
};

// Animation speed in seconds (overrides CSS default via inline style)
const ANIM_SPEED: Record<PulseStatus, string> = {
  Quiet: "9s",
  Building: "6s",
  Active: "4s",
  Hot: "2.8s",
};

// Whether to apply the SVG glow filter
const USE_GLOW: Record<PulseStatus, boolean> = {
  Quiet: false,
  Building: false,
  Active: true,
  Hot: true,
};

// Tailwind text-color for the SVG (currentColor)
const WAVE_COLOR: Record<PulseStatus, string> = {
  Quiet: "text-muted-foreground/40",
  Building: "text-amber-500",
  Active: "text-primary",
  Hot: "text-primary",
};

// Label + dot
const STATUS_LABEL_COLOR: Record<PulseStatus, string> = {
  Quiet: "text-muted-foreground",
  Building: "text-amber-500",
  Active: "text-primary",
  Hot: "text-primary",
};

const STATUS_DOT: Record<PulseStatus, string> = {
  Quiet: "bg-muted-foreground/50",
  Building: "bg-amber-500",
  Active: "bg-primary",
  Hot: "bg-primary",
};

// Progress-bar fill color
const BAR_COLOR: Record<PulseStatus, string> = {
  Quiet: "bg-muted-foreground/50",
  Building: "bg-amber-500",
  Active: "bg-primary",
  Hot: "bg-primary",
};

// ── Component ─────────────────────────────────────────────────────────────────
export function SignalPulse({
  rows,
  source,
  activityRows,
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

  const pulseScore = useMemo(
    () => computePulseScore(rows, source, activityRows),
    [rows, source, activityRows],
  );

  const isLiveEmpty = !isSampleMode && !isLoading && rows.length === 0;
  const status: PulseStatus = isLiveEmpty ? "Quiet" : statusFromScore(pulseScore);
  const copy = isLiveEmpty ? "No live signals need review right now." : STATUS_COPY[status];
  const displayScore = Math.round(pulseScore);
  const linePath = WAVE_PATH[status];
  const showGlow = USE_GLOW[status];

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Signal Pulse
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug max-w-sm">
            A live-style readout of marketplace interest based on MQLs, review signals, and recent activity.
          </p>
        </div>
        {isSampleMode && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
            Sample data
          </span>
        )}
      </div>

      {/* ── Animated waveform ── */}
      <div
        className="relative h-16 overflow-hidden rounded-lg bg-muted/25"
        aria-hidden="true"
      >
        <svg
          width="800"
          height="64"
          viewBox="0 0 800 64"
          className={cn("absolute top-0 left-0 signal-pulse-wave-anim", WAVE_COLOR[status])}
          style={{ animationDuration: ANIM_SPEED[status] }}
        >
          <defs>
            {/* Gradient fill under the line */}
            <linearGradient id="sig-fill-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>

            {/* Glow filter for Active / Hot */}
            {showGlow && (
              <filter id="sig-glow" x="-10%" y="-60%" width="120%" height="220%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            )}
          </defs>

          {/* Filled area under the line */}
          <path
            d={fillPath(linePath)}
            fill="url(#sig-fill-grad)"
            stroke="none"
          />

          {/* Main signal line */}
          <path
            d={linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={STROKE_WIDTH[status]}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={showGlow ? "url(#sig-glow)" : undefined}
          />
        </svg>
      </div>

      {/* ── Interest strength bar ── */}
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
          Interest strength:
        </span>
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700", BAR_COLOR[status])}
            style={{ width: `${displayScore}%` }}
          />
        </div>
        <span className="text-[11px] font-medium text-foreground tabular-nums whitespace-nowrap shrink-0">
          {displayScore} / 100
        </span>
      </div>

      {/* ── Status + copy ── */}
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-[5px] w-2 h-2 rounded-full shrink-0", STATUS_DOT[status])} />
        <p className="text-sm text-muted-foreground">
          <span className={cn("font-semibold mr-1", STATUS_LABEL_COLOR[status])}>
            {status}.
          </span>
          {copy}
        </p>
      </div>

      {/* ── Metric pills ── */}
      {!isLoading && (
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
            <span className="text-muted-foreground">Signals captured</span>
          </span>
        </div>
      )}
    </div>
  );
}
