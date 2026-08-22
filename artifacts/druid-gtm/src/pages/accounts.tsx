import { useMemo, useState } from "react";
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
import { ArrowRight, Building2, Search } from "lucide-react";
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
  ACCOUNTS_LIST_MAX_LIMIT,
  type Account,
  type AccountEvaluationSummary,
  type AccountListItem,
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
type SortKey = "updated" | "name";

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
function AllAccountsList() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updated");

  const accountsQ = useQuery({
    queryKey: accountsListQueryKey({ limit: ACCOUNTS_LIST_MAX_LIMIT }),
    queryFn: () => fetchAccounts({ limit: ACCOUNTS_LIST_MAX_LIMIT }),
    staleTime: 30_000,
  });

  const items = accountsQ.data?.items ?? [];

  const visibleItems = useMemo(() => {
    let result = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (item) =>
          item.account.companyName?.toLowerCase().includes(q) ||
          item.account.companyDomain?.toLowerCase().includes(q) ||
          item.account.accountKey.toLowerCase().includes(q),
      );
    }

    const sorted = [...result];
    if (sortKey === "name") {
      sorted.sort((a, b) => {
        const nameA = (
          a.account.companyName ||
          a.account.companyDomain ||
          a.account.accountKey
        ).toLowerCase();
        const nameB = (
          b.account.companyName ||
          b.account.companyDomain ||
          b.account.accountKey
        ).toLowerCase();
        return nameA.localeCompare(nameB);
      });
    } else {
      sorted.sort(
        (a, b) =>
          new Date(b.account.updatedAt).getTime() -
          new Date(a.account.updatedAt).getTime(),
      );
    }
    return sorted;
  }, [items, search, sortKey]);

  return (
    <div className="space-y-3">
      <PageToolbar className="p-2">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, domain, or account key…"
            className="h-8 pl-9 text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {!accountsQ.isLoading && !accountsQ.isError && (
            <span className="mr-2 text-xs tabular-nums text-muted-foreground">
              {visibleItems.length} of {items.length}
            </span>
          )}
          <span className="text-xs text-muted-foreground">Sort:</span>
          <Button
            size="sm"
            variant={sortKey === "updated" ? "default" : "outline"}
            className="h-7 text-xs px-2.5"
            onClick={() => setSortKey("updated")}
          >
            Recently updated
          </Button>
          <Button
            size="sm"
            variant={sortKey === "name" ? "default" : "outline"}
            className="h-7 text-xs px-2.5"
            onClick={() => setSortKey("name")}
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

      {!accountsQ.isLoading && !accountsQ.isError && items.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No accounts yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}

      {!accountsQ.isLoading &&
        !accountsQ.isError &&
        items.length > 0 &&
        visibleItems.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No matching accounts</EmptyTitle>
              <EmptyDescription>No accounts match that search.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

      {visibleItems.length > 0 && (
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
              {visibleItems.map((item) => (
                <AccountRow key={item.account.id} item={item} />
              ))}
            </TableBody>
          </Table>
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
