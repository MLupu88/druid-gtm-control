import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ArrowLeft, Building2, Globe } from "lucide-react";
import {
  fetchAccountDetail,
  accountDetailQueryKey,
  type Account,
  type AccountEvaluation,
} from "@/lib/accounts-api";
import { EvaluationSummaryLine } from "@/pages/accounts";
import { DecisionControls } from "@/components/decision-controls";
import { DecisionHistory } from "@/components/decision-history";
import { ClientRadarResearchPanel } from "@/components/client-radar-research-panel";
import { AccountIcpPreviewPanel } from "@/components/account-icp-preview-panel";
import { EvaluationRunsList } from "@/components/evaluation-runs-list";

function accountIdentity(account: Account): { primary: string; secondary: string | null } {
  if (account.companyName) {
    return { primary: account.companyName, secondary: account.companyDomain };
  }
  if (account.companyDomain) {
    return { primary: account.companyDomain, secondary: null };
  }
  return { primary: account.accountKey, secondary: null };
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// The one derivation this slice performs: the newest completed
// production evaluation, if any. `evaluations` is already ordered
// createdAt desc, id desc by the API, so the first match is the newest.
function findLatestCompletedProductionEvaluation(
  evaluations: AccountEvaluation[],
): AccountEvaluation | null {
  return (
    evaluations.find(
      (e) => e.evaluationMode === "production" && e.status === "completed",
    ) ?? null
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>();

  const detailQ = useQuery({
    queryKey: accountDetailQueryKey(accountId ?? ""),
    queryFn: () => fetchAccountDetail(accountId!),
    enabled: !!accountId,
  });

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <Link
        href="/accounts"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to accounts
      </Link>

      {detailQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-1/2 rounded-lg" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}

      {detailQ.isError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300">
            {detailQ.error instanceof Error
              ? detailQ.error.message
              : "Could not load this account."}
          </p>
        </div>
      )}

      {!detailQ.isLoading && !detailQ.isError && detailQ.data === null && (
        <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No account exists with that ID.
          </p>
        </div>
      )}

      {detailQ.data && <AccountDetailContent detail={detailQ.data} />}
    </div>
  );
}

// ─── Content ──────────────────────────────────────────────────────────────────
function AccountDetailContent({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof fetchAccountDetail>>>;
}) {
  const { account, evaluations } = detail;
  const identity = accountIdentity(account);
  const latestProduction = findLatestCompletedProductionEvaluation(evaluations);

  return (
    <div className="space-y-6">
      {/* Identity */}
      <div>
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-muted-foreground shrink-0" />
          <h1 className="text-2xl font-bold font-display tracking-tight text-foreground truncate">
            {identity.primary}
          </h1>
        </div>
        {identity.secondary && (
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" />
            {identity.secondary}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground/60 mt-2">
          {account.accountKey} · created {formatDateTime(account.createdAt)} · updated{" "}
          {formatDateTime(account.updatedAt)}
        </p>
      </div>

      {/* Latest evaluation + decision: two columns on desktop — the
          decision on the right is made in direct reference to the
          evaluation on the left, so both are genuinely useful side by
          side rather than one column being filler. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">
              Latest completed production evaluation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {latestProduction ? (
              <div className="space-y-3">
                <EvaluationSummaryLine label="Result" summary={latestProduction} />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <MetaField label="Identity resolution" value={latestProduction.identityResolutionLevel} />
                  <MetaField label="Identity confidence" value={latestProduction.identityConfidence} />
                  <MetaField label="Fit score" value={latestProduction.fitScore} />
                  <MetaField label="Intent score" value={latestProduction.intentScore} />
                  <MetaField label="Actionability score" value={latestProduction.actionabilityScore} />
                  <MetaField label="Created by" value={latestProduction.createdBy} />
                </div>
                <p className="text-[11px] text-muted-foreground/60">
                  {formatDateTime(latestProduction.createdAt)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No completed production evaluation yet.
              </p>
            )}
          </CardContent>
        </Card>

        <DecisionControls
          accountId={account.id}
          latestCompletedProductionEvaluation={latestProduction}
        />
      </div>

      <AccountIcpPreviewPanel accountId={account.id} />

      <ClientRadarResearchPanel accountId={account.id} />

      {/* Decision history + evaluation runs: two parallel record lists
          — each independently scannable, so both columns carry real
          content rather than one being empty space. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <DecisionHistory accountId={account.id} />

        <EvaluationRunsList evaluations={evaluations} />
      </div>
    </div>
  );
}

// ─── Meta field ───────────────────────────────────────────────────────────────
function MetaField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{label}</p>
      <p className="text-foreground font-medium mt-0.5">
        {value ?? <span className="text-muted-foreground font-normal">Not available</span>}
      </p>
    </div>
  );
}
