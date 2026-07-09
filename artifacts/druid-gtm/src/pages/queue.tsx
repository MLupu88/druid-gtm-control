import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { OUTPUT_TYPE_LABELS, MOCK_ACCOUNT_QUEUE } from "@workspace/gtm-shared";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { OutputTypeBadge } from "@/components/output-type-badge";
import { AccountDetailSheet } from "@/components/account-detail-sheet";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useSampleMode } from "@/lib/sample-mode";
import {
  type Row,
  type OutputTypeKey,
  rowOutputType,
  rowNeedsReview,
  safeWhyNow,
  rowIdentityLabel,
  blockReasonText,
} from "@/lib/queue-helpers";
import { cn } from "@/lib/utils";
import { Search, AlertCircle, ArrowRight, Filter, Info } from "lucide-react";

interface ConfigResponse {
  config: Record<string, string>;
  usingSampleData: boolean;
}
interface QueueResponse {
  source: string;
  tab: string;
  rows: Row[];
  usingSampleData: boolean;
}

type FilterType = "all" | "attention" | "mql_ready" | OutputTypeKey;

// ─── Sample data ──────────────────────────────────────────────────────────────
const SAMPLE_ROWS: Row[] = (
  MOCK_ACCOUNT_QUEUE as unknown as Record<string, unknown>[]
).map(
  (r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, String(v ?? "")]),
    ) as Row,
);
const SAMPLE_SOURCE = "account_queue";

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function QueuePage() {
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const { viewMode, setViewMode } = useSampleMode();
  const isSampleMode = viewMode === "sample";

  const configQ = useQuery<ConfigResponse>({
    queryKey: ["sheets", "config"],
    queryFn: () =>
      fetch("/api/sheets/config", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<ConfigResponse>,
    staleTime: 30_000,
  });

  const queueQ = useQuery<QueueResponse>({
    queryKey: ["sheets", "queue"],
    queryFn: () =>
      fetch("/api/sheets/queue", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<QueueResponse>,
    staleTime: 30_000,
  });

  const config = configQ.data?.config ?? {};
  const liveRows = queueQ.data?.rows ?? [];
  const liveSource = queueQ.data?.source ?? "signal_queue";
  const usingSampleData = queueQ.data?.usingSampleData ?? false;

  const rows = isSampleMode ? SAMPLE_ROWS : liveRows;
  const source = isSampleMode ? SAMPLE_SOURCE : liveSource;

  const presentTypes = useMemo(() => {
    const set = new Set<OutputTypeKey>();
    for (const row of rows) set.add(rowOutputType(row, source));
    return Array.from(set);
  }, [rows, source]);

  const isMqlReady = (r: Row) => {
    const t = rowOutputType(r, source);
    return t === "MQL";
  };

  const filteredRows = useMemo(() => {
    let result = rows;
    if (filter === "attention") {
      result = result.filter((r) => rowNeedsReview(r, source));
    } else if (filter === "mql_ready") {
      result = result.filter(isMqlReady);
    } else if (filter !== "all") {
      result = result.filter((r) => rowOutputType(r, source) === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.company_name?.toLowerCase().includes(q) ||
          r.company_domain?.toLowerCase().includes(q) ||
          r.contact_name?.toLowerCase().includes(q) ||
          r.contact_email?.toLowerCase().includes(q),
      );
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, source, filter, search]);

  const loading = queueQ.isLoading;

  return (
    <div className="p-6 max-w-4xl space-y-5">
      {/* Header + view mode toggle */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
            Needs your attention
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading
              ? "Loading…"
              : isSampleMode
              ? `${rows.length} sample signal${rows.length !== 1 ? "s" : ""} — not from the live review list`
              : `${rows.length} signal${rows.length !== 1 ? "s" : ""} need review`}
          </p>
        </div>
        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Sample data banner */}
      {isSampleMode && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Sample data — these are example signals to illustrate the full review workflow. Actions
            are shown for demonstration only and will not be sent. Switch to Live data to review
            real signals.
          </span>
        </div>
      )}

      {/* Live backend sample data notice */}
      {!isSampleMode && usingSampleData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Sample data — live workbook not connected yet.</span>
        </div>
      )}

      {/* ── Orientation panel ── */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-muted/10">
        <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p className="font-medium text-foreground/80 text-sm">What this list shows</p>
          <p>
            Each row is an account or buying signal the GTM engine thinks may need action. The
            colored label on the left is the recommendation. The score is secondary — use the
            recommendation, the reason, and whether we are allowed to act to make the call.
          </p>
          {isSampleMode && (
            <p className="text-blue-300/80">
              These are sample signals so stakeholders can understand the workflow. No action will
              be sent.
            </p>
          )}
          {!isSampleMode && !loading && rows.length === 0 && (
            <p>No signals need review right now.</p>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company or contact…"
          className="pl-9 h-10 bg-input border-border text-sm"
        />
      </div>

      {/* Legend + helper text + filter chips */}
      <div className="space-y-2">
        {/* Row anatomy helper */}
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed px-0.5">
          Start with the recommendation on the left. The score helps explain priority, but the
          decision should be based on the recommendation, the reason, and whether we are allowed to
          act.
        </p>

        {/* Compact legend */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-0.5">
          {[
            { term: "Recommendation", def: "What the system thinks should happen next" },
            { term: "Identity", def: "How confident we are about who the visitor is" },
            { term: "Needs review", def: "No human decision recorded yet" },
            { term: "Sample data", def: "Example signal — no action will be sent" },
          ].map(({ term, def }) => (
            <span key={term} className="text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground/60">{term}:</span> {def}
            </span>
          ))}
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <FilterChip
            label="All"
            active={filter === "all"}
            count={rows.length}
            onClick={() => setFilter("all")}
          />
          <FilterChip
            label="Needs attention"
            active={filter === "attention"}
            count={rows.filter((r) => rowNeedsReview(r, source)).length}
            onClick={() => setFilter("attention")}
          />
          <FilterChip
            label="MQL / Ready for Sales"
            active={filter === "mql_ready"}
            count={rows.filter(isMqlReady).length}
            onClick={() => setFilter("mql_ready")}
          />
          {presentTypes
            .filter((t) => t !== "MQL" && t !== "Sales Review")
            .map((type) => (
              <FilterChip
                key={type}
                label={OUTPUT_TYPE_LABELS[type].label}
                active={filter === type}
                count={rows.filter((r) => rowOutputType(r, source) === type).length}
                onClick={() => setFilter(type)}
              />
            ))}
        </div>
      </div>

      {/* MQL filter helper */}
      {filter === "mql_ready" && !loading && (
        <p className="text-xs text-muted-foreground px-1">
          Showing accounts that are ready for sales action now.
        </p>
      )}

      {/* Row list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <EmptyState
          hasRows={rows.length > 0}
          hasFilter={filter !== "all" || !!search.trim()}
          isSampleMode={isSampleMode}
          onViewSample={() => setViewMode("sample")}
        />
      ) : (
        <div className="space-y-2">
          {filteredRows.map((row, i) => (
            <QueueRow
              key={row.queue_key ?? row.account_key ?? String(i)}
              row={row}
              source={source}
              isSampleMode={isSampleMode}
              onClick={() => setSelectedRow(row)}
            />
          ))}
        </div>
      )}

      {/* Account detail sheet */}
      {selectedRow && (
        <AccountDetailSheet
          row={selectedRow}
          source={source}
          config={config}
          open={!!selectedRow}
          onClose={() => setSelectedRow(null)}
          previewOnly={isSampleMode}
          onAction={() => {
            setSelectedRow(null);
            if (!isSampleMode) void queueQ.refetch();
          }}
        />
      )}
    </div>
  );
}

// ─── Filter chip ──────────────────────────────────────────────────────────────
function FilterChip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1 rounded-full text-xs font-medium transition-all border",
        active
          ? "bg-primary/20 text-primary border-primary/50"
          : "bg-white/5 text-muted-foreground border-border hover:bg-white/10 hover:text-foreground",
      )}
    >
      {label}
      {count > 0 && (
        <span
          className={cn(
            "ml-1.5",
            active ? "text-primary/70" : "text-muted-foreground/60",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Queue row ────────────────────────────────────────────────────────────────
function QueueRow({
  row,
  source,
  isSampleMode,
  onClick,
}: {
  row: Row;
  source: string;
  isSampleMode?: boolean;
  onClick: () => void;
}) {
  const outputType = rowOutputType(row, source);
  const identityLabel = rowIdentityLabel(row, source);
  const whyNow = safeWhyNow(row);
  const isTestRow = String(row.test_mode).toLowerCase() === "true";
  const needsAttn = rowNeedsReview(row, source);
  const blockReason = row.block_reason
    ? blockReasonText(row.block_reason)
    : null;
  const score =
    Number(row.account_score || row.total_score || 0) || null;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card hover:bg-white/[0.03] transition-colors px-4 py-4 group"
    >
      <div className="flex items-start gap-3">
        {/* Recommendation badge */}
        <div className="shrink-0 pt-0.5 w-36 text-left">
          <OutputTypeBadge outputType={outputType} showSub />
          {score !== null && (
            <span className="text-[10px] text-muted-foreground/50 mt-1 block pl-0.5 tabular-nums">
              Score: {score}
            </span>
          )}
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {row.company_name || row.company_domain}
            </span>
            {row.company_domain && row.company_name && (
              <span className="text-xs text-muted-foreground">
                {row.company_domain}
              </span>
            )}
            {identityLabel && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 border-border text-muted-foreground"
                title="Identity: how confident we are about who the visitor is"
              >
                {identityLabel.label}
              </Badge>
            )}
            {needsAttn && (
              <Badge
                className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/50 rounded-full"
                title="Needs review: no human decision has been recorded yet"
              >
                Needs review
              </Badge>
            )}
            {(isTestRow || isSampleMode) && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 text-amber-400 border-amber-500/30 bg-amber-500/10"
                title="Sample data: example signal — no action will be sent"
              >
                Sample data
              </Badge>
            )}
          </div>

          {whyNow && (
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
              {whyNow}
            </p>
          )}

          {blockReason && (
            <span className="inline-flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-full px-2 py-0.5 mt-2">
              {blockReason}
            </span>
          )}
        </div>

        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({
  hasRows,
  hasFilter,
  isSampleMode,
  onViewSample,
}: {
  hasRows: boolean;
  hasFilter: boolean;
  isSampleMode?: boolean;
  onViewSample?: () => void;
}) {
  if (!hasRows) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          No signals need review right now.
        </p>
        <p className="text-xs text-muted-foreground">
          When the GTM engine finds signals that need a decision, they will appear here.
        </p>
        {!isSampleMode && onViewSample && (
          <Button
            size="sm"
            variant="outline"
            onClick={onViewSample}
            className="text-xs mt-4"
          >
            View sample workflow
          </Button>
        )}
      </div>
    );
  }
  if (hasFilter) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No signals match that filter. Try clearing it.
        </p>
      </div>
    );
  }
  return null;
}
