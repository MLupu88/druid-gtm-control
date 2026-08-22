// Milestone 4B — Account Workspace Intelligence tab: the Grounded
// Account Brain "Account Understanding" panel. Composes already-
// canonical Account Truth + People + a computed factual activity
// summary (via ../lib/account-brain-api.ts's GET /brain — cheap, no
// LLM, safe on every tab load) with an explicit "Analyze this account"
// action (POST /brain/analyze — one DeepSeek call, only ever fired by a
// deliberate click, never automatically).
//
// The narrative is a DISPLAY-ONLY generated synthesis, never a stored
// fact: there is no persisted "last analyzed" state (4B has no analysis-
// run table by design — see the M4/4B design doc), so generatedAt
// describes only the analysis this component currently holds in memory;
// it reads "—" again after a reload until "Analyze" is clicked again.
//
// Existing genuine account_claims (evidence-backed conclusions, with
// full per-claim evidence disclosure) are already rendered by
// ./account-claims-panel.tsx, mounted separately below this one in
// ../pages/account-detail.tsx — this panel does not re-render them a
// second time.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineNotice } from "@/components/inline-notice";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { fetchAccountBrain, analyzeAccountBrain, accountBrainQueryKey } from "@/lib/account-brain-api";
import { resolvedTruthLines, activitySummaryLine, narrativeUnavailableCopy } from "@/lib/account-brain-presentation";
import { personDisplayName } from "@/lib/account-people-presentation";
import { formatEvidenceTimestamp } from "@/lib/account-truth-presentation";

interface AccountBrainPanelProps {
  accountId: string;
}

export function AccountBrainPanel({ accountId }: AccountBrainPanelProps) {
  const queryClient = useQueryClient();

  const brainQ = useQuery({
    queryKey: accountBrainQueryKey(accountId),
    queryFn: () => fetchAccountBrain(accountId),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeAccountBrain(accountId),
    retry: false,
    onSuccess: (result) => {
      queryClient.setQueryData(accountBrainQueryKey(accountId), result);
    },
  });

  const brain = analyzeMutation.data ?? brainQ.data ?? null;
  const truthLines = brain ? resolvedTruthLines(brain.accountTruth) : [];

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
          Account Understanding
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {brainQ.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        )}

        {brainQ.isError && (
          <InlineNotice tone="warning" title="Account understanding unavailable">
            <div className="space-y-1.5">
              <p>This account's understanding could not be loaded.</p>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => brainQ.refetch()}>
                Retry
              </Button>
            </div>
          </InlineNotice>
        )}

        {brain && (
          <>
            <section className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                What we know
              </h4>

              {truthLines.length === 0 && brain.people.length === 0 && brain.activitySummary.totalEvents === 0 ? (
                <Empty className="min-h-24 rounded-lg border border-dashed border-border bg-card/30">
                  <EmptyHeader>
                    <EmptyTitle>Nothing known yet</EmptyTitle>
                    <EmptyDescription>
                      No confirmed truth, people, or activity have been recorded for this account.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="space-y-2">
                  {truthLines.length > 0 && (
                    <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                      {truthLines.map((line) => (
                        <li key={line.label} className="flex justify-between gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-1">
                          <span className="text-muted-foreground">{line.label}</span>
                          <span className="text-right font-medium text-foreground">{line.value}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="text-xs text-muted-foreground">{activitySummaryLine(brain.activitySummary)}</p>

                  {brain.people.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {brain.people.length} {brain.people.length === 1 ? "person" : "people"} identified:{" "}
                      {brain.people.map((p) => personDisplayName(p) + (p.title ? ` (${p.title})` : "")).join(", ")}
                    </p>
                  )}

                  {brain.claims.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {brain.claims.length} structured {brain.claims.length === 1 ? "conclusion" : "conclusions"} recorded — see Claims below.
                    </p>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-2 border-t border-border/40 pt-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Short grounded synthesis
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 px-2 text-[11px]"
                  disabled={analyzeMutation.isPending}
                  onClick={() => analyzeMutation.mutate()}
                >
                  <Sparkles className="size-3" />
                  {analyzeMutation.isPending
                    ? "Analyzing…"
                    : brain.narrative
                      ? "Re-analyze this account"
                      : "Analyze this account"}
                </Button>
              </div>

              {analyzeMutation.isError && (
                <InlineNotice tone="warning" title="Analysis failed">
                  This account could not be analyzed right now.
                </InlineNotice>
              )}

              {brain.narrative && (
                <div className="space-y-1 rounded-lg border border-border/60 bg-background/40 p-2.5">
                  <p className="text-xs text-foreground">{brain.narrative.text}</p>
                  <p className="text-[10px] text-muted-foreground/60">
                    Generated {formatEvidenceTimestamp(brain.narrative.generatedAt)} from the facts above — a
                    display-only synthesis, not a stored fact.
                  </p>
                </div>
              )}

              {!brain.narrative && brain.narrativeUnavailableReason && (
                <p className="text-[11px] text-muted-foreground">
                  {narrativeUnavailableCopy(brain.narrativeUnavailableReason)}
                </p>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
