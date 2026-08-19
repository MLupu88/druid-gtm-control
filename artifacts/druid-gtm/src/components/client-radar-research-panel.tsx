import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink, Info } from "lucide-react";
import {
  fetchLatestClientRadarResearchRun,
  startClientRadarResearch,
  refreshClientRadarResearchRun,
  clientRadarResearchRunQueryKey,
  ClientRadarResearchApiError,
  type ClientRadarResearchRun,
  type ClientRadarAccountPayload,
  type ClientRadarEvidenceItem,
} from "@/lib/client-radar-research-api";
import { describeClientRadarFailure } from "@/lib/client-radar-error-presentation";
import { cn } from "@/lib/utils";
import { TechnicalDetails } from "@/components/technical-details";

// Two-column "findings" fields (short values) vs full-width "narrative"
// fields (longer free text) — mirrors account-detail.tsx's own split
// between its compact MetaField grid and separate prose blocks.
// Deliberately excludes accountPayload.status (Client Radar's own
// internal status string — distinct from this run's own status) and
// accountPayload.sources (undefined JSON shape) — neither is rendered
// anywhere in this component.
type AccountPayloadTextKey =
  | "opportunity_type"
  | "ai_maturity"
  | "signal_confidence"
  | "value_hook"
  | "matched_use_case"
  | "target_persona"
  | "detected_stack"
  | "druid_fit_hypothesis"
  | "derived_fit"
  | "caveat";

const FINDINGS_FIELDS: { key: AccountPayloadTextKey; label: string }[] = [
  { key: "opportunity_type", label: "Opportunity type" },
  { key: "ai_maturity", label: "AI maturity" },
  { key: "signal_confidence", label: "Signal confidence" },
  { key: "derived_fit", label: "Derived fit" },
];

const NARRATIVE_FIELDS: { key: AccountPayloadTextKey; label: string }[] = [
  { key: "value_hook", label: "Value hook" },
  { key: "matched_use_case", label: "Matched use case" },
  { key: "target_persona", label: "Target persona" },
  { key: "detected_stack", label: "Detected stack" },
  { key: "druid_fit_hypothesis", label: "DRUID fit hypothesis" },
  { key: "caveat", label: "Caveat" },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function describeMutationError(err: unknown, fallback: string): string {
  if (err instanceof ClientRadarResearchApiError) {
    return err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

// "not_configured" gets its own neutral label/variant entirely distinct
// from "Failed" — an unconfigured environment is not a failure of
// anything that was actually attempted, so it must never share the red
// destructive badge with a genuine runtime failure.
function statusLabel(
  status: ClientRadarResearchRun["status"],
  failureReason: ClientRadarResearchRun["failureReason"],
): string {
  if (status === "failed" && failureReason === "not_configured") return "Unavailable";
  switch (status) {
    case "submitting":
      return "Submitting";
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function statusBadgeVariant(
  status: ClientRadarResearchRun["status"],
  failureReason: ClientRadarResearchRun["failureReason"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" && failureReason === "not_configured") return "secondary";
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "cancelled":
      return "outline";
    default:
      return "secondary";
  }
}

function StatusBadge({ run }: { run: ClientRadarResearchRun }) {
  return (
    <Badge variant={statusBadgeVariant(run.status, run.failureReason)}>
      {statusLabel(run.status, run.failureReason)}
    </Badge>
  );
}

function InfoNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2.5"
    >
      <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
      <p className="text-xs text-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5"
    >
      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
      <p className="text-xs text-red-300 leading-relaxed">{children}</p>
    </div>
  );
}

function FindingField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{label}</p>
      <p className="text-foreground font-medium mt-0.5">
        {value ?? <span className="text-muted-foreground font-normal">Not available</span>}
      </p>
    </div>
  );
}

function NarrativeField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{label}</p>
      <p className="text-sm text-foreground leading-relaxed mt-1">
        {value ?? <span className="text-muted-foreground">Not available</span>}
      </p>
    </div>
  );
}

function EvidenceEntry({ item }: { item: ClientRadarEvidenceItem }) {
  const [expanded, setExpanded] = useState(false);
  const sourceLabel = item.source_type
    ? item.source_type.replace(/_/g, " ")
    : "Research source";
  const content = item.content ?? "No summary available.";
  const canExpand = content.length > 280;
  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {item.title ?? sourceLabel}
        </p>
        <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">
          {sourceLabel}
        </Badge>
      </div>
      <p className={cn("text-xs leading-relaxed text-muted-foreground", !expanded && canExpand && "line-clamp-4")}>
        {content}
      </p>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? "Collapse" : "Expand"}
          {expanded ? <ChevronUp className="ml-1 size-3" /> : <ChevronDown className="ml-1 size-3" />}
        </Button>
      )}
      <div className="flex items-center gap-3">
        <p className="text-[11px] text-muted-foreground/60">{formatDateTime(item.created_at)}</p>
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            View source
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function EvidenceList({ items }: { items: ClientRadarEvidenceItem[] | null }) {
  const [visibleCount, setVisibleCount] = useState(3);
  if (!items || items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No evidence was returned for this research run.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground/70">
        Showing {Math.min(visibleCount, items.length)} of {items.length} evidence items
      </p>
      {items.slice(0, visibleCount).map((item) => (
        <EvidenceEntry key={item.id} item={item} />
      ))}
      {visibleCount < items.length && (
        <Button variant="outline" size="sm" onClick={() => setVisibleCount((count) => Math.min(count + 3, items.length))}>
          Show more evidence ({items.length - visibleCount} remaining)
        </Button>
      )}
    </div>
  );
}

function AccountFindings({ payload }: { payload: ClientRadarAccountPayload }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-xs">
        {FINDINGS_FIELDS.map((field) => (
          <FindingField key={field.key} label={field.label} value={payload[field.key]} />
        ))}
      </div>
      <div className="space-y-3">
        {NARRATIVE_FIELDS.map((field) => (
          <NarrativeField key={field.key} label={field.label} value={payload[field.key]} />
        ))}
      </div>
    </div>
  );
}

// Not configured — a deployment fact, not a failed attempt. No Retry (a
// retry would fail identically until an operator configures the
// environment), no failure timestamp (nothing was actually attempted and
// failed at a point in time), no red styling.
function UnavailableResult({ run }: { run: ClientRadarResearchRun }) {
  const failure = describeClientRadarFailure(run.lastError, "failed", "not_configured");
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground leading-relaxed">{failure.primary}</p>
      {failure.technical && (
        <TechnicalDetails>
          <p className="font-mono text-[11px] text-muted-foreground/80">{failure.technical}</p>
        </TechnicalDetails>
      )}
    </div>
  );
}

function FailedOrCancelledResult({
  run,
  onRetry,
  retryPending,
}: {
  run: ClientRadarResearchRun;
  onRetry: () => void;
  retryPending: boolean;
}) {
  const failure = describeClientRadarFailure(
    run.lastError,
    run.status as "failed" | "cancelled",
    run.failureReason,
  );
  return (
    <div className="space-y-2">
      <p className="text-sm text-red-300/90 leading-relaxed">{failure.primary}</p>
      {failure.technical && (
        <TechnicalDetails>
          <p className="font-mono text-[11px] text-muted-foreground/80">{failure.technical}</p>
        </TechnicalDetails>
      )}
      <Button onClick={onRetry} disabled={retryPending}>
        {retryPending ? "Starting research…" : "Retry research"}
      </Button>
      <p className="text-[11px] text-muted-foreground/60">
        {run.status === "failed"
          ? run.failedAt && `Failed ${formatDateTime(run.failedAt)}`
          : `Updated ${formatDateTime(run.updatedAt)}`}
      </p>
    </div>
  );
}

function CompletedResult({ run }: { run: ClientRadarResearchRun }) {
  return (
    <div className="space-y-5">
      {run.accountPayload === null ? (
        <p className="text-sm text-muted-foreground">
          Client Radar completed this run without resolving a matching account.
        </p>
      ) : (
        <AccountFindings payload={run.accountPayload} />
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
          Evidence
        </h3>
        <EvidenceList items={run.evidencePayload} />
      </div>
    </div>
  );
}

export function ClientRadarResearchPanel({ accountId }: { accountId: string }) {
  const queryClient = useQueryClient();
  const [startError, setStartError] = useState<string | null>(null);
  const [adoptedNotice, setAdoptedNotice] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const researchQ = useQuery({
    queryKey: clientRadarResearchRunQueryKey(accountId),
    queryFn: () => fetchLatestClientRadarResearchRun(accountId),
    enabled: Boolean(accountId),
  });

  const startMutation = useMutation({
    mutationFn: () => startClientRadarResearch(accountId),
    onMutate: () => {
      setStartError(null);
    },
    onSuccess: (researchRun) => {
      queryClient.setQueryData(clientRadarResearchRunQueryKey(accountId), researchRun);
      setStartError(null);
      setRefreshError(null);
      setAdoptedNotice(false);
    },
    onError: (err) => {
      if (
        err instanceof ClientRadarResearchApiError &&
        err.code === "active_research_run_exists" &&
        err.existingRun
      ) {
        queryClient.setQueryData(
          clientRadarResearchRunQueryKey(accountId),
          err.existingRun,
        );
        setStartError(null);
        setRefreshError(null);
        setAdoptedNotice(true);
        return;
      }
      setAdoptedNotice(false);
      setStartError(describeMutationError(err, "Could not start Client Radar research."));
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (researchRunId: string) => refreshClientRadarResearchRun(researchRunId),
    onMutate: () => {
      setRefreshError(null);
    },
    onSuccess: (researchRun) => {
      queryClient.setQueryData(clientRadarResearchRunQueryKey(accountId), researchRun);
      setRefreshError(null);
      setStartError(null);
      setAdoptedNotice(false);
    },
    onError: (err) => {
      setRefreshError(
        describeMutationError(err, "Could not refresh Client Radar research."),
      );
    },
  });

  const run = researchQ.data;

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Client Radar research
        </CardTitle>
        {run && <StatusBadge run={run} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {researchQ.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="h-9 w-48 rounded-md" />
          </div>
        )}

        {researchQ.isError && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">
              {researchQ.error instanceof Error
                ? researchQ.error.message
                : "Could not load Client Radar research."}
            </p>
          </div>
        )}

        {!researchQ.isLoading && !researchQ.isError && run === null && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              No research has been run for this account yet.
            </p>
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20 disabled:opacity-50"
            >
              {startMutation.isPending ? "Starting research…" : "Research with Client Radar"}
            </Button>
          </div>
        )}

        {run && run.status === "submitting" && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Waiting for Client Radar to accept the research request…
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              {formatDateTime(run.submittedAt ?? run.createdAt)}
            </p>
          </div>
        )}

        {run && (run.status === "queued" || run.status === "running") && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {run.status === "queued"
                ? "Client Radar has queued this research request."
                : "Client Radar is actively researching this account."}
            </p>
            <Button
              variant="outline"
              onClick={() => refreshMutation.mutate(run.id)}
              disabled={refreshMutation.isPending}
            >
              {refreshMutation.isPending ? "Checking…" : "Check status"}
            </Button>
            {(run.submittedAt || run.lastPolledAt) && (
              <p className="text-[11px] text-muted-foreground/60">
                {run.submittedAt && `Submitted ${formatDateTime(run.submittedAt)}`}
                {run.submittedAt && run.lastPolledAt && " · "}
                {run.lastPolledAt && `Last checked ${formatDateTime(run.lastPolledAt)}`}
              </p>
            )}
          </div>
        )}

        {run && run.status === "failed" && run.failureReason === "not_configured" && (
          <UnavailableResult run={run} />
        )}

        {run &&
          ((run.status === "failed" && run.failureReason !== "not_configured") ||
            run.status === "cancelled") && (
            <FailedOrCancelledResult
              run={run}
              onRetry={() => startMutation.mutate()}
              retryPending={startMutation.isPending}
            />
          )}

        {run && run.status === "completed" && <CompletedResult run={run} />}

        {adoptedNotice && (
          <InfoNotice>
            An active research run was already in progress for this account — showing its
            current status.
          </InfoNotice>
        )}
        {startError && <ErrorNotice>{startError}</ErrorNotice>}
        {refreshError && <ErrorNotice>{refreshError}</ErrorNotice>}
      </CardContent>
    </Card>
  );
}
