import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ArrowRight, Building2, Globe } from "lucide-react";
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
import { AccountFactsPanel } from "@/components/account-facts-panel";
import { AccountTruthPanel } from "@/components/account-truth-panel";
import { AccountRecentActivityPanel } from "@/components/account-recent-activity-panel";
import { humanizeAliasType } from "@/lib/account-truth-presentation";
import { EvaluationRunsList } from "@/components/evaluation-runs-list";
import { InlineNotice } from "@/components/inline-notice";
import { PageHeader, PageLayout } from "@/components/page-layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { DefinitionHint } from "@/components/definition-hint";
import type { DefinitionKey } from "@/lib/definitions";

const ACCOUNT_TABS = [
  { value: "overview", label: "Overview" },
  { value: "activity", label: "Activity" },
  { value: "people", label: "People" },
  { value: "intelligence", label: "Intelligence" },
  { value: "icp", label: "ICP" },
  { value: "actions", label: "Actions" },
  { value: "history", label: "History" },
] as const;

function accountIdentity(account: Account): { primary: string; secondary: string | null } {
  if (account.companyName) return { primary: account.companyName, secondary: account.companyDomain };
  if (account.companyDomain) return { primary: account.companyDomain, secondary: null };
  return { primary: account.accountKey, secondary: null };
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// The detail endpoint already orders evaluations newest first; this keeps the
// workspace's overview grounded in the same newest completed production run.
function findLatestCompletedProductionEvaluation(evaluations: AccountEvaluation[]) {
  return evaluations.find((e) => e.evaluationMode === "production" && e.status === "completed") ?? null;
}

export default function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const showDismiss = searchParams.get("from") === "attention";
  const requestedTab = searchParams.get("tab");
  const tab = ACCOUNT_TABS.some((item) => item.value === requestedTab) ? requestedTab! : "overview";

  function setTab(next: string) {
    setSearchParams({ ...(showDismiss ? { from: "attention" } : {}), tab: next }, { replace: true });
  }

  const detailQ = useQuery({
    queryKey: accountDetailQueryKey(accountId ?? ""),
    queryFn: () => fetchAccountDetail(accountId!),
    enabled: !!accountId,
  });

  return (
    <PageLayout width="wide" className="space-y-4">
      <Link href="/accounts" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to accounts
      </Link>

      {detailQ.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-10 w-1/2 rounded-lg" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      )}
      {detailQ.isError && (
        <InlineNotice tone="danger" title="Could not load account">
          <p>{detailQ.error instanceof Error ? detailQ.error.message : "Could not load this account."}</p>
        </InlineNotice>
      )}
      {!detailQ.isLoading && !detailQ.isError && detailQ.data === null && (
        <Empty>
          <EmptyHeader><EmptyTitle>Account not found</EmptyTitle><EmptyDescription>No account exists with that ID.</EmptyDescription></EmptyHeader>
        </Empty>
      )}
      {detailQ.data && <AccountDetailContent detail={detailQ.data} showDismiss={showDismiss} tab={tab} onTabChange={setTab} />}
    </PageLayout>
  );
}

function AccountDetailContent({
  detail,
  showDismiss,
  tab,
  onTabChange,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof fetchAccountDetail>>>;
  showDismiss: boolean;
  tab: string;
  onTabChange: (tab: string) => void;
}) {
  const { account, evaluations, identityAliasTypes } = detail;
  const identity = accountIdentity(account);
  const latestProduction = findLatestCompletedProductionEvaluation(evaluations);

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex min-w-0 items-center gap-2"><Building2 className="size-5 shrink-0 text-muted-foreground" /><span className="truncate">{identity.primary}</span></span>}
        description={<span className="space-y-1">{identity.secondary && <span className="flex items-center gap-1.5"><Globe className="size-3.5" />{identity.secondary}</span>}<span className="block text-xs text-muted-foreground/70">{account.accountKey} · created {formatDateTime(account.createdAt)} · updated {formatDateTime(account.updatedAt)}</span></span>}
      />

      <Tabs value={tab} onValueChange={onTabChange} className="space-y-3">
        <div className="sticky top-12 z-10 -mx-1 bg-background/95 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:top-14">
          <TabsList className="w-full justify-start overflow-x-auto whitespace-nowrap">
            {ACCOUNT_TABS.map((item) => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <AccountSnapshot account={account} identityAliasTypes={identityAliasTypes} />
          <AccountTruthPanel accountId={account.id} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <AccountFactsPanel accountId={account.id} />
            <LatestEvaluationPanel evaluation={latestProduction} />
          </div>
          <OverviewWorkspaceCues onTabChange={onTabChange} />
        </TabsContent>
        <TabsContent value="activity"><AccountRecentActivityPanel accountId={account.id} /></TabsContent>
        <TabsContent value="people"><WorkspaceEmptyState title="People data is not available" description="No canonical people or contact data is available for this account yet." /></TabsContent>
        <TabsContent value="intelligence"><ClientRadarResearchPanel accountId={account.id} /></TabsContent>
        <TabsContent value="icp"><AccountIcpPreviewPanel accountId={account.id} /></TabsContent>
        <TabsContent value="actions">
          <DecisionControls accountId={account.id} latestCompletedProductionEvaluation={latestProduction} showDismiss={showDismiss} />
        </TabsContent>
        <TabsContent value="history">
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
            <DecisionHistory accountId={account.id} />
            <EvaluationRunsList evaluations={evaluations} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountSnapshot({
  account,
  identityAliasTypes,
}: {
  account: Account;
  identityAliasTypes: string[];
}) {
  // Milestone 3.5 defect fix: this used to show evaluation?.identityResolutionLevel
  // here, which reads "Not available" for any account with no evaluation
  // yet — even one with real, known domain/HubSpot aliases — because
  // that field describes a specific evaluation's engagement/contact-level
  // identity classification, not "do we know who this account is."
  // identityAliasTypes is the actual canonical alias state (see
  // ../lib/accounts-api.ts's AccountDetail.identityAliasTypes) and is
  // never a confidence score — an empty array here is a genuine "no
  // strong identifier known yet," not a guess either way. Evaluation-
  // level identity resolution AND confidence remain shown, correctly
  // labeled ("Identity resolution" / "Identity confidence"), in
  // LatestEvaluationPanel below — unchanged, not duplicated here.
  const identityText =
    identityAliasTypes.length > 0
      ? identityAliasTypes.map(humanizeAliasType).join(", ")
      : "Not available";

  return (
    <section className="rounded-lg border border-border bg-card/50 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Account snapshot</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Canonical identity and latest known evaluation state.</p>
        </div>
        <p className="text-[11px] text-muted-foreground">Updated {formatDateTime(account.updatedAt)}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <MetaField label="Account key" value={account.accountKey} />
        <MetaField label="Created" value={formatDateTime(account.createdAt)} />
        <MetaField label="Identity" value={identityText} />
      </div>
    </section>
  );
}

function OverviewWorkspaceCues({ onTabChange }: { onTabChange: (tab: string) => void }) {
  const destinations = [
    { tab: "intelligence", label: "Research intelligence" },
    { tab: "icp", label: "ICP" },
    { tab: "actions", label: "Actions" },
    { tab: "history", label: "History" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/70 pt-3">
      <span className="text-[11px] text-muted-foreground">Workspace:</span>
      {destinations.map((destination) => (
        <button
          key={destination.tab}
          type="button"
          onClick={() => onTabChange(destination.tab)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {destination.label}
          <ArrowRight className="size-3" />
        </button>
      ))}
    </div>
  );
}

function LatestEvaluationPanel({ evaluation }: { evaluation: AccountEvaluation | null }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader><CardTitle className="text-xs font-semibold uppercase tracking-wider text-primary">Latest production evaluation</CardTitle></CardHeader>
      <CardContent>
        {evaluation ? <div className="space-y-3">
          <EvaluationSummaryLine label="Result" summary={evaluation} />
          <div className="grid grid-cols-2 gap-3 text-xs">
            <MetaField label="Identity resolution" value={evaluation.identityResolutionLevel} hint="identity_resolution" />
            <MetaField label="Identity confidence" value={evaluation.identityConfidence} hint="identity_confidence" />
            <MetaField label="Fit score" value={evaluation.fitScore} hint="icp_fit" />
            <MetaField label="Intent score" value={evaluation.intentScore} hint="intent" />
            <MetaField label="Actionability score" value={evaluation.actionabilityScore} hint="actionability" />
            <MetaField label="Created by" value={evaluation.createdBy} />
          </div>
          <p className="text-[11px] text-muted-foreground/60">{formatDateTime(evaluation.createdAt)}</p>
        </div> : <p className="text-sm text-muted-foreground">No completed production evaluation yet.</p>}
      </CardContent>
    </Card>
  );
}

function WorkspaceEmptyState({ title, description }: { title: string; description: string }) {
  return <Empty className="min-h-48 rounded-lg border border-dashed border-border bg-card/30"><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>;
}

function MetaField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint?: DefinitionKey;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
        {hint && <DefinitionHint term={hint} />}
      </p>
      <p className="mt-0.5 font-medium text-foreground">
        {value ?? <span className="font-normal text-muted-foreground">Not available</span>}
      </p>
    </div>
  );
}
