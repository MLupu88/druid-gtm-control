import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "wouter";
import { Card } from "@/components/ui/card";
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
import { getEvaluationSummaryIntentLabel } from "@/lib/accounts-presentation";

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
    <PageLayout className="space-y-6">
      <PageHeader
        title="Accounts"
        description={
          view === "attention"
            ? "Canonical accounts with one or more open attention items."
            : "Canonical accounts and their most recent evaluations."
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
    <div className="space-y-4">
      <PageToolbar>
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, domain, or account key…"
            className="pl-9 h-10 bg-input border-border text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
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
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
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
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <AccountRow key={item.account.id} item={item} />
          ))}
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
    <Link href={`/accounts/${account.id}`}>
      <Card className="border-border bg-card hover:bg-white/[0.03] transition-colors cursor-pointer">
        <div className="flex items-start gap-3 px-4 py-3">
          <Building2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground truncate">
                {identity.primary}
              </span>
              {identity.secondary && (
                <span className="text-xs text-muted-foreground truncate">
                  {identity.secondary}
                </span>
              )}
            </div>

            <div className="mt-1.5 space-y-1">
              {latestEvaluation ? (
                <EvaluationSummaryLine
                  label={
                    latestEvaluation.evaluationMode === "production" && !productionDiffers
                      ? "Latest evaluation (production)"
                      : "Latest evaluation"
                  }
                  summary={latestEvaluation}
                />
              ) : (
                <p className="text-xs text-muted-foreground/70">No evaluations yet</p>
              )}
              {productionDiffers && latestProductionEvaluation && (
                <EvaluationSummaryLine
                  label="Latest production evaluation"
                  summary={latestProductionEvaluation}
                />
              )}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        </div>
      </Card>
    </Link>
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
