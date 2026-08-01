import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { TechnicalDetails } from "@/components/technical-details";
import { LegacyStarterWarning } from "@/components/legacy-starter-warning";
import { fetchIcpProfiles, icpProfilesListQueryKey, type IcpProfileListItem } from "@/lib/icp-profiles-api";
import type { AccountEvaluation } from "@/lib/accounts-api";
import { groupEvaluationRuns, resolveEvaluationProfileInfo } from "@/lib/evaluation-runs-presentation";
import { humanizeTierLabel, eligibilityLabel, eligibilityBadgeVariant } from "@/lib/icp-preview-presentation";
import { isLegacyStarterIcpConfig } from "@/lib/icp-legacy-starter-detection";

// "Evaluation runs" — a presentation-only reorganization of exactly the
// same account_evaluations rows the previous evaluation-history list
// showed (see ../pages/account-detail.tsx). Every evaluation is still
// here; nothing is deleted, deduplicated, merged, or mutated. Official
// (production) evaluations always stay directly visible; the single
// newest preview gets its own prominent section; every OTHER preview
// remains fully accessible behind a labeled, collapsible group rather
// than being dropped or silently hidden.

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function EvaluationRunCard({
  evaluation,
  profiles,
}: {
  evaluation: AccountEvaluation;
  profiles: IcpProfileListItem[];
}) {
  const { profileName, versionLabel } = resolveEvaluationProfileInfo(evaluation, profiles);
  const isOfficial = evaluation.evaluationMode === "production";
  const isLegacy = isLegacyStarterIcpConfig(evaluation.profileConfigSnapshot);

  return (
    <Card className="border-border bg-card">
      <CardContent className="px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant={isOfficial ? "default" : "secondary"}
            className="text-[10px] uppercase tracking-wide"
          >
            {isOfficial ? "Official" : "Preview"}
          </Badge>
          <span className="text-sm font-medium text-foreground">
            {profileName ?? "ICP profile"}
          </span>
          <span className="text-xs text-muted-foreground">{versionLabel}</span>
        </div>

        <p className="text-[11px] text-muted-foreground/60">
          {formatDateTime(evaluation.createdAt)}
          {evaluation.createdBy && ` · by ${evaluation.createdBy}`}
        </p>

        {evaluation.status === "failed" ? (
          <p className="text-[11px] text-red-300/80 leading-relaxed">
            {evaluation.errorDetail && evaluation.errorDetail.trim() !== ""
              ? evaluation.errorDetail
              : "This run could not be completed; no further details were recorded."}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {(() => {
              const fitBand = humanizeTierLabel(evaluation.fitTier);
              return fitBand ? (
                <span className="text-foreground">
                  <span className="text-muted-foreground">Fit band:</span> {fitBand.label}
                </span>
              ) : null;
            })()}
            {(() => {
              const intentBand = humanizeTierLabel(evaluation.intentTier);
              return intentBand ? (
                <span className="text-foreground">
                  <span className="text-muted-foreground">Intent band:</span> {intentBand.label}
                </span>
              ) : null;
            })()}
            <Badge
              variant={eligibilityBadgeVariant(evaluation.eligibilityOutcome)}
              className="text-[10px] px-1.5 py-0"
            >
              {eligibilityLabel(evaluation.eligibilityOutcome)}
            </Badge>
          </div>
        )}

        {isLegacy && <LegacyStarterWarning />}

        <TechnicalDetails>
          <div className="space-y-1 font-mono text-[11px] text-muted-foreground/80">
            <p>
              <span className="text-muted-foreground/50">Evaluation ID:</span> {evaluation.id}
            </p>
            <p>
              <span className="text-muted-foreground/50">Profile version ID:</span>{" "}
              {evaluation.profileVersionId}
            </p>
            {evaluation.fitTier && (
              <p>
                <span className="text-muted-foreground/50">Fit band code:</span>{" "}
                {evaluation.fitTier}
              </p>
            )}
            {evaluation.intentTier && (
              <p>
                <span className="text-muted-foreground/50">Intent band code:</span>{" "}
                {evaluation.intentTier}
              </p>
            )}
          </div>
        </TechnicalDetails>
      </CardContent>
    </Card>
  );
}

export function EvaluationRunsList({ evaluations }: { evaluations: AccountEvaluation[] }) {
  // Reuses the exact same fetch + query key every other ICP surface on
  // this account page already uses (see
  // ../components/account-icp-preview-panel.tsx) — React Query dedupes
  // the request rather than issuing a second one.
  const profilesQ = useQuery({
    queryKey: icpProfilesListQueryKey(),
    queryFn: fetchIcpProfiles,
  });
  const profiles = profilesQ.data ?? [];

  const { official, latestPreview, olderPreviews } = groupEvaluationRuns(evaluations);

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
        Evaluation runs
      </h2>

      {evaluations.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">No evaluations recorded yet.</p>
        </div>
      ) : (
        <>
          {official.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Official evaluations
              </p>
              <div className="space-y-2">
                {official.map((evaluation) => (
                  <EvaluationRunCard key={evaluation.id} evaluation={evaluation} profiles={profiles} />
                ))}
              </div>
            </div>
          )}

          {latestPreview && (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Latest preview
              </p>
              <EvaluationRunCard evaluation={latestPreview} profiles={profiles} />
            </div>
          )}

          {olderPreviews.length > 0 && (
            <Accordion type="single" collapsible>
              <AccordionItem value="older-previews" className="border-none">
                <AccordionTrigger className="text-xs py-2 hover:no-underline">
                  Previous preview runs ({olderPreviews.length})
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pt-1">
                  {olderPreviews.map((evaluation) => (
                    <EvaluationRunCard key={evaluation.id} evaluation={evaluation} profiles={profiles} />
                  ))}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </>
      )}
    </div>
  );
}
