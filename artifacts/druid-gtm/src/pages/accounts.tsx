import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ArrowRight, Building2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchAccounts,
  accountsListQueryKey,
  ACCOUNTS_LIST_PAGE_SIZE,
  type Account,
  type AccountEvaluationSummary,
  type AccountListItem,
  type AccountListSortKey,
} from "@/lib/accounts-api";
import { NeedsAttentionView } from "@/components/needs-attention-view";
import { InlineNotice } from "@/components/inline-notice";
import { PageHeader, PageLayout, PageToolbar } from "@/components/page-layout";
import { StatusBadge } from "@/components/status-badge";
import { DefinitionHint } from "@/components/definition-hint";
import {
  accountDecisionLabel,
  formatAccountListDate,
  getEvaluationSummaryIntentLabel,
} from "@/lib/accounts-presentation";

type View = "attention" | "all";

// Company name first, then domain, then the always-present accountKey —
// every account must render *some* identity, never a blank row.
function accountIdentity(account: Account): { primary: string; secondary: string | null } {
  if (account.companyName) {
    return { primary: account.companyName, secondary: account.companyDomain };
  }
  if (account.companyDomain) {
    return { primary: account.companyDomain, secondary: null };
  }
  return { primary: account.accountKey, secondary: null };
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// Single top-level Accounts entry point: "Needs attention" is the canonical
// open-attention-items view (with a separate preview-only Sample Mode), while
// "All accounts" is the existing canonical PostgreSQL list. Both are plain
// query-string-driven views of the same page, not separate routes, so
// /accounts?view=attention and /accounts?view=all are both directly
// linkable/bookmarkable.
export default function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view: View = searchParams.get("view") === "all" ? "all" : "attention";

  function setView(next: string) {
    setSearchParams({ view: next }, { replace: true });
  }

  return (
    <PageLayout width="wide" className="space-y-5">
      <PageHeader
        title="Accounts"
        description={
          view === "attention"
            ? "Triage canonical accounts with open attention items."
            : "Scan canonical account identity, evaluation, attention, and decision state."
        }
        actions={
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="attention">Needs attention</TabsTrigger>
              <TabsTrigger value="all">All accounts</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {view === "attention" ? <NeedsAttentionView /> : <AllAccountsList />}
    </PageLayout>
  );
}

// ─── All accounts ───────────────────────────────────────────────────────────
// Server-side search, sort, and pagination throughout — the API's
// pagination.total is always the FULL canonical population matching the
// current search/needsAttention filter, never just the current page's
// length, and every filter/sort is applied in SQL before LIMIT/OFFSET
// (see services/accounts.ts's listAccounts). There is no client-side
// re-filtering or re-sorting of an already-fetched page anywhere here —
// that would only ever operate on the 50 rows currently in view.
const SEARCH_DEBOUNCE_MS = 300;

function AllAccountsList() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<AccountListSortKey>("updated");
  const [page, setPage] = useState(0);

  // Debounce the search box so each keystroke doesn't fire its own
  // request — the query itself always runs server-side, this only
  // controls how often it's asked to.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // A new search or sort invalidates whatever page offset was in view —
  // always land back on page 1 rather than risk an out-of-range page
  // silently returning zero rows against the new filtered population.
  useEffect(() => {
    setPage(0);
  }, [search, sort]);

  const offset = page * ACCOUNTS_LIST_PAGE_SIZE;
  const queryArgs = { limit: ACCOUNTS_LIST_PAGE_SIZE, offset, search, sort } as const;
  const accountsQ = useQuery({
    queryKey: accountsListQueryKey(queryArgs),
    queryFn: () => fetchAccounts(queryArgs),
    staleTime: 30_000,
  });

  const items = accountsQ.data?.items ?? [];
  const total = accountsQ.data?.pagination.total ?? 0;
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + items.length, total);
  const hasPrevPage = page > 0;
  const hasNextPage = offset + items.length < total;

  return (
    <div className="space-y-3">
      <PageToolbar className="p-2">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by company name or domain…"
            className="h-8 pl-9 text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {!accountsQ.isLoading && !accountsQ.isError && (
            <span className="mr-2 text-xs tabular-nums text-muted-foreground">
              {total === 0 ? "0 of 0" : `${rangeStart}–${rangeEnd} of ${total}`}
            </span>
          )}
          <span className="text-xs text-muted-foreground">Sort:</span>
          <Button
            size="sm"
            variant={sort === "updated" ? "default" : "outline"}
            className="h-7 text-xs px-2.5"
            onClick={() => setSort("updated")}
          >
            Recently updated
          </Button>
          <Button
            size="sm"
            variant={sort === "name" ? "default" : "outline"}
            className="h-7 text-xs px-2.5"
            onClick={() => setSort("name")}
          >
            Company name
          </Button>
        </div>
      </PageToolbar>

      {accountsQ.isLoading && (
        <div className="overflow-hidden rounded-lg border border-border bg-card/30">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border-b border-border p-3 last:border-b-0">
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
              : "Could not load accounts."}
          </p>
        </InlineNotice>
      )}

      {!accountsQ.isLoading && !accountsQ.isError && total === 0 && search === "" && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No accounts yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}

      {!accountsQ.isLoading && !accountsQ.isError && total === 0 && search !== "" && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matching accounts</EmptyTitle>
            <EmptyDescription>No accounts match that search.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card/30">
          <Table className="table-fixed">
            <TableHeader className="bg-muted/35">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[30%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em]">Account</TableHead>
                <TableHead className="hidden w-[16%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] lg:table-cell">Domain</TableHead>
                <TableHead className="w-[38%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] sm:w-[32%]">
                  <span className="inline-flex items-center gap-1">
                    Current evaluation
                    <DefinitionHint term="icp_fit" />
                  </span>
                </TableHead>
                <TableHead className="hidden w-[14%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] sm:table-cell">
                  <span className="inline-flex items-center gap-1">
                    Attention
                    <DefinitionHint term="accounts_needing_attention" />
                  </span>
                </TableHead>
                <TableHead className="hidden w-[18%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] xl:table-cell">Latest decision</TableHead>
                <TableHead className="hidden w-[13%] px-3 text-[10px] font-semibold uppercase tracking-[0.08em] md:table-cell">Updated</TableHead>
                <TableHead className="w-10 px-2"><span className="sr-only">Inspect account</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <AccountRow key={item.account.id} item={item} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!accountsQ.isLoading && !accountsQ.isError && total > 0 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {Math.max(1, Math.ceil(total / ACCOUNTS_LIST_PAGE_SIZE))}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!hasPrevPage}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={!hasNextPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Account row ──────────────────────────────────────────────────────────────
function AccountRow({ item }: { item: AccountListItem }) {
  const { account, latestEvaluation, latestProductionEvaluation } = item;
  const identity = accountIdentity(account);

  // Only render a separate "latest production evaluation" line when it is
  // genuinely a different row than the latest evaluation overall (e.g. a
  // newer preview evaluation exists) — when they're the same row, showing
  // it twice would be redundant, not clarifying.
  const productionDiffers =
    latestProductionEvaluation !== null &&
    latestProductionEvaluation.id !== latestEvaluation?.id;

  return (
    <TableRow className="group h-[60px] hover:bg-accent/45">
      <TableCell className="px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground">
            <Building2 className="size-3.5" />
          </span>
          <div className="min-w-0">
            <Link
              href={`/accounts/${account.id}`}
              className="block truncate text-sm font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {identity.primary}
            </Link>
            <p className="truncate text-[11px] text-muted-foreground lg:hidden">
              {account.companyDomain ?? account.accountKey}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden px-3 py-2 lg:table-cell">
        <span className="block truncate text-xs text-muted-foreground">
          {account.companyDomain ?? "—"}
        </span>
      </TableCell>
      <TableCell className="px-3 py-2">
        <div className="space-y-1">
          {latestEvaluation ? (
            <EvaluationSummaryLine label="Latest" summary={latestEvaluation} />
          ) : (
            <StatusBadge tone="neutral">Not evaluated</StatusBadge>
          )}
          {productionDiffers && latestProductionEvaluation && (
            <div className="hidden xl:block">
              <EvaluationSummaryLine label="Production" summary={latestProductionEvaluation} />
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden px-3 py-2 sm:table-cell">
        {item.attention ? (
          <StatusBadge tone="warning" dot>{item.attention.openCount} open</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Clear</StatusBadge>
        )}
      </TableCell>
      <TableCell className="hidden px-3 py-2 xl:table-cell">
        {item.latestDecision ? (
          <div>
            <p className="truncate text-xs font-medium text-foreground">
              {accountDecisionLabel(item.latestDecision.routingOutput)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {formatAccountListDate(item.latestDecision.createdAt)}
            </p>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell className="hidden px-3 py-2 md:table-cell">
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatAccountListDate(account.updatedAt)}
        </span>
      </TableCell>
      <TableCell className="px-2 py-2 text-right">
        <Button asChild size="sm" variant="ghost" className="h-7 w-7 px-0">
          <Link href={`/accounts/${account.id}`} aria-label={`Inspect ${identity.primary}`}>
            <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ─── Evaluation summary line (shared by list rows and account detail) ────────
export function EvaluationSummaryLine({
  label,
  summary,
}: {
  label: string;
  summary: AccountEvaluationSummary;
}) {
  const intentLabel = getEvaluationSummaryIntentLabel(summary);
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs">
      <span className="text-muted-foreground/70">{label}:</span>
      <StatusBadge tone="neutral">
        {capitalize(summary.evaluationMode)}
      </StatusBadge>
      {summary.status === "failed" ? (
        <StatusBadge tone="danger">
          Failed
        </StatusBadge>
      ) : (
        <>
          {summary.fitTier && (
            <StatusBadge tone="neutral">
              Fit: {summary.fitTier}
            </StatusBadge>
          )}
          {intentLabel && (
            <StatusBadge tone="neutral">
              {intentLabel}
            </StatusBadge>
          )}
          {summary.eligibilityOutcome && (
            <StatusBadge
              tone={
                summary.eligibilityOutcome === "eligible"
                  ? "success"
                  : summary.eligibilityOutcome === "restricted"
                    ? "warning"
                    : "danger"
              }
            >
              {capitalize(summary.eligibilityOutcome)}
            </StatusBadge>
          )}
        </>
      )}
    </div>
  );
}
