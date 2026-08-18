import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  MOCK_ACCOUNT_QUEUE,
  OUTPUT_TYPE_LABELS,
  countUnresolvedRows,
  firstValidNumber,
} from "@workspace/gtm-shared";
import { AccountDetailSheet } from "@/components/account-detail-sheet";
import { OutputTypeBadge } from "@/components/output-type-badge";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ACCOUNTS_LIST_MAX_LIMIT,
  accountsListQueryKey,
  fetchAccounts,
  type AccountListItem,
} from "@/lib/accounts-api";
import {
  filterCanonicalNeedsAttentionItems,
  formatAttentionDate,
  formatAttentionReason,
  needsAttentionAccountIdentity,
} from "@/lib/needs-attention-view-model";
import {
  blockReasonText,
  type OutputTypeKey,
  type Row,
  rowIdentityLabel,
  rowNeedsReview,
  rowOutputType,
  safeWhyNow,
} from "@/lib/queue-helpers";
import { useSampleMode } from "@/lib/sample-mode";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Filter,
  Info,
  Search,
} from "lucide-react";

interface ConfigResponse {
  config: Record<string, string>;
}

type FilterType = "all" | "attention" | "mql_ready" | OutputTypeKey;

const SAMPLE_ROWS: Row[] = (
  MOCK_ACCOUNT_QUEUE as unknown as Record<string, unknown>[]
).map(
  (row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, String(value ?? "")]),
    ) as Row,
);
const SAMPLE_SOURCE = "account_queue";

export function NeedsAttentionView() {
  const { viewMode, setViewMode } = useSampleMode();

  return viewMode === "sample" ? (
    <SampleNeedsAttentionView onViewModeChange={setViewMode} />
  ) : (
    <CanonicalNeedsAttentionView onViewModeChange={setViewMode} />
  );
}

function CanonicalNeedsAttentionView({
  onViewModeChange,
}: {
  onViewModeChange: (mode: "live" | "sample") => void;
}) {
  const [search, setSearch] = useState("");
  const queryArgs = {
    limit: ACCOUNTS_LIST_MAX_LIMIT,
    offset: 0,
    needsAttention: true,
  } as const;
  const accountsQ = useQuery({
    queryKey: accountsListQueryKey(queryArgs),
    queryFn: () => fetchAccounts(queryArgs),
    staleTime: 30_000,
    // Account decisions are recorded on the canonical account-detail page.
    // Returning here remounts this view and must re-read canonical attention
    // membership rather than trusting the cached pre-action page.
    refetchOnMount: "always",
  });

  const items = accountsQ.data?.items ?? [];
  const visibleItems = useMemo(
    () => filterCanonicalNeedsAttentionItems(items, search),
    [items, search],
  );
  const total = accountsQ.data?.pagination.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {accountsQ.isLoading
            ? "Loading…"
            : `${total} account${total !== 1 ? "s" : ""} with open attention items`}
        </p>
        <ViewModeToggle viewMode="live" onChange={onViewModeChange} />
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-muted/10">
        <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p className="font-medium text-foreground/80 text-sm">What this list shows</p>
          <p>
            These canonical accounts have one or more open attention items. Account decisions do
            not remove an account from this list; it leaves only after the backend reports that no
            open attention item remains.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, domain, or account key…"
          className="pl-9 h-10 bg-input border-border text-sm"
        />
      </div>

      {/* The former Live chips depended on Sheet-only recommendation and
          review-state fields. The canonical accounts contract does not
          expose equivalent semantics, so Live keeps the same canonical
          identity search as All Accounts without fabricating replacements. */}

      {accountsQ.isLoading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {accountsQ.isError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">
            {accountsQ.error instanceof Error
              ? accountsQ.error.message
              : "Could not load accounts needing attention."}
          </p>
        </div>
      )}

      {!accountsQ.isLoading && !accountsQ.isError && items.length === 0 && (
        <CanonicalEmptyState
          hasItems={false}
          hasSearch={false}
          onViewSample={() => onViewModeChange("sample")}
        />
      )}

      {!accountsQ.isLoading &&
        !accountsQ.isError &&
        items.length > 0 &&
        visibleItems.length === 0 && (
          <CanonicalEmptyState hasItems hasSearch />
        )}

      {visibleItems.length > 0 && (
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <CanonicalAttentionRow key={item.account.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function CanonicalAttentionRow({ item }: { item: AccountListItem }) {
  const identity = needsAttentionAccountIdentity(item.account);
  const attention = item.attention;

  return (
    <Link href={`/accounts/${item.account.id}?from=attention`}>
      <div className="w-full text-left rounded-xl border border-border bg-card hover:bg-white/[0.03] transition-colors px-4 py-4 group cursor-pointer">
        <div className="flex items-start gap-3">
          <Building2 className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{identity.primary}</span>
              {identity.secondary && (
                <span className="text-xs text-muted-foreground">{identity.secondary}</span>
              )}
              {attention && (
                <Badge className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/50 rounded-full">
                  {attention.openCount} open
                </Badge>
              )}
            </div>

            {attention && (
              <div className="mt-2 space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Oldest open item: {formatAttentionDate(attention.oldestOpenAttentionAt)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {attention.reasonCodes.map((reasonCode) => (
                    <Badge
                      key={reasonCode}
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 border-border text-muted-foreground"
                    >
                      {formatAttentionReason(reasonCode)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </Link>
  );
}

function SampleNeedsAttentionView({
  onViewModeChange,
}: {
  onViewModeChange: (mode: "live" | "sample") => void;
}) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("attention");
  const configQ = useQuery<ConfigResponse>({
    queryKey: ["sheets", "config"],
    queryFn: () =>
      fetch("/api/sheets/config", { credentials: "include" }).then(
        (response) => response.json(),
      ) as Promise<ConfigResponse>,
    staleTime: 30_000,
  });

  const source = SAMPLE_SOURCE;
  const rows = SAMPLE_ROWS;
  const unresolvedCount = useMemo(
    () => countUnresolvedRows(rows, source),
    [rows, source],
  );
  const presentTypes = useMemo(() => {
    const types = new Set<OutputTypeKey>();
    for (const row of rows) types.add(rowOutputType(row, source));
    return Array.from(types);
  }, [rows, source]);
  const isMqlReady = (row: Row) => rowOutputType(row, source) === "MQL";
  const filteredRows = useMemo(() => {
    let result = rows;
    if (filter === "attention") {
      result = result.filter((row) => rowNeedsReview(row, source));
    } else if (filter === "mql_ready") {
      result = result.filter(isMqlReady);
    } else if (filter !== "all") {
      result = result.filter((row) => rowOutputType(row, source) === filter);
    }
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (row) =>
          row.company_name?.toLowerCase().includes(query) ||
          row.company_domain?.toLowerCase().includes(query) ||
          row.contact_name?.toLowerCase().includes(query) ||
          row.contact_email?.toLowerCase().includes(query),
      );
    }
    return result;
  }, [rows, source, filter, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {unresolvedCount} sample signal{unresolvedCount !== 1 ? "s" : ""} — not from the live
          review list
        </p>
        <ViewModeToggle viewMode="sample" onChange={onViewModeChange} />
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Sample data — these are example signals to illustrate the full review workflow. Actions
          are shown for demonstration only and will not be sent. Switch to Live data to review real
          signals.
        </span>
      </div>

      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-muted/10">
        <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p className="font-medium text-foreground/80 text-sm">What this list shows</p>
          <p>
            Each row is an account or buying signal the GTM engine thinks may need action. The
            colored label on the left is the recommendation. The score is secondary — use the
            recommendation, the reason, and whether we are allowed to act to make the call.
          </p>
          <p className="text-blue-300/80">
            These are sample signals so stakeholders can understand the workflow. No action will
            be sent.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by company or contact…"
          className="pl-9 h-10 bg-input border-border text-sm"
        />
      </div>

      <div className="space-y-2">
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed px-0.5">
          Start with the recommendation on the left. The score helps explain priority, but the
          decision should be based on the recommendation, the reason, and whether we are allowed to
          act.
        </p>

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
            count={unresolvedCount}
            onClick={() => setFilter("attention")}
          />
          <FilterChip
            label="MQL / Ready for Sales"
            active={filter === "mql_ready"}
            count={rows.filter(isMqlReady).length}
            onClick={() => setFilter("mql_ready")}
          />
          {presentTypes
            .filter((type) => type !== "MQL" && type !== "Sales Review")
            .map((type) => (
              <FilterChip
                key={type}
                label={OUTPUT_TYPE_LABELS[type].label}
                active={filter === type}
                count={rows.filter((row) => rowOutputType(row, source) === type).length}
                onClick={() => setFilter(type)}
              />
            ))}
        </div>
      </div>

      {filter === "mql_ready" && (
        <p className="text-xs text-muted-foreground px-1">
          Showing accounts that are ready for sales action now.
        </p>
      )}

      {filteredRows.length === 0 ? (
        <EmptyState
          hasRows={rows.length > 0}
          hasFilter={filter !== "all" || !!search.trim()}
          showAttentionEmpty={filter === "attention" && !search.trim()}
          isSampleMode
        />
      ) : (
        <div className="space-y-2">
          {filteredRows.map((row, index) => (
            <SampleQueueRow
              key={row.queue_key ?? row.account_key ?? String(index)}
              row={row}
              source={source}
              onClick={() => setSelected(row)}
            />
          ))}
        </div>
      )}

      {selected && (
        <AccountDetailSheet
          row={selected}
          source={source}
          config={configQ.data?.config ?? {}}
          canonicalAccountId={null}
          open
          onClose={() => setSelected(null)}
          previewOnly
          onAction={() => setSelected(null)}
        />
      )}
    </div>
  );
}

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
        <span className={cn("ml-1.5", active ? "text-primary/70" : "text-muted-foreground/60")}>
          {count}
        </span>
      )}
    </button>
  );
}

function SampleQueueRow({
  row,
  source,
  onClick,
}: {
  row: Row;
  source: string;
  onClick: () => void;
}) {
  const outputType = rowOutputType(row, source);
  const identityLabel = rowIdentityLabel(row, source);
  const whyNow = safeWhyNow(row);
  const needsAttention = rowNeedsReview(row, source);
  const blockReason = row.block_reason ? blockReasonText(row.block_reason) : null;
  const score = firstValidNumber(row.account_score, row.total_score);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card hover:bg-white/[0.03] transition-colors px-4 py-4 group"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5 w-36 text-left">
          <OutputTypeBadge outputType={outputType} showSub />
          {score !== null && (
            <span className="text-[10px] text-muted-foreground/50 mt-1 block pl-0.5 tabular-nums">
              Score: {score}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              {row.company_name || row.company_domain}
            </span>
            {row.company_domain && row.company_name && (
              <span className="text-xs text-muted-foreground">{row.company_domain}</span>
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
            {needsAttention && (
              <Badge
                className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/50 rounded-full"
                title="Needs review: no human decision has been recorded yet"
              >
                Needs review
              </Badge>
            )}
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 text-amber-400 border-amber-500/30 bg-amber-500/10"
              title="Sample data: example signal — no action will be sent"
            >
              Sample data
            </Badge>
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

function CanonicalEmptyState({
  hasItems,
  hasSearch,
  onViewSample,
}: {
  hasItems: boolean;
  hasSearch: boolean;
  onViewSample?: () => void;
}) {
  if (!hasItems) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          No accounts need attention right now.
        </p>
        <p className="text-xs text-muted-foreground">
          Accounts with open attention items will appear here.
        </p>
        {onViewSample && (
          <Button size="sm" variant="outline" onClick={onViewSample} className="text-xs mt-4">
            View sample workflow
          </Button>
        )}
      </div>
    );
  }
  if (hasSearch) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No accounts match that search. Try clearing it.
        </p>
      </div>
    );
  }
  return null;
}

function EmptyState({
  hasRows,
  hasFilter,
  showAttentionEmpty,
  isSampleMode,
  onViewSample,
}: {
  hasRows: boolean;
  hasFilter: boolean;
  showAttentionEmpty?: boolean;
  isSampleMode?: boolean;
  onViewSample?: () => void;
}) {
  if (!hasRows || showAttentionEmpty) {
    return (
      <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          No signals need review right now.
        </p>
        <p className="text-xs text-muted-foreground">
          {hasRows
            ? "Everything in the queue has been actioned — nothing is waiting for a decision."
            : "When the GTM engine finds signals that need a decision, they will appear here."}
        </p>
        {!hasRows && !isSampleMode && onViewSample && (
          <Button size="sm" variant="outline" onClick={onViewSample} className="text-xs mt-4">
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
