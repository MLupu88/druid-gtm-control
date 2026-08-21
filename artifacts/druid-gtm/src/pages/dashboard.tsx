import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  STATUS_LABELS_V3,
  STATUS_FALLBACK_LABEL,
  ACTION_LOG_QUERY_KEY,
} from "@workspace/gtm-shared";
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

interface ActionLogResponse {
  rows: Record<string, string>[];
  usingSampleData: boolean;
}

// A small, fixed preview — the full searchable/filterable/paginated
// experience lives under Accounts (?view=attention); Overview is
// deliberately not a second implementation of it.
const NEEDS_ATTENTION_PREVIEW_LIMIT = 6;

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

  const actionLogQ = useQuery<ActionLogResponse>({
    queryKey: ACTION_LOG_QUERY_KEY,
    queryFn: () =>
      fetch("/api/sheets/action-log", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<ActionLogResponse>,
    staleTime: 30_000,
  });

  const activityRows = actionLogQ.data?.rows ?? [];
  const activityLoading = actionLogQ.isLoading;

  return (
    <PageLayout className="space-y-6">
      <PageHeader
        title="DRUID Signals overview"
        description="See what the GTM signal engine is finding, what needs attention, and what is only being logged for now."
      />

      {/* Overview metrics — canonical, Postgres-only (LS3) */}
      <OverviewMetricsStrip
        metrics={overviewMetricsQ.data}
        isLoading={overviewMetricsQ.isLoading}
        isError={overviewMetricsQ.isError}
        onRetry={() => void overviewMetricsQ.refetch()}
      />

      {/* Needs your attention — canonical, Postgres-only (LS3) */}
      <div>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
              Needs your attention
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
          <div className="space-y-2">
            {needsAttentionQ.data!.items.map((item) => (
              <NeedsAttentionPreviewRow key={item.account.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
          Recent activity
        </h2>
        {activityLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : activityRows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No recent actions yet.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activityRows.slice(0, 6).map((row, i) => (
              <ActivityItem key={i} row={row} />
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// ─── Activity item from action log ───────────────────────────────────────────
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

function ActivityItem({ row }: { row: Record<string, string> }) {
  const company = row.company_name || row.company_domain || "Unknown account";
  const rawStatus =
    row.final_status ||
    row.action ||
    row.action_type ||
    row.status ||
    "";
  const statusLabel =
    STATUS_LABELS_V3[rawStatus as keyof typeof STATUS_LABELS_V3];
  // Never leak a raw technical enum (e.g. an unmapped final_status) to the operator —
  // fall back to the same neutral wording the live action modal uses.
  const displayText =
    statusLabel ?? (rawStatus ? STATUS_FALLBACK_LABEL : "Action recorded");
  const ts =
    row.action_at ||
    row.approved_at ||
    row.timestamp ||
    row.created_at ||
    "";
  const by = row.approved_by || row.operator || "";

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-card">
      <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{company}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
          {displayText}
        </p>
        {(by || ts) && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {[by && `by ${by}`, ts && formatRelativeTime(ts)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Needs-attention preview row — canonical account, LS3 ────────────────────
function NeedsAttentionPreviewRow({ item }: { item: AccountListItem }) {
  const identity = needsAttentionAccountIdentity(item.account);
  const attention = item.attention;

  return (
    <Link
      href={`/accounts/${item.account.id}?from=attention`}
      className="group flex w-full items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
