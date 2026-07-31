import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import {
  fetchAccountDecisions,
  accountDecisionsQueryKey,
  type AccountDecision,
} from "@/lib/account-decisions-api";

// The routing outputs this UI can create — see CreatableRoutingOutput in
// ../lib/account-decisions-api.ts. History may in principle contain other
// values (a real, non-guessed possibility per the full RoutingOutput
// enum) — those fall back to a humanized raw value rather than a blank
// label.
const ROUTING_OUTPUT_LABELS: Partial<Record<string, string>> = {
  mql: "Promote to MQL",
  sales_review: "Keep for review",
  dismissed: "Dismissed",
};

const GATE_BADGE_CLASSES: Record<string, string> = {
  actionable: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  restricted: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  blocked: "text-red-400 border-red-500/30 bg-red-500/10",
};

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function humanizeToken(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function DecisionHistory({ accountId }: { accountId: string }) {
  const historyQ = useQuery({
    queryKey: accountDecisionsQueryKey(accountId),
    queryFn: () => fetchAccountDecisions({ accountId }),
    staleTime: 10_000,
  });

  const items = historyQ.data?.items ?? [];
  const total = historyQ.data?.pagination.total ?? 0;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
          Decision history
        </h2>
        {!historyQ.isLoading && !historyQ.isError && total > 0 && (
          <span className="text-[11px] text-muted-foreground">{total} recorded</span>
        )}
      </div>

      {historyQ.isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {historyQ.isError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">
            {historyQ.error instanceof Error
              ? historyQ.error.message
              : "Could not load decision history."}
          </p>
        </div>
      )}

      {!historyQ.isLoading && !historyQ.isError && items.length === 0 && (
        <div className="rounded-xl border border-border bg-card px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map(({ decision }) => (
            <DecisionRow key={decision.id} decision={decision} />
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionRow({ decision }: { decision: AccountDecision }) {
  const routingLabel =
    ROUTING_OUTPUT_LABELS[decision.routingOutput] ?? humanizeToken(decision.routingOutput);
  const gateClasses =
    GATE_BADGE_CLASSES[decision.overallDecisionGate] ?? "text-muted-foreground border-border";

  return (
    <Card className="border-border bg-card">
      <CardContent className="px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-foreground">{routingLabel}</span>
          {/* The gate always renders here, independently of the routing
              choice above — a deliberate "Promote to MQL" recorded against
              a restricted/blocked evaluation must still show that gate,
              never be hidden or softened because the operator chose mql. */}
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${gateClasses}`}>
            Gate: {capitalize(decision.overallDecisionGate)}
          </Badge>
        </div>
        {decision.routingReason && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {decision.routingReason}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground/60">
          {formatDateTime(decision.createdAt)}
          {decision.createdBy && ` · by ${decision.createdBy}`}
        </p>
      </CardContent>
    </Card>
  );
}
