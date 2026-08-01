import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { TechnicalDetails } from "@/components/technical-details";
import { LegacyStarterWarning } from "@/components/legacy-starter-warning";
import { accountDetailQueryKey, type AccountEvaluation } from "@/lib/accounts-api";
import { accountDecisionsQueryKey } from "@/lib/account-decisions-api";
import {
  fetchIcpProfiles,
  icpProfilesListQueryKey,
  type IcpProfileListItem,
} from "@/lib/icp-profiles-api";
import {
  runAccountIcpPreview,
  runAccountIcpOfficialEvaluation,
  AccountIcpEvaluationApiError,
} from "@/lib/account-icp-evaluations-api";
import { isLegacyStarterIcpConfig } from "@/lib/icp-legacy-starter-detection";
import {
  describeReasonEntry,
  categorizeMissingInputs,
  humanizeTierLabel,
  formatScorePoints,
  TIER_EXPLANATION,
  eligibilityLabel,
  eligibilityBadgeVariant,
  hasIdentityNotPersonAddressableRestriction,
  deriveActionabilityState,
  ACTIONABILITY_STATE_LABELS,
  type MissingInputCategory,
  type ReasonEntry,
} from "@/lib/icp-preview-presentation";

export interface AccountIcpPreviewPanelProps {
  accountId: string;
}

// ---------------------------------------------------------------------
// Small, local, defensive helpers — this is a read-only display surface
// over server-computed values, so nothing here re-derives or guesses a
// score; every fallback below only ever substitutes a restrained "—" or
// short explanatory copy, never a fabricated number. Reason-code/tier/
// missing-input humanization itself lives in
// ../lib/icp-preview-presentation.ts (unit-tested there without a DOM).
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
    return `Draft version · v${profile.draftVersion.versionNumber}`;
  }
  if (profile?.activeVersion && evaluation.profileVersionId === profile.activeVersion.id) {
    return `Active version · v${profile.activeVersion.versionNumber}`;
  }
  return `Profile version ${shortId(evaluation.profileVersionId)}`;
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

function reasonEntries(items: unknown): ReasonEntry[] {
  return Array.isArray(items) ? items.map(describeReasonEntry) : [];
}

function MetricExplanation({ children }: { children: string }) {
  return (
    <p className="text-[11px] text-muted-foreground/70 mt-1 leading-relaxed">{children}</p>
  );
}

// Renders only plain-language text — the raw ruleId/field behind each
// entry (entry.technical) is deliberately NOT shown here; it's collected
// once into CompletedEvaluationDetails' single bottom "Technical details"
// disclosure instead, so traceability survives without every list
// doubling as a dump of internal identifiers.
function HumanEntryList({
  entries,
  emptyLabel,
}: {
  entries: ReasonEntry[];
  emptyLabel: string;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {entries.map((entry, index) => (
        <li key={index} className="text-sm text-foreground leading-relaxed">
          {entry.primary}
        </li>
      ))}
    </ul>
  );
}

function MissingInputsSummary({
  categories,
}: {
  categories: MissingInputCategory[] | null;
}) {
  if (categories === null) {
    return <p className="text-sm text-muted-foreground">Data not available for this preview.</p>;
  }
  if (categories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No missing inputs — every data point this evaluation needed was available.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {categories.map((category) => (
        <li key={category.category} className="text-sm text-foreground leading-relaxed">
          {category.category}
          {category.dimensions.length > 0 && (
            <span className="text-muted-foreground"> — affects {category.dimensions.join(", ")}</span>
          )}
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
          This profile has no draft or active version yet, so it can&apos;t be tested.
        </AlertDescription>
      </Alert>
    );
  }
  const message = error instanceof Error ? error.message : "Could not test this ICP.";
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Test failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function FailedEvaluationState({ evaluation }: { evaluation: AccountEvaluation }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Test could not be completed</AlertTitle>
      <AlertDescription>
        {evaluation.errorDetail && evaluation.errorDetail.trim() !== ""
          ? evaluation.errorDetail
          : "No further details were recorded for this failure."}
      </AlertDescription>
    </Alert>
  );
}

function CompletedEvaluationDetails({ evaluation }: { evaluation: AccountEvaluation }) {
  const fitBand = humanizeTierLabel(evaluation.fitTier);
  const intentBand = humanizeTierLabel(evaluation.intentTier);
  const actionabilityState = deriveActionabilityState(
    evaluation.actionabilityScore,
    evaluation.missingInputs,
  );
  const isIdentityRestricted =
    evaluation.eligibilityOutcome === "restricted" &&
    hasIdentityNotPersonAddressableRestriction(evaluation.eligibilityRestrictions);
  const isLegacyStarter = isLegacyStarterIcpConfig(evaluation.profileConfigSnapshot);

  const matchedRuleEntries = reasonEntries(evaluation.matchedRules);
  const hardDisqualifierEntries = reasonEntries(evaluation.hardDisqualifiers);
  const restrictionEntries = reasonEntries(evaluation.eligibilityRestrictions);
  const missingCategories = categorizeMissingInputs(evaluation.missingInputs);

  // Every raw internal identifier shown anywhere in this view (tier
  // codes, ruleIds, missing-input field paths) is collected here rather
  // than inline, so the primary content above stays plain language while
  // nothing is actually discarded — see ../lib/icp-preview-presentation.ts.
  const technicalLines: { label: string; value: string }[] = [];
  if (fitBand) technicalLines.push({ label: "ICP fit band code", value: fitBand.raw });
  if (intentBand) technicalLines.push({ label: "Buying intent band code", value: intentBand.raw });
  for (const entry of matchedRuleEntries) {
    if (entry.technical) technicalLines.push({ label: "Matched rule", value: entry.technical });
  }
  for (const entry of hardDisqualifierEntries) {
    if (entry.technical) technicalLines.push({ label: "Hard disqualifier rule", value: entry.technical });
  }
  for (const entry of restrictionEntries) {
    if (entry.technical) technicalLines.push({ label: "Restriction rule", value: entry.technical });
  }
  if (missingCategories) {
    for (const category of missingCategories) {
      for (const field of category.fields) {
        technicalLines.push({ label: "Missing field", value: field });
      }
    }
  }

  return (
    <div className="space-y-5">
      {/* Company fit — the humanized band is the primary business
          outcome; the weighted numeric score is secondary metadata,
          explicitly labeled as a weight, never a percentage or an
          out-of-100 score (see formatScorePoints). */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">ICP fit</p>
        <p className="text-3xl font-bold tracking-tight text-foreground mt-0.5">
          {fitBand ? fitBand.label : "No band resolved"}
        </p>
        {fitBand && <p className="text-[11px] text-muted-foreground mt-0.5">{TIER_EXPLANATION}</p>}
        <p className="text-xs text-muted-foreground mt-1.5">{formatScorePoints(evaluation.fitScore)}</p>
        <MetricExplanation>
          How closely this account matches the ICP profile&apos;s target criteria — industry,
          size, region, and similar company attributes.
        </MetricExplanation>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Buying intent
          </p>
          <p className="text-lg font-semibold text-foreground mt-0.5">
            {intentBand ? intentBand.label : "No band resolved"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatScorePoints(evaluation.intentScore)}
          </p>
          <MetricExplanation>
            How much recent engagement — site visits, repeat activity — suggests active
            buying interest right now.
          </MetricExplanation>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Ability to act
          </p>
          <p className="text-lg font-semibold text-foreground mt-0.5">
            {ACTIONABILITY_STATE_LABELS[actionabilityState]}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatScorePoints(evaluation.actionabilityScore)}
          </p>
          <MetricExplanation>
            Whether there&apos;s enough contact or CRM information available to actually
            follow up.
          </MetricExplanation>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Outreach eligibility
          </p>
          <div className="mt-0.5">
            <Badge variant={eligibilityBadgeVariant(evaluation.eligibilityOutcome)}>
              {eligibilityLabel(evaluation.eligibilityOutcome)}
            </Badge>
          </div>
          {isIdentityRestricted && (
            <div className="mt-1.5 space-y-0.5 max-w-xs">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Restricted for automated outreach
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                No person-addressable contact is available yet. Enrich a qualified contact
                before outreach.
              </p>
            </div>
          )}
          <MetricExplanation>
            Whether policy restrictions — disqualifiers, do-not-contact, or an unresolved
            identity — allow this account to be contacted at all.
          </MetricExplanation>
        </div>
      </div>

      {isLegacyStarter && <LegacyStarterWarning />}

      <p className="text-xs text-muted-foreground">{summarizeEligibilityCounts(evaluation)}</p>

      <Accordion type="multiple">
        <AccordionItem value="why">
          <AccordionTrigger className="text-sm py-2">Why this score</AccordionTrigger>
          <AccordionContent>
            <HumanEntryList entries={matchedRuleEntries} emptyLabel="No matched rules recorded." />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="restrictions">
          <AccordionTrigger className="text-sm py-2">Restrictions</AccordionTrigger>
          <AccordionContent className="space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Hard disqualifiers
              </p>
              <HumanEntryList entries={hardDisqualifierEntries} emptyLabel="None recorded." />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                Restrictions
              </p>
              <HumanEntryList entries={restrictionEntries} emptyLabel="None recorded." />
            </div>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="missing">
          <AccordionTrigger className="text-sm py-2">Missing inputs</AccordionTrigger>
          <AccordionContent>
            <MissingInputsSummary categories={missingCategories} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {technicalLines.length > 0 && (
        <TechnicalDetails>
          <ul className="space-y-1 font-mono text-[11px] text-muted-foreground/80">
            {technicalLines.map((line, index) => (
              <li key={index}>
                <span className="text-muted-foreground/50">{line.label}:</span> {line.value}
              </li>
            ))}
          </ul>
        </TechnicalDetails>
      )}
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
          Tested against {profile?.name ?? "this profile"}
        </p>
        <p className="text-xs text-muted-foreground">
          {describeProfileVersion(evaluation, profile)} · {formatDateTime(evaluation.createdAt)}
        </p>
        <p className="text-[11px] text-muted-foreground/70">
          This preview is recorded in the account&apos;s evaluation runs for reference. It
          cannot be used to record a decision. Only an official evaluation using the active
          published profile can support a decision.
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
// Official (production) evaluation — runs and saves a fresh server-side
// evaluation, distinct from the preview above. Never submits the
// currently-displayed preview result; the mutation always calls
// runAccountIcpOfficialEvaluation(accountId, profileId), which sends
// nothing but a profileId (see ../lib/account-icp-evaluations-api.ts).
// ---------------------------------------------------------------------

function OfficialEvaluationErrorState({ error }: { error: unknown }) {
  if (error instanceof AccountIcpEvaluationApiError) {
    if (error.code === "no_active_profile_version") {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profile isn&apos;t published yet</AlertTitle>
          <AlertDescription>
            This ICP profile has no active, published version, so an official
            evaluation can&apos;t be saved yet. Publish and activate a version
            first, then try again.
          </AlertDescription>
        </Alert>
      );
    }
    if (error.code === "account_not_found" || error.code === "profile_not_found") {
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>
            This account or ICP profile could no longer be found. Refresh the
            page and try again.
          </AlertDescription>
        </Alert>
      );
    }
  }
  const message =
    error instanceof Error ? error.message : "Could not run and save the official evaluation.";
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Save failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// The evaluation ID appears only in TechnicalDetails, consistent with
// this file's existing convention of never showing raw internal
// identifiers as primary text — see describeProfileVersion's own
// shortId() fallback above.
function OfficialEvaluationResult({
  evaluation,
  profile,
  hasComparablePreview,
}: {
  evaluation: AccountEvaluation;
  profile: IcpProfileListItem | undefined;
  /** True when a preview for this exact same profile is also currently displayed, so the "may differ" note is truthful, not a generic disclaimer. */
  hasComparablePreview: boolean;
}) {
  return (
    <div className="space-y-4 pt-1">
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
          <p className="text-sm font-medium text-foreground">
            Saved as the official evaluation against {profile?.name ?? "this profile"}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {describeProfileVersion(evaluation, profile)} · {formatDateTime(evaluation.createdAt)}
        </p>
        <p className="text-[11px] text-primary/80">
          This is now recorded in the account&apos;s evaluation runs.
        </p>
        {hasComparablePreview && (
          <p className="text-[11px] text-muted-foreground/70">
            This may differ from the preview above — an official evaluation always
            uses the profile&apos;s active published version and the account&apos;s
            current data, never a draft.
          </p>
        )}
      </div>

      {evaluation.status === "failed" ? (
        <FailedEvaluationState evaluation={evaluation} />
      ) : (
        <CompletedEvaluationDetails evaluation={evaluation} />
      )}

      <TechnicalDetails summary="Evaluation record">
        <p className="font-mono text-[11px] text-muted-foreground/80">
          Evaluation ID: {evaluation.id}
        </p>
      </TechnicalDetails>
    </div>
  );
}

function ConfirmOfficialEvaluationDialog({
  open,
  onOpenChange,
  profileName,
  onConfirm,
  isPending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileName: string;
  onConfirm: () => void;
  isPending: boolean;
  error: unknown;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md rounded-2xl border border-border bg-background">
        <DialogHeader className="border-b border-border pb-4">
          <DialogTitle className="text-base font-semibold font-display">
            Run and save official evaluation?
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3 text-sm text-foreground leading-relaxed">
          <p>
            This runs a brand new evaluation on the server right now, against{" "}
            <span className="font-medium">{profileName}</span>&apos;s currently active,
            published version and the account&apos;s current canonical data.
          </p>
          <p className="text-muted-foreground">
            The result is saved permanently to this account&apos;s evaluation runs.
            If you&apos;ve run a preview, this official result may differ from it —
            previews can use a draft version of the profile; this always uses the
            active published version.
          </p>
          {error !== null && <OfficialEvaluationErrorState error={error} />}
        </div>
        <DialogFooter className="border-t border-border pt-4 gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 bg-primary text-primary-foreground hover:bg-[#00c853] shadow-lg shadow-primary/20"
          >
            {isPending ? "Running…" : "Run and save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------

export function AccountIcpPreviewPanel(props: AccountIcpPreviewPanelProps) {
  const { accountId } = props;
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [officialConfirmOpen, setOfficialConfirmOpen] = useState(false);

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

  // Always runs a fresh server-side evaluation and persists it — never
  // submits previewMutation.data. On success: account detail (which the
  // "Latest completed production evaluation" card and the evaluation
  // history list both read) and decision history are invalidated so
  // Promote to MQL / Keep for review become available from the newly
  // persisted evaluation, driven entirely by the refetched data — never
  // unlocked optimistically from this mutation's own response.
  const officialMutation = useMutation({
    mutationFn: (profileId: string) => runAccountIcpOfficialEvaluation(accountId, profileId),
    retry: false,
    onSuccess: () => {
      setOfficialConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: accountDetailQueryKey(accountId) });
      void queryClient.invalidateQueries({ queryKey: accountDecisionsQueryKey(accountId) });
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
  const officialResultProfile = officialMutation.variables
    ? profiles.find((profile) => profile.id === officialMutation.variables)
    : undefined;

  function handleRunPreview() {
    if (!selectedProfileId) return;
    previewMutation.mutate(selectedProfileId);
  }

  const canRun = !!selectedProfileId && !previewMutation.isPending;

  // Eligibility is derived from the SAME profiles list already loaded
  // for the dropdown above (IcpProfileListItem.activeVersion — see
  // ../lib/icp-profiles-api.ts), not guessed: an official evaluation
  // requires the profile's active PUBLISHED version, exactly what
  // resolveProfileVersionForEvaluation's "production" branch enforces
  // server-side. "Missing canonical account" / "identity not resolved"
  // are NOT real preconditions the backend enforces — the evaluator runs
  // successfully even for an anonymous account, so they are deliberately
  // not modeled here as disabled-state reasons.
  const selectedProfile = selectedProfileId
    ? profiles.find((profile) => profile.id === selectedProfileId)
    : undefined;
  const officialDisabledReason = !selectedProfileId
    ? "Choose an ICP profile first."
    : !selectedProfile?.activeVersion
      ? "Publish and activate a version of this profile to run an official evaluation."
      : officialMutation.isPending
        ? "An official evaluation is already running for this account."
        : null;
  // Only truthful when the reason is specifically the missing-active-
  // version case — "Choose an ICP profile first" and "already running"
  // have no ICP profile settings page to link to.
  const officialBlockedByMissingActiveVersion =
    !!selectedProfileId && !!selectedProfile && !selectedProfile.activeVersion;
  const canRunOfficial = officialDisabledReason === null;

  function handleConfirmOfficial() {
    if (!selectedProfileId) return;
    officialMutation.mutate(selectedProfileId);
  }

  // The "may differ from preview" note is only truthful when the
  // currently displayed preview and the currently displayed official
  // result were run against the exact same profile — never inferred
  // from whatever the dropdown happens to show now.
  const hasComparablePreview =
    !!previewMutation.data &&
    previewMutation.variables !== undefined &&
    previewMutation.variables === officialMutation.variables;

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-6 space-y-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              ICP preview
            </h2>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              Preview
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Test this account against an ICP profile to see how it would score. Every test
            run is recorded in the account&apos;s evaluation runs, but it can never be used
            to record a decision — only an official evaluation can.
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
                Create an ICP profile before you can test this account against one.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        {!profilesQ.isLoading && !profilesQ.isError && profiles.length > 0 && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label
                  htmlFor="icp-preview-profile"
                  className="text-xs font-medium text-muted-foreground"
                >
                  ICP profile
                </Label>
                <Select
                  value={selectedProfileId ?? undefined}
                  onValueChange={(value) => setSelectedProfileId(value)}
                >
                  <SelectTrigger id="icp-preview-profile">
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
                {previewMutation.isPending ? "Testing…" : "Test against this ICP"}
              </Button>
            </div>

            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <p>
                This preview only uses the account&apos;s verified company name and domain
                today. After you run it, anything the profile needed but couldn&apos;t find
                will be listed under &quot;Missing inputs&quot; below.
              </p>
            </div>

            {previewMutation.isError ? (
              <PreviewErrorState error={previewMutation.error} />
            ) : previewMutation.data ? (
              <PreviewResult evaluation={previewMutation.data} profile={resultProfile} />
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                Choose an ICP profile and run a test to see how this account fits.
              </p>
            )}

            <div className="border-t border-border pt-5 space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Official evaluation</h3>
                <p className="text-xs text-muted-foreground">
                  Runs a fresh evaluation on the server and saves it to this account&apos;s
                  evaluation runs — separate from the preview above.
                </p>
              </div>

              <div className="flex flex-col items-start gap-1.5">
                <Button
                  variant="outline"
                  onClick={() => setOfficialConfirmOpen(true)}
                  disabled={!canRunOfficial}
                >
                  Run and save official evaluation
                </Button>
                {officialDisabledReason && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[11px] text-muted-foreground">{officialDisabledReason}</p>
                    {officialBlockedByMissingActiveVersion && selectedProfile && (
                      <Button asChild size="sm" variant="link" className="h-auto p-0 text-[11px]">
                        <Link href={`/settings/icp-profiles/${selectedProfile.id}`}>
                          Open ICP profile
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {officialMutation.isError ? (
                <OfficialEvaluationErrorState error={officialMutation.error} />
              ) : (
                officialMutation.isSuccess &&
                officialMutation.data && (
                  <OfficialEvaluationResult
                    evaluation={officialMutation.data}
                    profile={officialResultProfile}
                    hasComparablePreview={hasComparablePreview}
                  />
                )
              )}
            </div>

            {selectedProfile && (
              <ConfirmOfficialEvaluationDialog
                open={officialConfirmOpen}
                onOpenChange={setOfficialConfirmOpen}
                profileName={selectedProfile.name}
                onConfirm={handleConfirmOfficial}
                isPending={officialMutation.isPending}
                error={officialMutation.isError ? officialMutation.error : null}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
