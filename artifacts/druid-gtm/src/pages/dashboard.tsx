import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Clock, ArrowRight, Building2 } from "lucide-react";
import { OverviewMetricsStrip } from "@/components/overview-metrics-strip";
import { InlineNotice } from "@/components/inline-notice";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { StatusBadge } from "@/components/status-badge";
import {
  accountsListQueryKey,
  fetchAccounts,
  type AccountListItem,
} from "@/lib/accounts-api";
import {
  needsAttentionAccountIdentity,
  formatAttentionDate,
  formatAttentionReason,
} from "@/lib/needs-attention-view-model";
import {
  fetchOverviewMetrics,
  overviewMetricsQueryKey,
} from "@/lib/overview-metrics-api";
import {
  fetchGlobalActivity,
  globalActivityQueryKey,
  type GlobalActivityItem,
} from "@/lib/global-activity-api";
import {
  describeActivityEvent,
  activityAccountLabel,
} from "@/lib/global-activity-presentation";
import { fetchOverviewCharts, overviewChartsQueryKey } from "@/lib/overview-charts-api";
import { OverviewChartsSection } from "@/components/overview-charts-section";
import { fetchOverviewSummary, overviewSummaryQueryKey } from "@/lib/overview-summary-api";
import { OverviewSummaryCard } from "@/components/overview-summary-card";
import { DefinitionHint } from "@/components/definition-hint";

// A small, fixed preview — the full searchable/filterable/paginated
// experience lives under Accounts (?view=attention); Overview is
// deliberately not a second implementation of it.
const NEEDS_ATTENTION_PREVIEW_LIMIT = 6;

// Same "compact preview only" rationale as NEEDS_ATTENTION_PREVIEW_LIMIT.
const RECENT_ACTIVITY_LIMIT = 6;

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  // LS3 — canonical Overview metrics (Postgres-only, no Sheets). Replaces
  // the retired legacy queue-grouped-by-recommendation concept.
  const overviewMetricsQ = useQuery({
    queryKey: overviewMetricsQueryKey(),
    queryFn: fetchOverviewMetrics,
    staleTime: 30_000,
  });

  // LS3 — the same canonical, already-proven endpoint the Accounts page's
  // Needs Attention tab uses. Membership comes exclusively from open
  // attention_items — never rebuilt or re-derived here.
  const needsAttentionQueryArgs = {
    limit: NEEDS_ATTENTION_PREVIEW_LIMIT,
    offset: 0,
    needsAttention: true,
  } as const;
  const needsAttentionQ = useQuery({
    queryKey: accountsListQueryKey(needsAttentionQueryArgs),
    queryFn: () => fetchAccounts(needsAttentionQueryArgs),
    staleTime: 30_000,
  });

  // LS4 — canonical, cross-account Recent Activity (Postgres-only, no
  // Sheets). Reuses the exact same account-binding rule the Account
  // Workspace's own Activity panel uses (see
  // ../../api-server/src/services/accountActivity.ts's
  // getGlobalRecentActivity), just across every account at once.
  const globalActivityQ = useQuery({
    queryKey: globalActivityQueryKey(RECENT_ACTIVITY_LIMIT),
    queryFn: () => fetchGlobalActivity(RECENT_ACTIVITY_LIMIT),
    staleTime: 30_000,
  });

  // LS5 — canonical Overview charts (Postgres-only, no Sheets). Same
  // 7-day/importedAt window as signalsCaptured above.
  const overviewChartsQ = useQuery({
    queryKey: overviewChartsQueryKey(),
    queryFn: fetchOverviewCharts,
    staleTime: 30_000,
  });

  // LS6 — grounded, factual AI Summary (Postgres-derived facts only, no
  // Sheets). Cached server-side for several minutes — see
  // ../../api-server/src/routes/overview.ts's SUMMARY_CACHE_TTL_MS — so
  // this query does not need an aggressive staleTime of its own.
  const overviewSummaryQ = useQuery({
    queryKey: overviewSummaryQueryKey(),
    queryFn: fetchOverviewSummary,
    staleTime: 60_000,
  });

  return (
    <PageLayout className="space-y-5">
      <PageHeader
        title="Overview"
        description="A factual snapshot of canonical observation activity, accounts needing attention, and recent account activity."
      />

      {/* AI Summary — grounded, factual digest (LS6) */}
      <OverviewSummaryCard
        summary={overviewSummaryQ.data}
        isLoading={overviewSummaryQ.isLoading}
        isError={overviewSummaryQ.isError}
        onRetry={() => void overviewSummaryQ.refetch()}
      />

      {/* Overview metrics — canonical, Postgres-only (LS3) */}
      <OverviewMetricsStrip
        metrics={overviewMetricsQ.data}
        isLoading={overviewMetricsQ.isLoading}
        isError={overviewMetricsQ.isError}
        onRetry={() => void overviewMetricsQ.refetch()}
      />

      {/* Observation trend charts — canonical, Postgres-only (LS5) */}
      <OverviewChartsSection
        charts={overviewChartsQ.data}
        isLoading={overviewChartsQ.isLoading}
        isError={overviewChartsQ.isError}
        onRetry={() => void overviewChartsQ.refetch()}
      />

      {/* Needs your attention — canonical, Postgres-only (LS3) */}
      <div>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary">
              Needs your attention
              <DefinitionHint term="accounts_needing_attention" />
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Canonical accounts with open attention items, oldest first.
            </p>
          </div>
          {/* Compact preview only — the full searchable/filterable
              experience (with search, filter chips, and canonical account
              linking) now lives under Accounts; this dashboard section is
              deliberately not a second full implementation of it. */}
          <Link
            href="/accounts?view=attention"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1 shrink-0 mt-0.5"
          >
            View all
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {needsAttentionQ.isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : needsAttentionQ.isError ? (
          <InlineNotice tone="danger">
            <div className="space-y-1.5">
              <p>
                {needsAttentionQ.error instanceof Error
                  ? needsAttentionQ.error.message
                  : "Could not load accounts needing attention."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => void needsAttentionQ.refetch()}
              >
                Retry
              </Button>
            </div>
          </InlineNotice>
        ) : (needsAttentionQ.data?.items.length ?? 0) === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No accounts need attention right now.</EmptyTitle>
              <EmptyDescription>
                Accounts with open attention items will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card/30">
            {needsAttentionQ.data!.items.map((item) => (
              <NeedsAttentionPreviewRow key={item.account.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Recent activity — canonical, Postgres-only (LS4) */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
          Recent activity
        </h2>
        {globalActivityQ.isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : globalActivityQ.isError ? (
          <InlineNotice tone="danger">
            <div className="space-y-1.5">
              <p>
                {globalActivityQ.error instanceof Error
                  ? globalActivityQ.error.message
                  : "Could not load recent activity."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => void globalActivityQ.refetch()}
              >
                Retry
              </Button>
            </div>
          </InlineNotice>
        ) : (globalActivityQ.data?.items.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-border bg-card px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No recent activity yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card/30">
            {globalActivityQ.data!.items.map((item) => (
              <GlobalActivityRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// ─── Recent activity row — canonical global activity item, LS4 ──────────────
function formatRelativeTime(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "";
  }
}

function GlobalActivityRow({ item }: { item: GlobalActivityItem }) {
  const account = activityAccountLabel(item);
  const description = describeActivityEvent(item);
  const when = formatRelativeTime(item.occurredAt);

  return (
    <Link
      href={`/accounts/${item.accountId}?from=activity`}
      className="flex items-start gap-3 border-b border-border px-3 py-2 transition-colors last:border-b-0 hover-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">
          {account}
          <span className="text-muted-foreground font-normal"> — {description}</span>
        </p>
        {when && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{when}</p>}
      </div>
    </Link>
  );
}

// ─── Needs-attention preview row — canonical account, LS3 ────────────────────
function NeedsAttentionPreviewRow({ item }: { item: AccountListItem }) {
  const identity = needsAttentionAccountIdentity(item.account);
  const attention = item.attention;

  return (
    <Link
      href={`/accounts/${item.account.id}?from=attention`}
      className="group flex w-full items-start gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 hover-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/60 text-muted-foreground">
        <Building2 className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{identity.primary}</span>
          {identity.secondary && (
            <span className="text-xs text-muted-foreground">{identity.secondary}</span>
          )}
          {attention && (
            <StatusBadge tone="warning" dot>
              {attention.openCount} open
            </StatusBadge>
          )}
        </div>
        {attention?.reasonCodes.length ? (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
            {attention.reasonCodes.map(formatAttentionReason).join(", ")}
          </p>
        ) : null}
        {attention && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            Oldest open: {formatAttentionDate(attention.oldestOpenAttentionAt)}
          </p>
        )}
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}
