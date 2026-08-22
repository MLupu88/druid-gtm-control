import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { InlineNotice } from "@/components/inline-notice";
import { PageToolbar } from "@/components/page-layout";
import { StatusBadge } from "@/components/status-badge";
import { DefinitionHint } from "@/components/definition-hint";
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
  accountDecisionLabel,
  formatAccountListDate,
} from "@/lib/accounts-presentation";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Building2,
  Search,
} from "lucide-react";

export function NeedsAttentionView() {
  return <CanonicalNeedsAttentionView />;
}

function CanonicalNeedsAttentionView() {
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
        <CanonicalEmptyState hasItems={false} hasSearch={false} />
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
                <TableHead className="w-[34%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em]">
                  <span className="inline-flex items-center gap-1">
                    Why attention
                    <DefinitionHint term="accounts_needing_attention" />
                  </span>
                </TableHead>
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

function CanonicalEmptyState({
  hasItems,
  hasSearch,
}: {
  hasItems: boolean;
  hasSearch: boolean;
}) {
  if (!hasItems) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No accounts need attention right now.</EmptyTitle>
          <EmptyDescription>Accounts with open attention items will appear here.</EmptyDescription>
        </EmptyHeader>
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

