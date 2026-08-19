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
import { InlineNotice } from "@/components/inline-notice";
import { OutputTypeBadge } from "@/components/output-type-badge";
import { PageToolbar } from "@/components/page-layout";
import { StatusBadge } from "@/components/status-badge";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
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
import {
  accountDecisionLabel,
  formatAccountListDate,
} from "@/lib/accounts-presentation";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Building2,
  Filter,
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
    <div className="space-y-3">
      <PageToolbar className="p-2">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search accounts needing attention…"
            className="h-8 pl-9 text-xs"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {accountsQ.isLoading
              ? "Loading…"
              : `${total} account${total !== 1 ? "s" : ""}`}
          </span>
          <StatusBadge tone="warning" dot>Open attention</StatusBadge>
          <ViewModeToggle viewMode="live" onChange={onViewModeChange} />
        </div>
      </PageToolbar>

      <p className="px-1 text-[11px] leading-4 text-muted-foreground">
        Membership comes from open canonical attention items. Account decisions do not clear them.
      </p>

      {/* The former Live chips depended on Sheet-only recommendation and
          review-state fields. The canonical accounts contract does not
          expose equivalent semantics, so Live keeps the same canonical
          identity search as All Accounts without fabricating replacements. */}

      {accountsQ.isLoading && (
        <div className="overflow-hidden rounded-lg border border-border bg-card/30">
          {[...Array(5)].map((_, index) => (
            <div key={index} className="border-b border-border p-3 last:border-b-0">
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}

      {accountsQ.isError && (
        <InlineNotice tone="danger">
          <p>
            {accountsQ.error instanceof Error
              ? accountsQ.error.message
              : "Could not load accounts needing attention."}
          </p>
        </InlineNotice>
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
        <div className="overflow-hidden rounded-lg border border-border bg-card/30">
          <Table className="table-fixed">
            <TableHeader className="bg-muted/35">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[28%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em]">Account</TableHead>
                <TableHead className="w-[34%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em]">Why attention</TableHead>
                <TableHead className="hidden w-[20%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] md:table-cell">Current state</TableHead>
                <TableHead className="w-[12%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] sm:table-cell">Open</TableHead>
                <TableHead className="hidden w-[16%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] lg:table-cell">Oldest open</TableHead>
                <TableHead className="w-20 px-2"><span className="sr-only">Inspect account</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((item) => (
                <CanonicalAttentionRow key={item.account.id} item={item} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CanonicalAttentionRow({ item }: { item: AccountListItem }) {
  const identity = needsAttentionAccountIdentity(item.account);
  const attention = item.attention;

  return (
    <TableRow className="group h-[64px] hover:bg-accent/45">
      <TableCell className="px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground">
            <Building2 className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={`/accounts/${item.account.id}?from=attention`}
              className="block truncate text-sm font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {identity.primary}
            </Link>
            <p className="truncate text-[11px] text-muted-foreground">
              {identity.secondary ?? item.account.accountKey}
            </p>
            <div className="mt-1 md:hidden">
              <CanonicalAccountState item={item} compact />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {attention?.reasonCodes.length ? (
            attention.reasonCodes.map((reasonCode) => (
              <StatusBadge key={reasonCode} tone="neutral">
                {formatAttentionReason(reasonCode)}
              </StatusBadge>
            ))
          ) : attention ? (
            <span className="text-xs text-muted-foreground">Open attention item</span>
          ) : (
            <span className="text-xs text-muted-foreground">Attention summary unavailable</span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden px-3 py-2 md:table-cell">
        <CanonicalAccountState item={item} />
      </TableCell>
      <TableCell className="px-3 py-2 sm:table-cell">
        {attention ? (
          <StatusBadge tone="warning" dot>{attention.openCount}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">—</StatusBadge>
        )}
      </TableCell>
      <TableCell className="hidden px-3 py-2 lg:table-cell">
        <span className="text-xs tabular-nums text-muted-foreground">
          {attention ? formatAttentionDate(attention.oldestOpenAttentionAt) : "—"}
        </span>
      </TableCell>
      <TableCell className="px-2 py-2 text-right">
        <Button asChild size="sm" variant="ghost" className="relative z-10 h-7 px-2">
          <Link href={`/accounts/${item.account.id}?from=attention`}>
            Inspect
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CanonicalAccountState({
  item,
  compact = false,
}: {
  item: AccountListItem;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-1", compact && "flex flex-wrap items-center gap-1 space-y-0")}>
      {item.latestEvaluation ? (
        <StatusBadge tone={item.latestEvaluation.status === "failed" ? "danger" : "neutral"}>
          {item.latestEvaluation.evaluationMode === "production" ? "Production" : "Preview"}
          {item.latestEvaluation.status === "failed" ? " failed" : " evaluated"}
        </StatusBadge>
      ) : (
        <StatusBadge tone="neutral">Not evaluated</StatusBadge>
      )}
      {item.latestDecision && (
        <p className="truncate text-[10px] text-muted-foreground">
          Account decision: {accountDecisionLabel(item.latestDecision.routingOutput)} ·{" "}
          {formatAccountListDate(item.latestDecision.createdAt)}
        </p>
      )}
    </div>
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
    <div className="space-y-3">
      <PageToolbar className="p-2">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sample accounts or contacts…"
            className="h-8 pl-9 text-xs"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {unresolvedCount} sample signal{unresolvedCount !== 1 ? "s" : ""}
          </span>
          <ViewModeToggle viewMode="sample" onChange={onViewModeChange} />
        </div>
      </PageToolbar>

      <InlineNotice tone="info">
        <p>
          Sample data only. Actions are preview-only and will not be sent.
        </p>
      </InlineNotice>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card/30 p-2">
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
        <div className="overflow-hidden rounded-lg border border-border bg-card/30 divide-y divide-border">
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
        "h-7 rounded-md border px-2 text-[11px] font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/12 text-primary"
          : "border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
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
      className="group w-full px-3 py-2.5 text-left transition-colors hover:bg-accent/45"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[150px_minmax(0,1fr)_auto]">
        <div className="hidden shrink-0 text-left md:block">
          <OutputTypeBadge outputType={outputType} showSub />
          {score !== null && (
            <span className="text-[10px] text-muted-foreground/50 mt-1 block pl-0.5 tabular-nums">
              Score: {score}
            </span>
          )}
        </div>
        <div className="min-w-0">
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
              <StatusBadge
                tone="warning"
                title="Needs review: no human decision has been recorded yet"
              >
                Needs review
              </StatusBadge>
            )}
            <StatusBadge
              tone="info"
              title="Sample data: example signal — no action will be sent"
            >
              Sample data
            </StatusBadge>
            <span className="md:hidden"><OutputTypeBadge outputType={outputType} /></span>
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
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No accounts need attention right now.</EmptyTitle>
          <EmptyDescription>Accounts with open attention items will appear here.</EmptyDescription>
        </EmptyHeader>
        {onViewSample && (
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={onViewSample} className="text-xs">
              View sample workflow
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }
  if (hasSearch) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No matching accounts</EmptyTitle>
          <EmptyDescription>No accounts match that search. Try clearing it.</EmptyDescription>
        </EmptyHeader>
      </Empty>
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
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No signals need review right now.</EmptyTitle>
          <EmptyDescription>
            {hasRows
              ? "Everything in the queue has been actioned — nothing is waiting for a decision."
              : "When the GTM engine finds signals that need a decision, they will appear here."}
          </EmptyDescription>
        </EmptyHeader>
        {!hasRows && !isSampleMode && onViewSample && (
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={onViewSample} className="text-xs">
              View sample workflow
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }
  if (hasFilter) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No matching signals</EmptyTitle>
          <EmptyDescription>No signals match that filter. Try clearing it.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return null;
}
