import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { accountDetailQueryKey, type AccountEvaluation } from "@/lib/accounts-api";
import {
  fetchIcpProfiles,
  icpProfilesListQueryKey,
  type IcpProfileListItem,
} from "@/lib/icp-profiles-api";
import {
  runAccountIcpPreview,
  AccountIcpEvaluationApiError,
} from "@/lib/account-icp-evaluations-api";

export interface AccountIcpPreviewPanelProps {
  accountId: string;
}

// ---------------------------------------------------------------------
// Small, local, defensive helpers — this is a read-only display surface
// over server-computed values, so nothing here re-derives or guesses a
// score; every fallback below only ever substitutes a restrained "—" or
// short explanatory copy, never a fabricated number.
// ---------------------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// Resolves the label from the profile actually used for THIS evaluation
// (passed in by the caller, already keyed off the mutation's own
// variables — see AccountIcpPreviewPanel below), never off whatever the
// dropdown currently shows.
function describeProfileVersion(
  evaluation: AccountEvaluation,
  profile: IcpProfileListItem | undefined,
): string {
  if (profile?.draftVersion && evaluation.profileVersionId === profile.draftVersion.id) {
    return `Draft preview · v${profile.draftVersion.versionNumber}`;
  }
  if (profile?.activeVersion && evaluation.profileVersionId === profile.activeVersion.id) {
    return `Active version preview · v${profile.activeVersion.versionNumber}`;
  }
  return `Profile version ${shortId(evaluation.profileVersionId)}`;
}

function eligibilityLabel(outcome: AccountEvaluation["eligibilityOutcome"]): string {
  switch (outcome) {
    case "eligible":
      return "Eligible";
    case "restricted":
      return "Restricted";
    case "ineligible":
      return "Disqualified";
    default:
      return "Unknown";
  }
}

function eligibilityBadgeVariant(
  outcome: AccountEvaluation["eligibilityOutcome"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (outcome) {
    case "eligible":
      return "default";
    case "restricted":
      return "outline";
    case "ineligible":
      return "destructive";
    default:
      return "secondary";
  }
}

// Only ever says "no issues" when both arrays are verifiably present and
// empty — never inferred from a missing/unknown value.
function summarizeEligibilityCounts(evaluation: AccountEvaluation): string {
  const disqualifiers = Array.isArray(evaluation.hardDisqualifiers)
    ? evaluation.hardDisqualifiers.length
    : null;
  const restrictions = Array.isArray(evaluation.eligibilityRestrictions)
    ? evaluation.eligibilityRestrictions.length
    : null;

  if (disqualifiers === null || restrictions === null) {
    return "Disqualifier and restriction counts unavailable.";
  }
  if (disqualifiers === 0 && restrictions === 0) {
    return "No disqualifiers or restrictions recorded.";
  }
  const parts: string[] = [];
  if (disqualifiers > 0) {
    parts.push(`${disqualifiers} hard disqualifier${disqualifiers === 1 ? "" : "s"}`);
  }
  if (restrictions > 0) {
    parts.push(`${restrictions} restriction${restrictions === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

// Defensive rendering for the evaluator's jsonb array fields: prefers a
// readable field, never crashes on an unexpected shape, and only falls
// back to raw JSON when nothing readable exists.
function describeEntry(item: unknown): string {
  if (typeof item === "string") return item;

  if (item && typeof item === "object" && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    const label =
      typeof record.description === "string"
        ? record.description
        : typeof record.reason === "string"
          ? record.reason
          : null;

    const prefixParts: string[] = [];
    if (typeof record.ruleId === "string") prefixParts.push(record.ruleId);
    if (typeof record.field === "string") prefixParts.push(record.field);
    if (prefixParts.length === 0 && typeof record.id === "string") {
      prefixParts.push(record.id);
    }

    if (label) {
      return prefixParts.length > 0 ? `${prefixParts.join(" · ")} — ${label}` : label;
    }
    if (prefixParts.length > 0) return prefixParts.join(" · ");
  }

  try {
    return JSON.stringify(item);
  } catch {
    return "Unrecognized entry";
  }
}

function EntryList({ items, emptyLabel }: { items: unknown; emptyLabel: string }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={index} className="text-sm text-foreground leading-relaxed">
          {describeEntry(item)}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------
// Sub-states
// ---------------------------------------------------------------------

function CommandRowSkeleton() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-20 rounded" />
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
      <Skeleton className="h-9 w-36 rounded-md" />
    </div>
  );
}

function ProfileListErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const message = error instanceof Error ? error.message : "Could not load ICP profiles.";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function PreviewErrorState({ error }: { error: unknown }) {
  if (
    error instanceof AccountIcpEvaluationApiError &&
    error.code === "no_resolvable_preview_version"
  ) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>No previewable version</AlertTitle>
        <AlertDescription>
          This profile has no draft or active version yet, so it can&apos;t be previewed.
        </AlertDescription>
      </Alert>
    );
  }
  const message = error instanceof Error ? error.message : "Could not run ICP preview.";
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Preview failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function FailedEvaluationState({ evaluation }: { evaluation: AccountEvaluation }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Preview could not be completed</AlertTitle>
      <AlertDescription>
        {evaluation.errorDetail && evaluation.errorDetail.trim() !== ""
          ? evaluation.errorDetail
          : "No further details were recorded for this failure."}
      </AlertDescription>
    </Alert>
  );
}

function CompletedEvaluationDetails({ evaluation }: { evaluation: AccountEvaluation }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Fit</p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-4xl font-bold tracking-tight text-foreground">
            {evaluation.fitScore ?? "—"}
          </span>
          {evaluation.fitTier && (
            <Badge variant="secondary" className="text-xs font-medium">
              {evaluation.fitTier}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Intent</p>
          <p className="text-sm font-medium text-foreground mt-0.5">
            {evaluation.intentScore ?? "—"}
            {evaluation.intentTier && (
              <span className="text-muted-foreground font-normal"> · {evaluation.intentTier}</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Actionability
          </p>
          <p className="text-sm font-medium text-foreground mt-0.5">
            {evaluation.actionabilityScore ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Eligibility
          </p>
          <div className="mt-0.5">
            <Badge variant={eligibilityBadgeVariant(evaluation.eligibilityOutcome)}>
              {eligibilityLabel(evaluation.eligibilityOutcome)}
            </Badge>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{summarizeEligibilityCounts(evaluation)}</p>

      <Accordion type="multiple">
        <AccordionItem value="why">
          <AccordionTrigger className="text-sm py-2">Why this score</AccordionTrigger>
          <AccordionContent>
            <EntryList items={evaluation.matchedRules} emptyLabel="No matched rules recorded." />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="restrictions">
          <AccordionTrigger className="text-sm py-2">Restrictions</AccordionTrigger>
          <AccordionContent className="space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Hard disqualifiers
              </p>
              <EntryList items={evaluation.hardDisqualifiers} emptyLabel="None recorded." />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Restrictions
              </p>
              <EntryList
                items={evaluation.eligibilityRestrictions}
                emptyLabel="None recorded."
              />
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="missing">
          <AccordionTrigger className="text-sm py-2">Missing inputs</AccordionTrigger>
          <AccordionContent>
            <EntryList items={evaluation.missingInputs} emptyLabel="No missing inputs recorded." />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function PreviewResult({
  evaluation,
  profile,
}: {
  evaluation: AccountEvaluation;
  profile: IcpProfileListItem | undefined;
}) {
  return (
    <div className="space-y-4 pt-1">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">
          Evaluated against {profile?.name ?? "this profile"}
        </p>
        <p className="text-xs text-muted-foreground">
          {describeProfileVersion(evaluation, profile)} · {formatDateTime(evaluation.createdAt)}
        </p>
        <p className="text-[11px] text-muted-foreground/70">
          This is a preview, not a production decision.
        </p>
      </div>

      {evaluation.status === "failed" ? (
        <FailedEvaluationState evaluation={evaluation} />
      ) : (
        <CompletedEvaluationDetails evaluation={evaluation} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------

export function AccountIcpPreviewPanel(props: AccountIcpPreviewPanelProps) {
  const { accountId } = props;
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const profilesQ = useQuery({
    queryKey: icpProfilesListQueryKey(),
    queryFn: fetchIcpProfiles,
  });

  const previewMutation = useMutation({
    mutationFn: (profileId: string) => runAccountIcpPreview(accountId, profileId),
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountDetailQueryKey(accountId) });
    },
  });

  const profiles = profilesQ.data ?? [];
  // The result must stay pinned to the profile actually used for that
  // specific mutation call (its variables), never to whatever the
  // dropdown currently shows — otherwise changing the selector after a
  // successful run would relabel an old result under a new profile name.
  const resultProfile = previewMutation.variables
    ? profiles.find((profile) => profile.id === previewMutation.variables)
    : undefined;

  function handleRunPreview() {
    if (!selectedProfileId) return;
    previewMutation.mutate(selectedProfileId);
  }

  const canRun = !!selectedProfileId && !previewMutation.isPending;

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-6 space-y-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              ICP preview
            </h2>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              Preview only
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Test this account against a selected ICP lens — nothing here is saved as a
            permanent assignment.
          </p>
        </div>

        {profilesQ.isLoading && <CommandRowSkeleton />}

        {!profilesQ.isLoading && profilesQ.isError && (
          <ProfileListErrorState
            error={profilesQ.error}
            onRetry={() => void profilesQ.refetch()}
          />
        )}

        {!profilesQ.isLoading && !profilesQ.isError && profiles.length === 0 && (
          <Empty className="border-none p-0 py-4">
            <EmptyHeader>
              <EmptyTitle>No ICP profiles yet</EmptyTitle>
              <EmptyDescription>
                Create an ICP profile before you can preview this account against one.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {!profilesQ.isLoading && !profilesQ.isError && profiles.length > 0 && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label
                  htmlFor="icp-preview-lens"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Analysis lens
                </Label>
                <Select
                  value={selectedProfileId ?? undefined}
                  onValueChange={(value) => setSelectedProfileId(value)}
                >
                  <SelectTrigger id="icp-preview-lens">
                    <SelectValue placeholder="Choose an ICP profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleRunPreview} disabled={!canRun}>
                {previewMutation.isPending ? "Evaluating…" : "Run ICP preview"}
              </Button>
            </div>

            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <p>
                This preview only has verified account name and domain data. CRM,
                engagement, contact, and consent details are not yet available, so the
                result may be conservative or incomplete.
              </p>
            </div>

            {previewMutation.isError ? (
              <PreviewErrorState error={previewMutation.error} />
            ) : previewMutation.data ? (
              <PreviewResult evaluation={previewMutation.data} profile={resultProfile} />
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                Choose an ICP lens and run a preview to see how this account fits.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
