import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ENGINE_MODE_LABELS,
  OUTPUT_TYPE_LABELS,
  QUEUE_SOURCE_LABELS,
  STATUS_LABELS_V3,
  MOCK_ACCOUNT_QUEUE,
} from "@workspace/gtm-shared";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/lib/queue-helpers";
import { cn } from "@/lib/utils";
import { AlertCircle, Clock, ArrowRight } from "lucide-react";
import { SignalPulse } from "@/components/signal-pulse";

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
interface ActionLogResponse {
  rows: Record<string, string>[];
  usingSampleData: boolean;
}

const MODE_DOT: Record<string, string> = {
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-red-500",
};

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

const SAMPLE_ACTIVITY_ROWS: Record<string, string>[] = [
  {
    company_name: "Globex",
    company_domain: "globex.com",
    final_status: "approved_email_pending_tool",
    approved_by: "operator",
    action_at: "2026-06-30T09:15:00Z",
  },
  {
    company_name: "Allianz X",
    company_domain: "allianz-x.com",
    final_status: "owner_alert_logged",
    approved_by: "operator",
    action_at: "2026-06-30T08:45:00Z",
  },
  {
    company_name: "DRUID AI",
    company_domain: "druidai.com",
    final_status: "suppressed",
    approved_by: "operator",
    action_at: "2026-06-30T09:01:00Z",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
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

  const actionLogQ = useQuery<ActionLogResponse>({
    queryKey: ["sheets", "action-log"],
    queryFn: () =>
      fetch("/api/sheets/action-log", { credentials: "include" }).then(
        (r) => r.json(),
      ) as Promise<ActionLogResponse>,
    staleTime: 30_000,
    enabled: !isSampleMode,
  });

  const config = configQ.data?.config ?? {};
  const liveRows = queueQ.data?.rows ?? [];
  const liveSource = queueQ.data?.source ?? "signal_queue";
  const usingSampleData = queueQ.data?.usingSampleData ?? false;
  const configLoading = configQ.isLoading;
  const queueLoading = queueQ.isLoading;

  const rows = isSampleMode ? SAMPLE_ROWS : liveRows;
  const source = isSampleMode ? SAMPLE_SOURCE : liveSource;

  const engineModeKey = (
    config.engine_mode ?? "recommend_only"
  ) as keyof typeof ENGINE_MODE_LABELS;
  const modeMeta =
    ENGINE_MODE_LABELS[engineModeKey] ?? ENGINE_MODE_LABELS.recommend_only;

  const queueSourceKey = (
    config.queue_source ?? "signal_queue"
  ) as keyof typeof QUEUE_SOURCE_LABELS;

  const accountQueueWriteOn =
    String(config.account_queue_write ?? "off").toLowerCase() === "on";
  const usVoiceCleared =
    String(config.us_voice_cleared ?? "false").toLowerCase() === "true";

  const countsByType: Partial<Record<OutputTypeKey, number>> = {};
  for (const row of rows) {
    const t = rowOutputType(row, source);
    countsByType[t] = (countsByType[t] ?? 0) + 1;
  }

  const attentionRows = rows
    .filter((r) => rowNeedsReview(r, source))
    .slice(0, 6);

  const outputTypeOrder: OutputTypeKey[] = [
    "MQL",
    "Sales Review",
    "Pipeline Assist",
    "Owner Alert",
    "Nurture",
    "Retarget",
    "Suppressed",
  ];

  const liveActivityRows = actionLogQ.data?.rows ?? [];
  const activityRows = isSampleMode ? SAMPLE_ACTIVITY_ROWS : liveActivityRows;
  const activityLoading = !isSampleMode && actionLogQ.isLoading;

  const liveQueueEmpty = !isSampleMode && !queueLoading && liveRows.length === 0;

  // ── Human-readable state descriptions ──────────────────────────────────────
  const sendingHint =
    engineModeKey === "recommend_only"
      ? "Approvals are saved, but outreach is not sent yet."
      : engineModeKey === "live"
      ? "Approved actions are being sent."
      : "All outreach is paused.";

  const scoringHint =
    queueSourceKey === "account_queue"
      ? "All activity from the same company is grouped together."
      : "Each website visit or signal is reviewed on its own.";

  const queueWriteHint = accountQueueWriteOn
    ? "On — new review items can appear here."
    : "Off — scoring can run, but new account review items will not appear here yet.";

  const usCallingValue = usVoiceCleared
    ? "Unlocked"
    : "Locked";
  const usCallingHint = usVoiceCleared
    ? "US AI calling has been approved."
    : "AI calls to US contacts require legal approval first.";

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Header + view mode toggle */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
            Marketplace signals overview
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            See what the GTM signal engine is finding, what needs attention, and what is only being logged for now.
          </p>
        </div>
        <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Sample data banner */}
      {isSampleMode && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>
            Showing sample data — this illustrates the full workflow. Switch to Live data to see your real signals.
          </span>
        </div>
      )}

      {/* Live backend sample data badge */}
      {!isSampleMode && usingSampleData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Sample data — live workbook not connected yet.</span>
        </div>
      )}

      {/* Signal Pulse */}
      <SignalPulse
        rows={rows}
        source={source}
        activityRows={activityRows}
        isSampleMode={isSampleMode}
        isLoading={queueLoading}
      />

      {/* What is live right now? */}
      {configLoading ? (
        <Skeleton className="h-36 w-full rounded-xl" />
      ) : (
        <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            What is live right now?
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatusCard
              title="Data source"
              value={usingSampleData ? "Sample data" : "Live workbook connected"}
              description="Reading the GTM workbook."
              tone={usingSampleData ? "amber" : "green"}
            />
            <StatusCard
              title="Outreach"
              value={engineModeKey === "live" ? "Active" : engineModeKey === "paused" ? "Paused" : "Off"}
              description="Decisions can be saved, but the app will not contact anyone."
              tone={engineModeKey === "live" ? "green" : "amber"}
            />
            <StatusCard
              title="New review items"
              value={accountQueueWriteOn ? "On" : "Off"}
              description="Scoring can run, but new account review items will not appear here yet."
              tone={accountQueueWriteOn ? "green" : "amber"}
            />
            <StatusCard
              title="US AI calling"
              value={usVoiceCleared ? "Unlocked" : "Locked"}
              description="Calls to US contacts require legal approval first."
              tone={usVoiceCleared ? "green" : "amber"}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            Scoring view: {queueSourceKey === "account_queue" ? "Whole-company" : "Per-visit"} — each signal is reviewed on its own.
          </p>
        </div>
      )}

      {/* Signals to review */}
      <div>
        <div className="mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
            Signals to review
            {isSampleMode && (
              <span className="ml-2 normal-case font-normal text-muted-foreground text-[11px]">
                — sample data
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            These cards group signals by the recommendation the GTM engine made.
          </p>
        </div>
        {queueLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              No signals need review right now.
            </p>
            {!isSampleMode && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setViewMode("sample")}
                className="text-xs"
              >
                View sample workflow
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {outputTypeOrder.map((type) => {
              const count = countsByType[type] ?? 0;
              if (count === 0) return null;
              return (
                <Card key={type} className="border-border bg-card rounded-xl">
                  <CardContent className="p-4">
                    <p className="text-3xl font-bold tabular-nums text-foreground">
                      {count}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-tight">
                      {OUTPUT_TYPE_LABELS[type].label}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Needs your attention */}
      <div>
        <div className="mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
            Needs your attention
            {isSampleMode && (
              <span className="ml-2 normal-case font-normal text-muted-foreground text-[11px]">
                — sample data
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            These are the signals that still need a human decision before anything happens.
          </p>
        </div>
        {queueLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : attentionRows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {rows.length === 0
                ? "No signals need review right now."
                : "Everything in the review list has been actioned — nothing waiting for a decision."}
            </p>
            {rows.length === 0 && !isSampleMode && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setViewMode("sample")}
                className="text-xs mt-3"
              >
                View sample workflow
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {attentionRows.map((row, i) => (
              <QueueRowCard
                key={row.queue_key ?? row.account_key ?? String(i)}
                row={row}
                source={source}
                onClick={() => setSelectedRow(row)}
                isSampleMode={isSampleMode}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">
          Recent activity
          {isSampleMode && (
            <span className="ml-2 normal-case font-normal text-muted-foreground text-[11px]">
              — sample data
            </span>
          )}
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

// ─── Status card ──────────────────────────────────────────────────────────────
function StatusCard({
  title,
  value,
  description,
  tone,
}: {
  title: string;
  value: string;
  description: string;
  tone: "green" | "amber" | "red";
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-3">
      <p className="text-[11px] text-muted-foreground mb-1">{title}</p>
      <p
        className={cn(
          "text-sm font-semibold leading-tight",
          tone === "green"
            ? "text-emerald-400"
            : tone === "amber"
            ? "text-amber-400"
            : "text-red-400",
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground/60 mt-1 leading-snug">{description}</p>
    </div>
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
  const displayText =
    statusLabel ?? (rawStatus ? rawStatus : "Action recorded");
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

// ─── Inline queue row card ────────────────────────────────────────────────────
interface QueueRowCardProps {
  row: Row;
  source: string;
  onClick: () => void;
  isSampleMode?: boolean;
}

function QueueRowCard({ row, source, onClick, isSampleMode }: QueueRowCardProps) {
  const outputType = rowOutputType(row, source);
  const identityLabel = rowIdentityLabel(row, source);
  const whyNow = safeWhyNow(row);
  const isTestRow = String(row.test_mode).toLowerCase() === "true";

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card hover:bg-white/[0.03] transition-colors px-4 py-3 group"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <OutputTypeBadge outputType={outputType} />
        </div>
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
              >
                {identityLabel.label}
              </Badge>
            )}
            {(isTestRow || isSampleMode) && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 text-amber-400 border-amber-500/30 bg-amber-500/10"
              >
                Sample data
              </Badge>
            )}
          </div>
          {whyNow && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
              {whyNow}
            </p>
          )}
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
}
