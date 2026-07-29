import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowRight, Building2 } from "lucide-react";
import {
  fetchAccounts,
  accountsListQueryKey,
  type Account,
  type AccountEvaluationSummary,
  type AccountListItem,
} from "@/lib/accounts-api";

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
export default function AccountsPage() {
  const accountsQ = useQuery({
    queryKey: accountsListQueryKey(),
    queryFn: () => fetchAccounts(),
    staleTime: 30_000,
  });

  const items = accountsQ.data?.items ?? [];

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
          Accounts
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Canonical accounts and their most recent evaluations.
        </p>
      </div>

      {accountsQ.isLoading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      {accountsQ.isError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">
            {accountsQ.error instanceof Error
              ? accountsQ.error.message
              : "Could not load accounts."}
          </p>
        </div>
      )}

      {!accountsQ.isLoading && !accountsQ.isError && items.length === 0 && (
        <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">No accounts yet.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
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
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs">
      <span className="text-muted-foreground/70">{label}:</span>
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border text-muted-foreground">
        {capitalize(summary.evaluationMode)}
      </Badge>
      {summary.status === "failed" ? (
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 text-red-400 border-red-500/30 bg-red-500/10"
        >
          Failed
        </Badge>
      ) : (
        <>
          {summary.fitTier && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border text-muted-foreground">
              Fit: {summary.fitTier}
            </Badge>
          )}
          {summary.intentTier && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border text-muted-foreground">
              Intent: {summary.intentTier}
            </Badge>
          )}
          {summary.eligibilityOutcome && (
            <Badge
              variant="outline"
              className={
                summary.eligibilityOutcome === "eligible"
                  ? "text-[10px] px-1.5 py-0 text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                  : summary.eligibilityOutcome === "restricted"
                    ? "text-[10px] px-1.5 py-0 text-amber-400 border-amber-500/30 bg-amber-500/10"
                    : "text-[10px] px-1.5 py-0 text-red-400 border-red-500/30 bg-red-500/10"
              }
            >
              {capitalize(summary.eligibilityOutcome)}
            </Badge>
          )}
        </>
      )}
    </div>
  );
}
