import { Info, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IcpProfileConfigV1 } from "@workspace/evaluator";
import { buildIcpProfileSummary, deriveConfigWarnings } from "@/lib/icp-profile-business-summary";
import {
  WEIGHT_PRESET_ORDER,
  WEIGHT_PRESET_LABELS,
  WEIGHT_PRESET_VALUES,
} from "@/lib/icp-profile-config-editing";

// "How this ICP works" — a prominent, plain-language explanation of the
// draft configuration currently being edited, derived deterministically
// from `config` (see ../lib/icp-profile-business-summary.ts's own module
// comment: no LLM, nothing inferred beyond what the config literally
// says). Kept as a thin rendering layer: every sentence/count/warning
// below is computed by that pure module, never recomputed here.

function AttributeList({ attributes }: { attributes: string[] }) {
  if (attributes.length === 0) {
    return <p className="text-muted-foreground/70">None configured yet.</p>;
  }
  return <p>{attributes.join(", ")}</p>;
}

// Weight preset values are read directly from WEIGHT_PRESET_ORDER/
// WEIGHT_PRESET_VALUES/WEIGHT_PRESET_LABELS (../lib/icp-profile-config-editing.ts)
// — the same constants ../components/icp-rule-list-section.tsx's weight
// selector uses to set a rule's actual `points` value — so this
// explanation can never drift out of sync with what picking a preset
// actually does.
function WeightPresetExplanation() {
  return (
    <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/20 rounded-md px-2.5 py-2">
      <Info className="w-3 h-3 shrink-0 mt-0.5" />
      <p>
        Rule weights use three presets —{" "}
        {WEIGHT_PRESET_ORDER.map((key, i) => (
          <span key={key}>
            {i > 0 ? (i === WEIGHT_PRESET_ORDER.length - 1 ? ", and " : ", ") : ""}
            <span className="font-medium text-foreground/80">
              {WEIGHT_PRESET_LABELS[key]} = {WEIGHT_PRESET_VALUES[key]} points
            </span>
          </span>
        ))}{" "}
        — plus an Advanced option for an exact number. These are relative weights, not
        percentages and not a score out of 100; score bands are thresholds defined against the
        total configured weights in each dimension.
      </p>
    </div>
  );
}

export function IcpProfileSummaryCard({ config }: { config: IcpProfileConfigV1 }) {
  const summary = buildIcpProfileSummary(config);
  const warnings = deriveConfigWarnings(config);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-foreground">
          How this ICP works
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-xs text-foreground/90">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">
              Company fit ({summary.fit.ruleCount} rule
              {summary.fit.ruleCount === 1 ? "" : "s"}, {summary.fitTotalPoints} configured
              points)
            </p>
            <p className="text-muted-foreground/70">
              What company attributes define a good fit:
            </p>
            <AttributeList attributes={summary.fit.attributes} />
          </div>

          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">
              Buying intent ({summary.intent.ruleCount} rule
              {summary.intent.ruleCount === 1 ? "" : "s"}, {summary.intentTotalPoints} configured
              points)
            </p>
            <p className="text-muted-foreground/70">
              Which signals define buying intent:
            </p>
            <AttributeList attributes={summary.intent.attributes} />
          </div>

          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">
              Ability to act ({summary.actionability.ruleCount} rule
              {summary.actionability.ruleCount === 1 ? "" : "s"}, {summary.actionabilityTotalPoints}{" "}
              configured points)
            </p>
            <p className="text-muted-foreground/70">
              What information makes the account actionable:
            </p>
            <AttributeList attributes={summary.actionability.attributes} />
          </div>

          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">
              Outreach eligibility ({summary.eligibility.hardDisqualifierCount} hard disqualifier
              {summary.eligibility.hardDisqualifierCount === 1 ? "" : "s"},{" "}
              {summary.eligibility.restrictionCount} restriction
              {summary.eligibility.restrictionCount === 1 ? "" : "s"})
            </p>
            <p className="text-muted-foreground/70">
              What causes restriction or disqualification:
            </p>
            {summary.eligibility.hardDisqualifierSentences.length === 0 &&
            summary.eligibility.restrictionSentences.length === 0 ? (
              <p className="text-muted-foreground/70">None configured yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {summary.eligibility.hardDisqualifierSentences.map((sentence, i) => (
                  <li key={`hd-${i}`}>{sentence}</li>
                ))}
                {summary.eligibility.restrictionSentences.map((sentence, i) => (
                  <li key={`r-${i}`}>{sentence}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/60">
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">Fit bands</p>
            {summary.fitBands.map((band) => (
              <p key={band.code}>
                {band.label}
                {band.isFallback ? " (fallback)" : ""} — {band.minScore}+ points
              </p>
            ))}
          </div>
          <div className="space-y-1">
            <p className="font-medium text-muted-foreground">Intent bands</p>
            {summary.intentBands.map((band) => (
              <p key={band.code}>
                {band.label}
                {band.isFallback ? " (fallback)" : ""} — {band.minScore}+ points
              </p>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted/20 rounded-md px-2.5 py-2">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          <p>
            Points are rule weights, not a score out of 100 — each dimension&apos;s total is the
            sum of its currently configured rules&apos; weights.
          </p>
        </div>

        <WeightPresetExplanation />

        {warnings.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-amber-400">Configuration guidance</p>
            <ul className="space-y-1">
              {warnings.map((warning) => (
                <li
                  key={warning.id}
                  className="flex items-start gap-1.5 text-[11px] text-amber-300/90"
                >
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  {warning.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
